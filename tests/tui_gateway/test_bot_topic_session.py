"""LIVE E2E: ``session.create {bot_topic: true}`` — the Desktop "New chat with
this bot" mint — carries bot powers for the session's whole life.

The marker must land in the session row's ``model_config`` (once, at create;
byte-stable tool list + system prompt across turns), survive a gateway restart
through every ``session.resume`` path, and resolve into the three powers the
canonical Bot Chat already had: ``message_agent``, ``update_task``, and the
"Messaging other agents" system-prompt section. A plain session minted the
same way stays powerless, and the canonical Bot Chat stays the bot's ONE
identity — a topic shares its powers, never its title.

This drives the REAL ``tui_gateway.server.handle_request`` dispatch (the same
funnel the Desktop WebSocket transport uses) on an isolated HERMES_HOME whose
``profiles/<bot>/profile.yaml`` carries the Bot-Mode-managed marker.

Run:  python -m pytest tests/tui_gateway/test_bot_topic_session.py -o addopts= -v -s
"""

from __future__ import annotations

import json
import os
import tempfile
import textwrap
import uuid
from pathlib import Path

import pytest
import hermes_yaml as yaml


@pytest.fixture()
def live_home(monkeypatch):
    """A REAL isolated HERMES_HOME with a managed bot profile + config + state.db."""
    tmp = Path(tempfile.mkdtemp(prefix="hermes-live-bottopic-"))
    home = tmp / ".hermes"
    home.mkdir(parents=True)
    config = {
        "model": {"default": "test-model-live", "provider": "custom:newone"},
        "custom_providers": [
            {
                "name": "newone",
                "base_url": "https://new-endpoint.invalid/v1",
                "api_key": "sk-live-test-not-real",
                "api_mode": "chat_completions",
            }
        ],
    }
    (home / "config.yaml").write_text(yaml.safe_dump(config))
    # One Bot-Mode-managed teammate makes this a managed install (the default
    # profile this session runs under is itself a bot candidate).
    teammate = home / "profiles" / "researcher"
    teammate.mkdir(parents=True)
    (teammate / "profile.yaml").write_text(
        textwrap.dedent(
            """\
            description: teammate for tests
            ui_meta:
              hermes-bots:
                shape: cloud
            """
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("HERMES_HOME", str(home))
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    home_token = set_hermes_home_override(str(home))
    for var in list(os.environ):
        if var.endswith("_API_KEY") or var in ("OPENROUTER_KEY", "NOUS_KEY"):
            monkeypatch.delenv(var, raising=False)

    import hermes_cli.config as hconfig
    import hermes_cli.runtime_provider as rp

    for mod in (hconfig, rp):
        for attr in ("_config_cache", "_cache", "_CONFIG_CACHE"):
            if hasattr(mod, attr):
                try:
                    setattr(mod, attr, None)
                except Exception:
                    pass

    import hermes_state
    import tui_gateway.server as server
    from tools import bot_mode_probe

    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", home / "state.db")
    monkeypatch.setattr(server, "_db", None, raising=False)
    monkeypatch.setattr(server, "_db_error", None, raising=False)
    monkeypatch.setattr(server, "_hermes_home", str(home), raising=False)
    bot_mode_probe._reset_cache_for_tests()
    yield home, server
    try:
        if server._db is not None:
            server._db.close()
    except Exception:
        pass
    server._db = None
    bot_mode_probe._reset_cache_for_tests()
    try:
        reset_hermes_home_override(home_token)
    except Exception:
        pass


def _create(server, **extra_params) -> dict:
    params = {"source": "desktop", **extra_params}
    resp = server.handle_request(
        {"id": f"create-{uuid.uuid4().hex[:6]}", "method": "session.create", "params": params}
    )
    assert "error" not in resp, f"session.create failed: {resp.get('error')}"
    return resp["result"]


def _title(server, runtime_sid: str, title: str) -> None:
    resp = server.handle_request(
        {"id": f"title-{runtime_sid}", "method": "session.title",
         "params": {"session_id": runtime_sid, "title": title}}
    )
    assert "error" not in resp, f"session.title failed: {resp.get('error')}"


def _row(home: Path, key: str) -> dict:
    from hermes_state import SessionDB

    db = SessionDB(db_path=home / "state.db")
    try:
        return db.get_session(key) or {}
    finally:
        db.close()


def _resume_eager(server, key: str) -> dict:
    return server.handle_request(
        {"id": f"resume-{key}", "method": "session.resume",
         "params": {"session_id": key, "eager_build": True, "omit_messages": True}}
    )


def _live_agent(server, resp: dict):
    live_sid = (resp.get("result") or {}).get("session_id")
    session = server._sessions.get(live_sid) or {}
    return session.get("agent")


def _close(server, resp: dict) -> None:
    live_sid = (resp.get("result") or {}).get("session_id")
    if live_sid:
        server.handle_request(
            {"id": f"close-{live_sid}", "method": "session.close", "params": {"session_id": live_sid}}
        )


class TestBotTopicSessionLive:
    def test_topic_carries_marker_into_model_config(self, live_home):
        """create {bot_topic:true} → the materialized row's model_config keeps the
        marker — the durable, session-lifetime record every gate reads."""
        home, server = live_home
        created = _create(server, bot_topic=True)
        _title(server, created["session_id"], "Weekly digest thread")
        try:
            row = _row(home, created["stored_session_id"])
            assert row, "session.title must materialize the row"
            model_config = row.get("model_config")
            if isinstance(model_config, str):
                model_config = json.loads(model_config)
            assert (model_config or {}).get("bot_topic") is True
            # A topic owns its own title — never the canonical identity.
            assert row.get("title") == "Weekly digest thread"
        finally:
            _close(server, {"result": created})

    def test_resumed_topic_is_bot_powered(self, live_home):
        """Restart leg: a marked row resumes with the marker restored on the
        session record and the built agent resolves bot-powered — DM tool,
        mailbox tool, and the teammate-protocol prompt section."""
        from agent.system_prompt import _bot_mode_parts
        from tools.bot_mailbox import UPDATE_TASK_TOOL_NAME, ensure_update_task_tool
        from tools.bot_mode_dm import MESSAGE_AGENT_TOOL_NAME, ensure_message_agent_tool
        from tools.bot_mode_probe import bot_powered_session, canonical_bot_chat

        home, server = live_home
        created = _create(server, bot_topic=True)
        _title(server, created["session_id"], "Weekly digest thread")
        _close(server, {"result": created})

        resp = _resume_eager(server, created["stored_session_id"])
        try:
            assert "error" not in resp, f"resume failed: {resp.get('error')}"
            live_sid = resp["result"]["session_id"]
            assert server._sessions[live_sid].get("bot_topic") is True
            agent = _live_agent(server, resp)
            assert agent is not None
            assert bot_powered_session(agent) is True
            assert canonical_bot_chat(agent) is False

            assert ensure_message_agent_tool(agent) is True
            assert MESSAGE_AGENT_TOOL_NAME in agent.valid_tool_names
            assert ensure_update_task_tool(agent) is True
            assert UPDATE_TASK_TOOL_NAME in agent.valid_tool_names

            section = "\n".join(_bot_mode_parts(agent))
            assert "Messaging other agents" in section
        finally:
            _close(server, resp)

    def test_plain_session_stays_powerless(self, live_home):
        """Control: a side chat minted without the marker gets neither the
        tools nor the prompt section — on the same managed install."""
        from agent.system_prompt import _bot_mode_parts
        from tools.bot_mailbox import ensure_update_task_tool
        from tools.bot_mode_dm import ensure_message_agent_tool
        from tools.bot_mode_probe import bot_powered_session

        home, server = live_home
        created = _create(server)
        _title(server, created["session_id"], "Weekly digest thread")
        _close(server, {"result": created})

        resp = _resume_eager(server, created["stored_session_id"])
        try:
            assert "error" not in resp, f"resume failed: {resp.get('error')}"
            agent = _live_agent(server, resp)
            assert agent is not None
            assert bot_powered_session(agent) is False
            assert ensure_message_agent_tool(agent) is False
            assert ensure_update_task_tool(agent) is False
            assert _bot_mode_parts(agent) == []
        finally:
            _close(server, resp)

    def test_canonical_bot_chat_keeps_its_powers(self, live_home):
        """Control: the canonical Bot Chat stays bot-powered through the SAME
        predicate — the topic mechanism never displaced the title identity."""
        from tools.bot_mode_dm import ensure_message_agent_tool
        from tools.bot_mode_probe import bot_powered_session, canonical_bot_chat

        home, server = live_home
        from hermes_state import SessionDB

        sid = uuid.uuid4().hex[:12]
        db = SessionDB(db_path=home / "state.db")
        try:
            db.create_session(sid, source="desktop", model="test-model-live")
            db.set_session_title(sid, "Bot Chat")
        finally:
            db.close()

        resp = _resume_eager(server, sid)
        try:
            assert "error" not in resp, f"resume failed: {resp.get('error')}"
            agent = _live_agent(server, resp)
            assert agent is not None
            assert bot_powered_session(agent) is True
            assert canonical_bot_chat(agent) is True
            assert ensure_message_agent_tool(agent) is True
        finally:
            _close(server, resp)
