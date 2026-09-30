"""LIVE E2E: the team-room orchestrator marker — ``team_room`` + ``team_room_lead`` —
through the REAL gateway dispatch path and a real SessionDB.

The marker is a session-lifetime flag: minted by ``session.create`` params, persisted on
the row's ``model_config``, restored on EVERY resume path, and surfaced to the prompt layer
as agent hints (``agent._team_room`` / ``agent._team_room_lead``) plus the
``tools.bot_mode_probe`` predicates — never recomputed mid-conversation.

Also exercised over the same real ``handle_request`` funnel: ``bots_team.room_lead``, the
RPC the desktop/hosted room engines ask for the org-tree lead of a group chat's roster.

Run:  scripts/run_tests.sh tests/tui_gateway/test_team_room_session.py
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from pathlib import Path

import pytest
import hermes_yaml as yaml

BASE_URL = "https://team-room-test.invalid/v1"


@pytest.fixture()
def live_home(monkeypatch):
    """A REAL isolated HERMES_HOME with a config.yaml + state.db on disk."""
    tmp = Path(tempfile.mkdtemp(prefix="hermes-live-teamroom-"))
    home = tmp / ".hermes"
    home.mkdir(parents=True)
    config = {
        "model": {"default": "test-model-live", "provider": "custom:teamroom"},
        "custom_providers": [
            {
                "name": "teamroom",
                "base_url": BASE_URL,
                "api_key": "sk-live-test-not-real",
                "api_mode": "chat_completions",
            }
        ],
    }
    (home / "config.yaml").write_text(yaml.safe_dump(config))
    monkeypatch.setenv("HERMES_HOME", str(home))
    # hermes_constants caches the resolved home at first read — the env var
    # alone doesn't repoint an already-imported process. Use the override API
    # (the same mechanism profile-scoped resumes use).
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    home_token = set_hermes_home_override(str(home))
    # Neutralize ambient provider creds so resolution uses ONLY the config
    # above — this must behave the same on a dev box and a bare CI runner.
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

    # The launch DB handle and the module-level home snapshot are import-time
    # caches — repoint both at the isolated home for the duration of the test
    # (see references: tui-gateway live WS harness, same trap). The hermetic
    # conftest also re-pins hermes_state.DEFAULT_DB_PATH per test; pin it to
    # THIS home so server._get_db() opens the same real state.db we seed.
    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", home / "state.db")
    monkeypatch.setattr(server, "_db", None, raising=False)
    monkeypatch.setattr(server, "_db_error", None, raising=False)
    monkeypatch.setattr(server, "_hermes_home", str(home), raising=False)
    yield home, server
    # Detach the shared handle so the tmpdir can be reclaimed.
    try:
        if server._db is not None:
            server._db.close()
    except Exception:
        pass
    server._db = None
    try:
        reset_hermes_home_override(home_token)
    except Exception:
        pass


def _rpc(server, method: str, params: dict) -> dict:
    """Drive the REAL dispatch entry (same funnel the Desktop WS uses)."""
    return server.handle_request({"id": f"rid-{method}-{uuid.uuid4().hex[:6]}", "method": method, "params": params})


def _ok(resp: dict) -> dict:
    assert "error" not in resp, f"dispatch failed live: {resp.get('error')}"
    return resp["result"]


def _seed_team_room_row(home: Path, *, lead: str | None = "lead") -> str:
    """A REAL stored row for a member session of a team-orchestrated room."""
    from hermes_state import SessionDB

    db = SessionDB(db_path=home / "state.db")
    sid = uuid.uuid4().hex[:12]
    model_config = {
        "model": "test-model-live",
        "provider": "custom:teamroom",
        "api_mode": "chat_completions",
        "base_url": BASE_URL,
    }
    if lead is not None:
        model_config["team_room"] = True
        model_config["team_room_lead"] = lead
    db.create_session(
        sid,
        source="tui",
        model="test-model-live",
        model_config=model_config,
        session_key=f"live-test:{sid}",
    )
    db.set_session_title(sid, "Team room side chat")
    db.close()
    return sid


def _close(server, resp) -> None:
    live_sid = (resp.get("result") or {}).get("session_id")
    if live_sid:
        server.handle_request(
            {"id": "close", "method": "session.close", "params": {"session_id": live_sid}}
        )


def _live_record(server, sid: str) -> dict:
    return server._sessions.get(sid) or {}


def test_room_lead_rpc_resolves_the_org_tree_live(live_home):
    """The desktop room engine's only door to lead resolution: real ``bots_team.*``
    writes build the org chart, real ``bots_team.room_lead`` answers who listens."""
    _home, server = live_home
    view = _ok(_rpc(server, "bots_team.create", {"name": "Growth", "mission": "Reach 10k users"}))
    tid = view["team"]["id"]
    ceo = _ok(_rpc(server, "bots_team.member.upsert", {
        "team_id": tid, "profile": "ceo", "role": "Chief", "lead": True}))["member"]
    _ok(_rpc(server, "bots_team.member.upsert", {
        "team_id": tid, "profile": "writer", "role": "Content", "reports_to": ceo["slot"]}))

    resolved = _ok(_rpc(server, "bots_team.room_lead", {"members": ["ceo", "writer"]}))
    assert resolved["lead"] == "ceo" and resolved["team_id"] == tid
    # Roster without the lead, roster with a stranger, empty roster → all "no lead".
    for members in (["writer"], ["ceo", "writer", "stranger"], []):
        resolved = _ok(_rpc(server, "bots_team.room_lead", {"members": members}))
        assert resolved["lead"] is None, (members, resolved)


def test_seeded_create_persists_the_marker_on_the_row(live_home):
    """session.create params → session dict → row model_config, in one real dispatch."""
    home, server = live_home
    resp = _rpc(server, "session.create", {
        "title": "Team room side chat",
        "messages": [{"role": "user", "content": "hi"}],
        "team_room": True,
        "team_room_lead": "lead",
    })
    try:
        result = _ok(resp)
        record = _live_record(server, result["session_id"])
        assert record.get("team_room") is True and record.get("team_room_lead") == "lead"

        from hermes_state import SessionDB

        db = SessionDB(db_path=home / "state.db")
        try:
            row = db.get_session(result["stored_session_id"]) or {}
        finally:
            db.close()
        model_config = row.get("model_config")
        if isinstance(model_config, str):
            model_config = json.loads(model_config)
        assert model_config.get("team_room") is True
        assert model_config.get("team_room_lead") == "lead"
    finally:
        _close(server, resp)


def test_eager_resume_restores_the_marker_and_agent_hints(live_home):
    """Row model_config → record → built agent: the whole resume chain in one shot."""
    home, server = live_home
    sid = _seed_team_room_row(home)
    resp = _rpc(server, "session.resume", {
        "session_id": sid, "eager_build": True, "omit_messages": True})
    try:
        result = _ok(resp)
        record = _live_record(server, result["session_id"])
        assert record.get("team_room") is True and record.get("team_room_lead") == "lead"

        from tools import bot_mode_probe

        agent = record.get("agent")
        assert agent is not None
        assert bot_mode_probe.team_room_session(agent) is True
        assert bot_mode_probe.team_room_lead(agent) == "lead"
    finally:
        _close(server, resp)


def test_lazy_resume_restores_the_marker_on_the_record(live_home):
    """The deferred path parses the same model_config into the session record."""
    home, server = live_home
    sid = _seed_team_room_row(home)
    resp = _rpc(server, "session.resume", {"session_id": sid, "omit_messages": True})
    try:
        result = _ok(resp)
        record = _live_record(server, result["session_id"])
        assert record.get("team_room") is True and record.get("team_room_lead") == "lead"
    finally:
        _close(server, resp)


def test_unmarked_sessions_resume_without_the_marker(live_home):
    """The flag is opt-in per session: an ordinary row restores no orchestrator state."""
    home, server = live_home
    sid = _seed_team_room_row(home, lead=None)
    resp = _rpc(server, "session.resume", {
        "session_id": sid, "eager_build": True, "omit_messages": True})
    try:
        result = _ok(resp)
        record = _live_record(server, result["session_id"])
        assert not record.get("team_room") and record.get("team_room_lead") is None
        agent = record.get("agent")
        if agent is not None:
            from tools import bot_mode_probe

            assert bot_mode_probe.team_room_session(agent) is False
    finally:
        _close(server, resp)
