"""Tests for the bundled ``bot-context`` plugin (Bot Mode context + activity approvals).

What this suite pins down, in the order the plugin's own contract states it:

* **Registration** — the manifest parses, the plugin is discovered as bundled but
  stays disabled until ``plugins.enabled`` names it, and ``register()`` wires the
  four tools, three hooks, the slash command and the CLI subcommand.
* **Context resolution** — explicit args, the live session registry, env and the
  launch home, in that precedence, with ``missing``/``degraded`` instead of a
  guessed profile. Room session keys separate; Bot titles come from
  ``profile.yaml``.
* **Activity approvals, end to end** — the hook indexes a prompt the host really
  queued, ``bot_context_respond`` wakes that real waiter through
  ``tools.approval.resolve_gateway_approval``, and the ledger settles once.
* **Failure modes** — malformed payloads, unknown/already-settled/expired ids,
  unanswerable choices, missing session keys, permission refusals and a raising
  host resolver all come back as codes, and none of them touch the queue.
* **Backward compatibility** — with the plugin disabled nothing is registered;
  the host's own FIFO approval resolution is byte-for-byte unchanged; the
  ``legacy`` projection matches the Desktop ``GroupPendingApproval`` wire shape.
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import textwrap
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
PLUGIN_DIR = REPO_ROOT / "plugins" / "bot-context"


# ── fixtures ────────────────────────────────────────────────────────────────
def _load_plugin() -> types.ModuleType:
    """Import ``plugins/bot-context`` under the loader's module naming convention."""
    name = "hermes_plugins.bot_context"
    if name in sys.modules:
        return sys.modules[name]
    if "hermes_plugins" not in sys.modules:
        ns = types.ModuleType("hermes_plugins")
        ns.__path__ = []
        sys.modules["hermes_plugins"] = ns
    spec = importlib.util.spec_from_file_location(
        name, PLUGIN_DIR / "__init__.py", submodule_search_locations=[str(PLUGIN_DIR)]
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    module.__package__ = name
    module.__path__ = [str(PLUGIN_DIR)]
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def plugin(tmp_path, monkeypatch):
    """A freshly imported plugin with an isolated HERMES_HOME and no leftover ledger."""
    home = tmp_path / "root"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.delenv("HERMES_PROFILE", raising=False)
    monkeypatch.delenv("HERMES_PROFILE_NAME", raising=False)
    module = _load_plugin()
    module._reset_state_for_tests()
    yield module
    module._reset_state_for_tests()
    _clear_queues()


@pytest.fixture()
def bot_home(tmp_path):
    """``<tmp>/profiles/atlas`` — a named bot profile home with a Bot Mode title."""
    home = tmp_path / "root" / "profiles" / "atlas"
    home.mkdir(parents=True)
    (home / "profile.yaml").write_text(
        "description: test bot\nui_meta:\n  hermes-bots:\n    title: Atlas\n", encoding="utf-8"
    )
    return home


class FakeCtx:
    """Records what ``register()`` wires, and serves ``get_config`` from a dict."""

    def __init__(self, settings: dict | None = None):
        self.settings = dict(settings or {})
        self.tools: dict[str, dict] = {}
        self.hooks: dict[str, list] = {}
        self.commands: dict[str, dict] = {}
        self.cli: dict[str, dict] = {}

    def get_config(self, key, default=None):
        return self.settings.get(key, default)

    def register_tool(self, name, toolset, schema, handler, description="", emoji="", **_):
        self.tools[name] = {"toolset": toolset, "schema": schema, "handler": handler,
                            "description": description, "emoji": emoji}

    def register_hook(self, name, callback, **_):
        self.hooks.setdefault(name, []).append(callback)

    def register_command(self, name, handler, description="", args_hint="", **_):
        self.commands[name] = {"handler": handler, "description": description, "args_hint": args_hint}

    def register_cli_command(self, name, help, setup_fn, handler_fn=None, description="", **_):
        self.cli[name] = {"help": help, "setup_fn": setup_fn, "handler_fn": handler_fn,
                          "description": description}

    # convenience
    def fire(self, hook, **payload):
        for callback in self.hooks.get(hook, []):
            callback(**payload)

    def call(self, tool, params=None):
        return json.loads(self.tools[tool]["handler"](params or {}, session_id="test"))


def _clear_queues():
    from tools import approval
    with approval._lock:
        approval._gateway_queues.clear()


def _queue(session_key: str, *, command: str = "rm -rf /var/tmp/x", request_id: str | None = None,
           **data):
    """Put a REAL pending approval in the host's queue and return its entry."""
    from tools.approval_gateway_wait import _ApprovalEntry
    from tools import approval

    payload = {"command": command, "description": "delete files", "pattern_key": "rm",
               "pattern_keys": ["rm"], "session_key": session_key, "surface": "gateway"}
    payload.update(data)
    entry = _ApprovalEntry(payload)
    if request_id:
        entry.data["request_id"] = request_id
    with approval._lock:
        approval._gateway_queues.setdefault(session_key, []).append(entry)
    return entry


def _payload(session_key="sess-1", request_id="req-1", **extra):
    payload = {"command": "rm -rf /var/tmp/x", "description": "delete files",
               "pattern_key": "rm", "pattern_keys": ["rm"], "session_key": session_key,
               "surface": "gateway", "request_id": request_id}
    payload.update(extra)
    return payload


def _stock_payload(session_key="sess-1", **extra):
    """The real gateway hook payload on stock Nous main: no ``request_id``."""
    payload = {"command": "rm -rf /var/tmp/x", "description": "delete files",
               "pattern_key": "rm", "pattern_keys": ["rm"], "session_key": session_key,
               "surface": "gateway"}
    payload.update(extra)
    return payload


def _bot_context(plugin, home: Path, *, session_key="sess-1", session_id="sid-1"):
    return plugin.resolve_bot_context(
        profile_home=str(home), session_key=session_key, session_id=session_id, surface="gateway"
    )


# ── registration ────────────────────────────────────────────────────────────
class TestRegistration:
    def test_manifest_parses_and_declares_the_public_surface(self):
        from hermes_cli.plugins_manifest import parse_manifest_file

        manifest = parse_manifest_file(PLUGIN_DIR / "plugin.yaml", PLUGIN_DIR, "bundled", "")
        assert manifest.name == "bot-context"
        assert manifest.version == "0.2.1"
        assert set(manifest.provides_tools) == {
            "bot_context_resolve", "bot_context_activities",
            "bot_context_respond", "bot_context_history", "bot_context_subagents",
        }
        assert {"pre_approval_request", "post_approval_response", "on_session_end",
                "subagent_start", "subagent_stop"} <= set(manifest.provides_hooks)
        assert "answer_scope" in (manifest.config_schema or {})
        assert manifest.config_schema["answer_scope"]["default"] == "user"

    def test_register_wires_tools_hooks_command_and_cli(self, plugin):
        ctx = FakeCtx()
        plugin.register(ctx)

        assert set(ctx.tools) == {"bot_context_resolve", "bot_context_activities",
                                  "bot_context_respond", "bot_context_history",
                                  "bot_context_subagents"}
        assert all(spec["toolset"] == "bot_context" for spec in ctx.tools.values())
        for name, spec in ctx.tools.items():
            assert spec["schema"]["name"] == name
            assert spec["schema"]["description"]
            assert spec["schema"]["parameters"]["type"] == "object"
        assert set(ctx.hooks) == {"pre_approval_request", "post_approval_response", "on_session_end",
                                  "subagent_start", "subagent_stop"}
        assert "bot-context" in ctx.commands
        assert "bot-context" in ctx.cli

    def test_bundled_plugin_is_discovered_but_not_enabled(self, plugin, tmp_path, monkeypatch):
        """The whole compatibility argument: discovery is free, execution needs consent."""
        import hermes_yaml as yaml
        from hermes_cli import plugins as pmod

        home = Path(os.environ["HERMES_HOME"])
        (home / "config.yaml").write_text(yaml.safe_dump({"plugins": {}}), encoding="utf-8")

        manager = pmod.PluginManager()
        manager.discover_and_load()
        loaded = manager._plugins.get("bot-context")
        assert loaded is not None, "bundled plugin must be discovered"
        assert loaded.manifest.source == "bundled"
        assert not loaded.enabled
        assert loaded.error and "not enabled" in loaded.error

    def test_enabling_the_plugin_is_a_config_line(self, plugin, tmp_path, monkeypatch):
        import hermes_yaml as yaml
        from hermes_cli import plugins as pmod

        home = Path(os.environ["HERMES_HOME"])
        (home / "config.yaml").write_text(
            yaml.safe_dump({"plugins": {"enabled": ["bot-context"]}}), encoding="utf-8")

        manager = pmod.PluginManager()
        manager.discover_and_load()
        loaded = manager._plugins.get("bot-context")
        assert loaded is not None and loaded.enabled
        assert loaded.manifest.name == "bot-context"


# ── context resolution ──────────────────────────────────────────────────────
class TestContext:
    def test_explicit_profile_home_is_authoritative(self, plugin, bot_home):
        ctx = _bot_context(plugin, bot_home)
        assert ctx.complete
        assert ctx.profile == "atlas"
        assert ctx.bot_title == "Atlas"
        assert ctx.profile_source == "explicit"
        assert ctx.missing == ()

    def test_launch_profile_is_named_default(self, plugin, monkeypatch):
        ctx = plugin.resolve_bot_context(session_key="s1", session_id="sid")
        assert ctx.profile == "default"
        assert ctx.complete
        assert ctx.bot_title == ""  # no profile.yaml on the launch home
        # With no gateway bound in-process the registry lookup legitimately cannot
        # answer; that is reported as degradation, never as a made-up bot identity.
        assert all("live_session" in d for d in ctx.degraded)

    def test_live_session_registry_supplies_the_profile(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry

        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-9", {"profile_home": str(bot_home)}))
        ctx = plugin.resolve_bot_context(session_key="sess-1")
        assert ctx.profile == "atlas"
        assert ctx.profile_source == "live_session"
        assert ctx.bot_title == "Atlas"
        # The registry's runtime id is what live UI events carry, so it must
        # travel with the context even though the hook only supplied a key.
        assert ctx.session_id == "sid-9"

    def test_live_session_beats_a_process_wide_profile_env(self, plugin, bot_home, monkeypatch):
        """The gateway exports the launch profile name; only the session record knows better."""
        import tui_gateway.session_registry as registry
        monkeypatch.setenv("HERMES_PROFILE", "default")
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        ctx = plugin.resolve_bot_context(session_key="sess-1")
        assert ctx.profile == "atlas"
        assert ctx.profile_source == "live_session"

    def test_unreachable_registry_degrades_instead_of_lying(self, plugin, monkeypatch):
        import tui_gateway.session_registry as registry

        def boom(key):
            raise RuntimeError("registry gone")

        monkeypatch.setattr(registry, "_find_live_session_by_key", boom)
        ctx = plugin.resolve_bot_context(session_key="sess-1")
        assert ctx.profile == "default"  # launch home fallback, from env
        assert any("live_session" in d for d in ctx.degraded)

    def test_env_profile_name_is_used_when_home_has_no_name(self, plugin, bot_home, monkeypatch):
        """HERMES_PROFILE is the last resort when the home itself carries no profile identity."""
        import hermes_constants
        monkeypatch.setattr(hermes_constants, "profile_name_for_home", lambda path: None)
        monkeypatch.setenv("HERMES_PROFILE", "atlas")
        ctx = plugin.resolve_bot_context(session_key="sess-1")
        assert ctx.profile == "atlas"
        assert ctx.profile_source == "env"

    def test_no_session_at_all_is_reported_not_guessed(self, plugin):
        ctx = plugin.resolve_bot_context()
        assert not ctx.complete
        assert "session_key" in ctx.missing and "session_id" in ctx.missing

    def test_room_session_key_splits_into_room_and_generation(self, plugin, bot_home):
        ctx = plugin.resolve_bot_context(profile_home=str(bot_home),
                                         session_key="room:task_42:3", session_id="sid")
        assert ctx.room == "task_42"
        assert ctx.room_generation == "3"
        assert ctx.is_room_session

    def test_resolve_tool_reports_missing_context_as_a_code(self, plugin, monkeypatch):
        ctx = FakeCtx()
        plugin.register(ctx)
        # No addressing given and no bound session: the honest answer is "I cannot tell".
        monkeypatch.delenv("HERMES_SESSION_KEY", raising=False)
        monkeypatch.delenv("HERMES_SESSION_ID", raising=False)
        body = ctx.call("bot_context_resolve", {})
        assert body["ok"] is False
        assert body["code"] == "missing_context"
        assert "session_key" in body["context"]["missing"]

    def test_resolve_tool_defaults_to_the_calling_session(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        monkeypatch.setenv("HERMES_SESSION_KEY", "sess-1")
        monkeypatch.setenv("HERMES_SESSION_ID", "sid-1")
        ctx = FakeCtx()
        plugin.register(ctx)
        body = ctx.call("bot_context_resolve", {})
        assert body["ok"] is True, body
        assert body["context"]["profile"] == "atlas"
        assert body["context"]["bot_title"] == "Atlas"

    def test_resolve_tool_unknown_request_id_names_the_problem(self, plugin):
        ctx = FakeCtx()
        plugin.register(ctx)
        body = ctx.call("bot_context_resolve", {"request_id": "nope"})
        assert body["ok"] is False
        assert body["code"] == "unknown_activity"
        assert body["field"] == "request_id"


# ── activity approvals, end to end ──────────────────────────────────────────
class TestApprovalFlow:
    def test_hook_indexes_a_real_host_approval(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        entry = _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))

        body = ctx.call("bot_context_activities", {})
        assert body["ok"] is True and body["count"] == 1
        activity = body["activities"][0]
        assert activity["activity_id"] == "req-1"
        assert activity["bot"]["profile"] == "atlas"
        assert activity["bot"]["title"] == "Atlas"
        assert activity["session"]["key"] == "sess-1"
        assert activity["status"] == "pending"
        assert entry.result is None  # indexing never answers anything

    def test_respond_wakes_the_real_waiter(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        entry = _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))

        body = ctx.call("bot_context_respond", {"request_id": "req-1", "choice": "once"})
        assert body["ok"] is True, body
        assert body["status"] == "resolved"
        assert body["decision"] == "approved"
        # The host's own queue was woken, exactly as a card click would.
        assert entry.result == "once"
        assert entry.event.is_set()

        pending = ctx.call("bot_context_activities", {})
        assert pending["count"] == 0
        history = ctx.call("bot_context_history", {})
        assert history["count"] == 1
        assert history["decisions"][0]["status"] == "approved"
        assert history["decisions"][0]["settled_choice"] == "once"

    def test_deny_relays_the_reason_to_the_blocked_bot(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        entry = _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))

        body = ctx.call("bot_context_respond",
                        {"request_id": "req-1", "choice": "deny", "reason": "use a scratch dir"})
        assert body["ok"] is True and body["decision"] == "denied"
        assert entry.result == "deny"
        assert entry.reason == "use a scratch dir"

    def test_answer_then_host_hook_is_one_decision(self, plugin, bot_home, monkeypatch):
        """The plugin answers, the host fires its post-hook: history must show one row."""
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))
        assert ctx.call("bot_context_respond", {"request_id": "req-1", "choice": "once"})["ok"]
        # This is what the host does next: post_approval_response with the same choice.
        ctx.fire("post_approval_response", **_payload(session_key="sess-1", request_id="req-1"),
                 choice="once")

        decisions = ctx.call("bot_context_history", {})["decisions"]
        assert [d["activity_id"] for d in decisions] == ["req-1"]

    def test_post_hook_settles_whichever_surface_answered(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))
        ctx.fire("post_approval_response", **_payload(session_key="sess-1", request_id="req-1"),
                 choice="deny", decided_by="user")

        assert ctx.call("bot_context_activities", {})["count"] == 0
        history = ctx.call("bot_context_history", {})["decisions"]
        assert history[0]["status"] == "denied"
        assert history[0]["settled_by"] == "user"

    def test_legacy_projection_matches_the_desktop_wire_shape(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))

        legacy = ctx.call("bot_context_activities", {})["activities"][0]["legacy"]
        # GroupPendingApproval in apps/desktop/src/plugins/hermes-bots/group-turns.ts
        assert set(legacy) == {"request_id", "kind", "command", "description", "choices"}
        assert legacy["kind"] == "approval"
        assert legacy["request_id"] == "req-1"
        assert "once" in legacy["choices"] and "deny" in legacy["choices"]

    def test_slash_command_lists_and_answers(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        entry = _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))

        listing = ctx.commands["bot-context"]["handler"]("")
        assert "Atlas" in listing and "rm -rf" in listing

        verdict = ctx.commands["bot-context"]["handler"]("approve req-1")
        assert "resolved" in verdict
        assert entry.result == "once"


# ── failure modes ───────────────────────────────────────────────────────────
class TestFailures:
    def _track(self, ctx, *args, **kwargs):
        ctx.fire("pre_approval_request", *args, **kwargs)

    def test_local_cli_prompt_without_a_gateway_entry_is_visible_but_not_remote(self, plugin):
        """Stock CLI hooks have no request_id and no queue: show the row, never fake an answer."""
        ctx = FakeCtx()
        plugin.register(ctx)
        payload = _payload()
        payload.pop("request_id")
        payload["surface"] = "cli"
        ctx.fire("pre_approval_request", **payload)

        rows = ctx.call("bot_context_activities", {})["activities"]
        assert len(rows) == 1
        assert rows[0]["activity_id"].startswith("local:")
        assert rows[0]["answerable"] is False
        assert rows[0]["source"] == "local"

        body = ctx.call("bot_context_respond",
                        {"request_id": rows[0]["activity_id"], "choice": "once"})
        assert body["ok"] is False and body["code"] == "local_only"

    def test_non_string_command_is_dropped_with_the_field_named(self, plugin):
        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(command={"argv": ["rm"]}))
        assert ctx.call("bot_context_activities", {})["count"] == 0
        assert plugin._ledger(ctx).dropped[-1]["field"] == "command"

    def test_blank_preview_is_not_an_approval(self, plugin):
        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(command="", description=""))
        assert ctx.call("bot_context_activities", {})["count"] == 0

    def test_oversized_preview_is_truncated_not_refused(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="req-1", command="x" * 10_000)

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1",
                                                    command="x" * 10_000))
        activity = ctx.call("bot_context_activities", {})["activities"][0]
        assert activity["command"].endswith("chars]")
        assert len(activity["command"]) < 2200

    def test_unknown_activity_is_explained(self, plugin):
        ctx = FakeCtx()
        plugin.register(ctx)
        body = ctx.call("bot_context_respond", {"request_id": "ghost", "choice": "once"})
        assert body["ok"] is False and body["code"] == "unknown_activity"

    def test_already_settled_is_idempotent_not_a_second_approval(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        entry = _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))
        first = ctx.call("bot_context_respond", {"request_id": "req-1", "choice": "once"})
        assert first["ok"] is True

        second = ctx.call("bot_context_respond", {"request_id": "req-1", "choice": "once"})
        assert second["ok"] is False and second["code"] == "already_settled"
        assert entry.result == "once"

    def test_prompt_gone_from_the_host_queue_is_not_reported_as_approved(self, plugin,
                                                                        bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))
        _clear_queues()  # answered on another surface / withdrawn / expired

        body = ctx.call("bot_context_respond", {"request_id": "req-1", "choice": "once"})
        assert body["ok"] is False
        assert body["code"] == "not_pending"
        assert body["activity"]["status"] == "resolved_elsewhere"

    def test_choice_the_host_would_refuse_is_never_sent(self, plugin, bot_home, monkeypatch):
        """No "always" unless the operator enabled permanent scopes — the queue must stay untouched."""
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        entry = _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))

        body = ctx.call("bot_context_respond", {"request_id": "req-1", "choice": "always"})
        assert body["ok"] is False and body["code"] == "invalid_choice"
        assert "once" in body["detail"]["allowed"]
        assert entry.result is None

    def test_permanent_scope_allowed_only_when_host_and_operator_agree(self, plugin,
                                                                      bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        entry = _queue("sess-1", request_id="req-1", allow_permanent=False)

        ctx = FakeCtx({"allow_permanent_choices": True})
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))

        refused = ctx.call("bot_context_respond", {"request_id": "req-1", "choice": "always"})
        assert refused["code"] == "invalid_choice"
        assert entry.result is None

        entry.data["allow_permanent"] = True
        allowed = ctx.call("bot_context_respond", {"request_id": "req-1", "choice": "always"})
        assert allowed["ok"] is True
        assert entry.result == "always"

    def test_missing_session_key_cannot_be_answered(self, plugin, bot_home):
        ctx = FakeCtx()
        plugin.register(ctx)
        activity = plugin.build_activity(
            _payload(session_key="", request_id="req-x"),
            context=_bot_context(plugin, bot_home, session_key="", session_id=""),
        )
        plugin._ledger(ctx).record(activity)

        body = ctx.call("bot_context_respond", {"request_id": "req-x", "choice": "once"})
        assert body["ok"] is False and body["code"] == "missing_context"

    def test_raising_resolver_is_reported_not_swallowed(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        import tools.approval as approval_tools
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))

        def boom(*a, **kw):
            raise RuntimeError("queue corrupt")

        monkeypatch.setattr(approval_tools, "resolve_gateway_approval", boom)
        body = ctx.call("bot_context_respond", {"request_id": "req-1", "choice": "once"})
        assert body["ok"] is False and body["code"] == "resolution_failed"
        assert body["detail"]["exception"] == "RuntimeError"

    def test_activity_history_survives_a_restart(self, plugin, bot_home, tmp_path):
        ctx = FakeCtx()
        plugin.register(ctx)
        ledger = plugin._ledger(ctx)
        activity = plugin.build_activity(_payload(), context=_bot_context(plugin, bot_home))
        ledger.record(activity)
        ledger.settle("req-1", status="approved", choice="once", by="test")

        # A new ledger pointed at the same plugin-data dir reads the durable log.
        from plugins.plugin_storage import plugin_data_dir
        fresh = plugin.Ledger(store_dir=plugin_data_dir("bot-context"))
        rows = fresh.recent(limit=10)
        assert [r.activity_id for r in rows] == ["req-1"]
        assert rows[0].context.profile == "atlas"


# ── permissions ─────────────────────────────────────────────────────────────
class TestPermissions:
    def _activity(self, plugin, home: Path, *, session_key="sess-1"):
        activity = plugin.build_activity(
            _payload(session_key=session_key, request_id="req-1"),
            context=_bot_context(plugin, home, session_key=session_key),
        )
        return activity

    def test_operator_profile_may_answer_a_bots_activity(self, plugin, bot_home):
        activity = self._activity(plugin, bot_home)
        caller = plugin.resolve_bot_context(session_key="operator-session", session_id="op")
        allowed, why = plugin.ap.permission_check(activity, caller, answer_scope="user")
        assert allowed is True, why

    def test_a_bot_may_not_answer_its_own_activity(self, plugin, bot_home):
        # Launch profile is the tmp root; the caller and the blocked bot are both atlas.
        activity = self._activity(plugin, bot_home)
        caller = plugin.resolve_bot_context(profile_home=str(bot_home),
                                            session_key="sess-1", session_id="sid-1")
        allowed, why = plugin.ap.permission_check(activity, caller, answer_scope="user")
        assert allowed is False
        assert "self-approval" in why

    def test_a_bot_may_not_answer_another_bot_under_user_scope(self, plugin, bot_home, tmp_path):
        other = tmp_path / "root" / "profiles" / "beta"
        other.mkdir(parents=True)
        activity = self._activity(plugin, bot_home)
        caller = plugin.resolve_bot_context(profile_home=str(other),
                                            session_key="sess-9", session_id="sid-9")
        allowed, why = plugin.ap.permission_check(activity, caller, answer_scope="user")
        assert allowed is False and "not the operator" in why

    def test_same_profile_scope_permits_automation_deliberately(self, plugin, bot_home):
        activity = self._activity(plugin, bot_home)
        caller = plugin.resolve_bot_context(profile_home=str(bot_home),
                                            session_key="sess-1", session_id="sid-1")
        assert plugin.ap.permission_check(activity, caller, answer_scope="user")[0] is False
        assert plugin.ap.permission_check(activity, caller, answer_scope="same_profile")[0] is True
        assert plugin.ap.permission_check(activity, caller, answer_scope="any")[0] is True

    def test_unknown_scope_falls_back_to_the_safest_one(self, plugin):
        assert plugin.ap.normalize_scope("everyone") == "user"
        assert plugin.ap.normalize_scope(None) == "user"
        assert plugin.ap.normalize_scope(" ANY ") == "any"

    def test_respond_refuses_through_the_tool_surface(self, plugin, bot_home, monkeypatch):
        """A bot asking on its own session gets a refusal and the prompt stays pending."""
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        monkeypatch.setenv("HERMES_SESSION_KEY", "sess-1")
        monkeypatch.setenv("HERMES_SESSION_ID", "sid-1")
        _queue("sess-1", request_id="req-1")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_payload(session_key="sess-1", request_id="req-1"))

        body = ctx.call("bot_context_respond", {"request_id": "req-1", "choice": "once"})
        assert body["ok"] is False and body["code"] == "insufficient_permission"
        assert ctx.call("bot_context_activities", {})["count"] == 1  # still pending


# ── stock-host compatibility and session isolation ──────────────────────────
class TestStockHostCompatibility:
    """Stock Nous main does not put ``request_id`` on the approval hook payload.

    The fork's core branch did. These tests use the stock shape, so the plugin
    must discover the id from the live queue rather than depend on a patched
    host.
    """

    def test_hook_without_request_id_discovers_the_live_queue_entry(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        entry = _queue("sess-1", request_id="host-req-9")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_stock_payload())

        rows = ctx.call("bot_context_activities", {})["activities"]
        assert len(rows) == 1
        assert rows[0]["activity_id"] == "host-req-9"
        assert rows[0]["answerable"] is True
        assert rows[0]["source"] == "gateway"

        body = ctx.call("bot_context_respond", {"request_id": "host-req-9", "choice": "once"})
        assert body["ok"] is True
        assert entry.result == "once"

    def test_explicit_request_id_is_still_trusted(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="host-req-9")

        ctx = FakeCtx()
        plugin.register(ctx)
        payload = _stock_payload()
        payload["request_id"] = "explicit-id"
        ctx.fire("pre_approval_request", **payload)

        assert ctx.call("bot_context_activities", {})["activities"][0]["activity_id"] == "explicit-id"

    def test_activities_are_filtered_by_session(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="req-1")
        _queue("sess-2", request_id="req-2", command="git push --force")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_stock_payload("sess-1"))
        ctx.fire("pre_approval_request", **_stock_payload("sess-2", command="git push --force"))

        only_one = ctx.call("bot_context_activities", {"session_key": "sess-1"})
        assert [row["activity_id"] for row in only_one["activities"]] == ["req-1"]
        assert only_one["count"] == 1

        other = ctx.call("bot_context_activities", {"session_key": "sess-2"})
        assert [row["activity_id"] for row in other["activities"]] == ["req-2"]

    def test_sessions_summary_keeps_sessions_separate(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="req-1")
        _queue("sess-2", request_id="req-2", command="git push --force")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_stock_payload("sess-1"))
        ctx.fire("pre_approval_request", **_stock_payload("sess-2", command="git push --force"))

        body = ctx.call("bot_context_activities", {})
        keys = {row["session_key"] for row in body["sessions"]}
        assert keys == {"sess-1", "sess-2"}

    def test_session_end_by_key_settles_its_activities(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="req-1")
        _queue("sess-2", request_id="req-2", command="git push --force")

        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("pre_approval_request", **_stock_payload("sess-1"))
        ctx.fire("pre_approval_request", **_stock_payload("sess-2", command="git push --force"))
        ctx.fire("on_session_end", session_key="sess-1")

        remaining = ctx.call("bot_context_activities", {})["activities"]
        assert [row["activity_id"] for row in remaining] == ["req-2"]


class TestSubagents:
    def test_start_and_stop_keep_the_receipt_under_its_parent_session(self, plugin):
        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire(
            "subagent_start",
            parent_session_id="sess-1",
            parent_turn_id="turn-1",
            child_subagent_id="sa-1",
            child_session_id="child-1",
            child_goal="Research the API contract",
            child_role="leaf",
        )
        ctx.fire(
            "subagent_stop",
            parent_session_id="sess-1",
            child_session_id="child-1",
            child_status="completed",
            child_summary="Read the OpenAPI file and found two endpoints.",
            duration_ms=1200,
            tool_call_history=[
                {"tool_name": "read_file", "targets": {"path": "docs/openapi.yaml"}, "status": "ok"},
                {"tool_name": "grep", "targets": {"pattern": "v2/orders"}, "status": "ok"},
            ],
        )

        body = ctx.call("bot_context_subagents", {"session_id": "sess-1"})
        assert body["count"] == 1
        row = body["subagents"][0]
        assert row["goal"] == "Research the API contract"
        assert row["status"] == "succeeded"
        assert row["summary"].startswith("Read the OpenAPI")
        assert [step["tool"] for step in row["tool_calls"]] == ["read_file", "grep"]
        assert row["duration_ms"] == 1200
        # Another parent session sees none of it.
        assert ctx.call("bot_context_subagents", {"session_id": "sess-2"})["count"] == 0

    def test_stop_without_start_is_still_a_receipt(self, plugin):
        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire(
            "subagent_stop",
            parent_session_id="sess-1",
            child_session_id="child-9",
            child_status="failed",
            child_summary="Timed out after 60s",
            duration_ms=60000,
        )
        row = ctx.call("bot_context_subagents", {"session_id": "sess-1"})["subagents"][0]
        assert row["status"] == "failed"
        assert row["summary"] == "Timed out after 60s"

    def test_session_end_cancels_running_children(self, plugin):
        ctx = FakeCtx()
        plugin.register(ctx)
        ctx.fire("subagent_start", parent_session_id="sess-1", child_subagent_id="sa-1",
                 child_session_id="child-1", child_goal="Still working")
        ctx.fire("on_session_end", session_key="sess-1")
        row = ctx.call("bot_context_subagents", {"session_id": "sess-1"})["subagents"][0]
        assert row["status"] == "cancelled"
        assert "session ended" in row["error"]

    def test_rpc_lists_subagents_for_one_parent(self, plugin):
        class Server:
            def __init__(self):
                self.methods = {}

            def register_method(self, name, fn):
                self.methods[name] = fn

        ctx = FakeCtx()
        plugin.register(ctx)
        server = Server()
        plugin.rpc.install(server, ctx)
        ctx.fire("subagent_start", parent_session_id="sess-1", child_subagent_id="sa-1",
                 child_session_id="child-1", child_goal="Check logs")
        body = server.methods["bot_context.subagents"](1, {"session_id": "sess-1"})
        assert body["result"]["count"] == 1
        assert body["result"]["subagents"][0]["goal"] == "Check logs"


# ── portability: settings, rebinding, clean install ─────────────────────────
class TestPortableSettings:
    def test_missing_optional_settings_use_the_safe_defaults(self, plugin):
        ctx = FakeCtx()
        settings = plugin._settings(ctx)
        assert settings == {
            "answer_scope": "user",
            "allow_permanent": False,
            "max_pending": 200,
            "retention_days": 3.0,
            "approval_ttl_seconds": 3600.0,
        }

    def test_malformed_settings_fall_back_instead_of_raising(self, plugin):
        ctx = FakeCtx({"max_pending": "lots", "retention_days": "forever",
                       "approval_ttl_seconds": [], "allow_permanent_choices": "maybe"})
        settings = plugin._settings(ctx)
        assert settings["max_pending"] == 200
        assert settings["retention_days"] == 3.0
        assert settings["approval_ttl_seconds"] == 3600.0
        assert settings["allow_permanent"] is False

    def test_existing_user_config_is_read_by_the_standalone_cli(self, plugin, monkeypatch):
        import hermes_cli.config as config_mod

        monkeypatch.setattr(config_mod, "load_config_readonly", lambda: {
            "plugins": {"entries": {"bot-context": {"settings": {
                "answer_scope": "same_profile",
                "allow_permanent_choices": True,
                "max_pending": 7,
            }}}}
        })
        settings = plugin._config_settings()
        assert settings["answer_scope"] == "same_profile"
        assert settings["allow_permanent_choices"] is True
        assert settings["max_pending"] == 7

    def test_env_override_is_cli_only_and_documented(self, plugin, monkeypatch):
        import hermes_cli.config as config_mod
        monkeypatch.setattr(config_mod, "load_config_readonly", dict)
        monkeypatch.setenv("HERMES_BOT_CONTEXT_ANSWER_SCOPE", "any")
        monkeypatch.setenv("HERMES_BOT_CONTEXT_ALLOW_PERMANENT", "1")
        settings = plugin._config_settings()
        assert settings["answer_scope"] == "any"
        assert settings["allow_permanent_choices"] is True

    def test_settings_apply_without_a_restart(self, plugin):
        ctx = FakeCtx({"max_pending": 1})
        plugin.register(ctx)
        ledger = plugin._ledger(ctx)
        assert ledger.diagnostics()["max_pending"] == 1

        ctx.settings["max_pending"] = 5
        again = plugin._ledger(ctx)
        assert again is ledger
        assert again.diagnostics()["max_pending"] == 5

    def test_a_profile_switch_rebinds_the_store_and_drops_other_profiles(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        ctx = FakeCtx()
        plugin.register(ctx)
        _queue("sess-1", request_id="req-1")
        ctx.fire("pre_approval_request", **_stock_payload("sess-1"))
        assert ctx.call("bot_context_activities", {})["count"] == 1

        other = Path(os.environ["HERMES_HOME"]).parent / "other-home"
        other.mkdir()
        monkeypatch.setenv("HERMES_HOME", str(other))
        assert ctx.call("bot_context_activities", {})["count"] == 0
        assert plugin._ledger(ctx).store_path.startswith(str(other))


class TestGatewayRpcSurface:
    def test_methods_install_and_read_one_session(self, plugin, bot_home, monkeypatch):
        import tui_gateway.session_registry as registry
        monkeypatch.setattr(registry, "_find_live_session_by_key",
                            lambda key: ("sid-1", {"profile_home": str(bot_home)}))
        _queue("sess-1", request_id="req-1")

        class Server:
            def __init__(self):
                self.methods = {}

            def register_method(self, name, fn):
                self.methods[name] = fn

        ctx = FakeCtx()
        plugin.register(ctx)
        server = Server()
        plugin.rpc.install(server, ctx)
        assert set(server.methods) == set(plugin.rpc.METHODS)

        ctx.fire("pre_approval_request", **_stock_payload("sess-1"))
        listed = server.methods["bot_context.activities"](1, {"session_key": "sess-1"})
        assert listed["result"]["count"] == 1
        sessions = server.methods["bot_context.sessions"](2, {})
        assert sessions["result"]["sessions"][0]["session_key"] == "sess-1"

    def test_deferred_install_is_safe_without_a_gateway(self, plugin):
        if "tui_gateway.server" in sys.modules:
            pytest.skip("another test already imported the gateway server")
        ctx = FakeCtx()
        finders = [f for f in sys.meta_path if isinstance(f, plugin.rpc._AfterServerImport)]
        try:
            # No tui_gateway.server imported in this process: arming must not raise.
            plugin.rpc.install_when_available(ctx)
            assert any(isinstance(f, plugin.rpc._AfterServerImport) for f in sys.meta_path)
        finally:
            for finder in [f for f in sys.meta_path if isinstance(f, plugin.rpc._AfterServerImport)]:
                sys.meta_path.remove(finder)
            for finder in finders:
                sys.meta_path.insert(0, finder)


def _run_in_clean_home(script: str, *, source_root: Path, extra_env: dict | None = None,
                       config_text: str | None = None) -> dict:
    """Run a small script in a fresh HERMES_HOME with the plugin installed as a user plugin."""
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        home = Path(td) / "hermes"
        home.mkdir()
        (home / "plugins").mkdir()
        shutil.copytree(source_root, home / "plugins" / "bot-context")
        (home / "config.yaml").write_text(
            config_text or "plugins:\n  enabled: [bot-context]\n", encoding="utf-8")
        env = dict(os.environ)
        env.update({
            "HERMES_HOME": str(home),
            "HERMES_CONFIG": str(home / "config.yaml"),
            "PYTHONPATH": str(source_root.parents[1]),
            "PYTHONDONTWRITEBYTECODE": "1",
        })
        if extra_env:
            env.update(extra_env)
        proc = subprocess.run(
            [sys.executable, "-c", textwrap.dedent(script)],
            cwd=td, env=env, capture_output=True, text=True, timeout=120, check=False,
        )
        assert proc.returncode == 0, proc.stderr
        return json.loads(proc.stdout.strip().splitlines()[-1])


class TestCleanInstallAndSharedPath:
    def test_clean_install_loads_as_a_user_plugin(self):
        result = _run_in_clean_home(
            """
            import json
            from hermes_cli import plugins as p
            m = p.PluginManager()
            m.discover_and_load()
            row = m._plugins.get("bot-context")
            print(json.dumps({
                "source": row.manifest.source if row else None,
                "enabled": bool(row and row.enabled),
                "tools": sorted(getattr(row, "tools_registered", [])),
                "hooks": sorted(getattr(row, "hooks_registered", [])),
                "error": row.error if row else "not found",
            }))
            """,
            source_root=PLUGIN_DIR,
        )
        assert result["source"] == "user"
        assert result["enabled"] is True
        assert set(result["tools"]) == {
            "bot_context_resolve", "bot_context_activities",
            "bot_context_respond", "bot_context_history", "bot_context_subagents",
        }
        assert {"pre_approval_request", "post_approval_response", "on_session_end"} <= set(result["hooks"])

    def test_clean_install_with_no_optional_settings(self):
        result = _run_in_clean_home(
            """
            import json
            from hermes_cli import plugins as p
            m = p.PluginManager()
            m.discover_and_load()
            mod = m._plugins["bot-context"].module
            print(json.dumps({"settings": mod._config_settings()}))
            """,
            source_root=PLUGIN_DIR,
        )
        assert result["settings"] == {}

    def test_clean_install_reads_an_existing_user_configuration(self):
        result = _run_in_clean_home(
            """
            import json
            from hermes_cli import plugins as p
            m = p.PluginManager()
            m.discover_and_load()
            mod = m._plugins["bot-context"].module
            print(json.dumps({"settings": mod._config_settings()}))
            """,
            source_root=PLUGIN_DIR,
            config_text=(
                "plugins:\n"
                "  enabled: [bot-context]\n"
                "  entries:\n"
                "    bot-context:\n"
                "      settings:\n"
                "        answer_scope: same_profile\n"
                "        max_pending: 7\n"
            ),
        )
        assert result["settings"]["answer_scope"] == "same_profile"
        assert result["settings"]["max_pending"] == 7

    def test_plugin_runs_against_a_stock_nous_main_checkout(self):
        """The shared path: no fork core patch, no branch checkout, no local edits.

        ``HERMES_STOCK_CHECKOUT`` names an unmodified Nous main worktree. When it
        is absent the test is skipped rather than silently passing against the
        fork.
        """
        stock = Path(os.environ.get("HERMES_STOCK_CHECKOUT", str(Path.home() / "Code" / "hermes-nous-main")))
        if not (stock / "hermes_cli" / "plugins.py").is_file():
            pytest.skip(f"stock Nous main checkout not available at {stock}")
        result = _run_in_clean_home(
            """
            import json
            from hermes_cli import plugins as p
            m = p.PluginManager()
            m.discover_and_load()
            row = m._plugins["bot-context"]
            print(json.dumps({
                "source": row.manifest.source,
                "enabled": bool(row.enabled),
                "error": row.error,
                "core": p.__file__,
            }))
            """,
            source_root=PLUGIN_DIR,
            extra_env={"PYTHONPATH": str(stock)},
        )
        assert result["enabled"] is True, result
        assert result["error"] in (None, ""), result
        assert str(stock) in result["core"]

    def test_no_fork_or_branch_paths_remain_in_the_plugin(self):
        forbidden = ("overlay/core-patches", "hermes-overlay-core", "/home/decrux", "DECRUX9812")
        for path in sorted(PLUGIN_DIR.rglob("*")):
            if not path.is_file() or path.suffix not in {".py", ".yaml", ".md"}:
                continue
            text = path.read_text(encoding="utf-8")
            for needle in forbidden:
                assert needle not in text, f"{needle!r} leaked into {path.name}"


# ── backward compatibility ──────────────────────────────────────────────────
class TestBackwardCompatibility:
    def test_core_approval_flow_is_unchanged_without_the_plugin(self, plugin):
        """The host queue resolves FIFO exactly as before; the plugin is not on the path."""
        from tools import approval

        first = _queue("plain-session", request_id="a")
        second = _queue("plain-session", request_id="b")
        assert approval.resolve_gateway_approval("plain-session", "deny") == 1
        assert first.result == "deny" and first.event.is_set()
        assert second.result is None

    def test_disabled_plugin_registers_nothing(self, plugin):
        from hermes_cli import plugins as pmod

        manager = pmod.PluginManager()
        manager.discover_and_load()
        record = manager._plugins.get("bot-context")
        assert record is not None and not record.enabled
        # No hooks, no tools: the registry never learned the plugin's names.
        from tools.registry import registry
        assert registry.get_entry("bot_context_respond", scope=manager.scope_key) is None
        assert not any(
            "bot-context" in str(cb) for cbs in manager._hooks.values() for cb in cbs
        )

    def test_legacy_shape_is_a_strict_subset_of_the_rich_shape(self, plugin, bot_home):
        activity = plugin.build_activity(_payload(), context=_bot_context(plugin, bot_home))
        rich = activity.to_dict()
        legacy = rich["legacy"]
        assert legacy["request_id"] == rich["activity_id"]
        assert legacy["command"] == rich["command"]
        assert legacy["choices"] == rich["choices"]
        assert json.loads(json.dumps(rich, default=str))  # JSON-serialisable end to end

    def test_plugin_reports_its_own_degraded_state(self, plugin):
        ctx = FakeCtx()
        plugin.register(ctx)
        body = ctx.call("bot_context_activities", {})
        assert "store" in body
        assert body["store"]["max_pending"] >= 1
        assert body["store"]["write_failures"] == 0
