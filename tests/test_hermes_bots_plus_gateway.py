"""TEMPORARY smoke test for the hermes-bots-plus gateway plugin (not for commit)."""

import importlib.util
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1] / "plugins" / "hermes-bots-plus"


def _load_plugin():
    import types
    sys.modules.setdefault("hermes_plugins", types.ModuleType("hermes_plugins")).__path__ = []
    spec = importlib.util.spec_from_file_location(
        "hermes_plugins.hermes_bots_plus", PLUGIN / "__init__.py", submodule_search_locations=[str(PLUGIN)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_methods_register_and_round_trip(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    from tui_gateway import server

    plugin = _load_plugin()
    plugin.register(None)
    for name in ("bots_team.list", "bots_team.create", "bots_mailbox.list", "bots_mailbox.send"):
        assert name in server._methods, name
    assert "bots_mailbox.send" in server._LONG_HANDLERS

    created = server.handle_request({"jsonrpc": "2.0", "id": 1, "method": "bots_team.create",
                                     "params": {"name": "Smoke", "mission": "prove it"}})
    assert "result" in created, created
    team_id = created["result"]["team"]["id"]
    listed = server.handle_request({"jsonrpc": "2.0", "id": 2, "method": "bots_team.list", "params": {}})
    assert [t["id"] for t in listed["result"]["teams"]] == [team_id]
    member = server.handle_request({"jsonrpc": "2.0", "id": 3, "method": "bots_team.member.upsert",
                                    "params": {"team_id": team_id, "role": "Lead", "title": "Boss"}})
    assert "result" in member, member
    notes = server.handle_request({"jsonrpc": "2.0", "id": 4, "method": "bots_mailbox.list", "params": {}})
    assert notes["result"] == {"notes": []}, notes
    gone = server.handle_request({"jsonrpc": "2.0", "id": 5, "method": "bots_team.get",
                                  "params": {"team_id": "nope"}})
    assert gone["error"]["code"] == 4111, gone
