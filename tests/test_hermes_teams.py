"""hermes-teams: roles, templates and team runs written into a real Kanban board."""

import importlib.util
import sys
import types
from pathlib import Path

import pytest

PLUGIN = Path(__file__).resolve().parents[1] / "plugins" / "hermes-teams"


def _load():
    name = "hermes_plugins.hermes_teams"
    if name in sys.modules:
        return sys.modules[name]
    sys.modules.setdefault("hermes_plugins", types.ModuleType("hermes_plugins")).__path__ = []
    spec = importlib.util.spec_from_file_location(name, PLUGIN / "__init__.py", submodule_search_locations=[str(PLUGIN)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def home(tmp_path, monkeypatch):
    root = tmp_path / ".hermes"
    root.mkdir()
    (root / "config.yaml").write_text("model:\n  default: test/model\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setenv("HERMES_KANBAN_HOME", str(root))
    return root


@pytest.fixture
def server(home):
    from tui_gateway import server as srv

    plugin = _load()
    plugin._installed = False
    plugin.register(None)
    return srv


def _call(srv, method, **params):
    return srv.handle_request({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})


def test_methods_register_and_long_ones_run_off_the_reader(server):
    for name in ("teams.roles.list", "teams.roles.ensure", "teams.templates.list",
                 "teams.run.start", "teams.run.list", "teams.run.get", "teams.run.message"):
        assert name in server._methods, name
    assert {"teams.roles.ensure", "teams.run.start"} <= server._LONG_HANDLERS


def test_template_validation_rejects_bad_graphs(home):
    _load()
    catalog = importlib.import_module("hermes_plugins.hermes_teams.catalog")
    step = lambda key, needs=(), final=False: {"key": key, "role": "analyst", "needs": list(needs), "final": final}
    with pytest.raises(catalog.TeamsError, match="cycle"):
        catalog.template_from_dict("t", {"name": "T", "steps": [step("a", ["b"]), step("b", ["a"], True)]})
    with pytest.raises(catalog.TeamsError, match="unknown needs"):
        catalog.template_from_dict("t", {"name": "T", "steps": [step("a", ["zzz"], True)]})
    with pytest.raises(catalog.TeamsError, match="exactly one step must be final"):
        catalog.template_from_dict("t", {"name": "T", "steps": [step("a"), step("b")]})


def test_user_yaml_template_replaces_builtin(server, home):
    folder = home / "teams" / "templates"
    folder.mkdir(parents=True)
    (folder / "feature.yaml").write_text(
        "name: Tiny feature\nsteps:\n  - {key: build, role: developer, final: true}\n", encoding="utf-8")
    listed = _call(server, "teams.templates.list")["result"]["templates"]
    feature = next(t for t in listed if t["id"] == "feature")
    assert feature["name"] == "Tiny feature" and not feature["builtin"]
    assert [s["key"] for s in feature["steps"]] == ["build"]


def test_run_refuses_teammates_without_a_profile(server):
    out = _call(server, "teams.run.start", template="feature", goal="Add a flag")
    assert out["error"]["code"] == 4130
    assert "team-analyst" in out["error"]["message"]


def test_feature_run_gates_steps_and_carries_messages(server, home):
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_connect as kbc

    out = _call(server, "teams.run.start", template="feature", goal="Add a --dry-run flag", create_missing=True)
    assert "result" in out, out
    run = out["result"]["run"]
    lanes = {lane["key"]: lane for lane in run["lanes"]}
    assert list(lanes) == ["plan", "build", "tests", "review"]
    assert lanes["plan"]["status"] == "ready"
    assert {lanes[k]["status"] for k in ("build", "tests", "review")} == {"todo"}
    assert lanes["review"]["final"] and lanes["build"]["profile"] == "team-developer"
    assert run["state"] == "queued" and (run["done"], run["total"]) == (0, 4)
    assert (Path(home) / "profiles" / "team-reviewer" / "SOUL.md").read_text().startswith("# Reviewer")

    with kbc.connect_closing() as conn:
        kb.complete_task(conn, lanes["plan"]["task_id"], summary="Plan: add the flag in cli.py")
    run = _call(server, "teams.run.get", run_id=run["id"])["result"]["run"]
    lanes = {lane["key"]: lane for lane in run["lanes"]}
    assert lanes["plan"]["status"] == "done"
    assert lanes["build"]["status"] == lanes["tests"]["status"] == "ready"
    assert lanes["review"]["status"] == "todo"

    sent = _call(server, "teams.run.message", run_id=run["id"], step="build", body="Keep it behind config")
    assert "result" in sent, sent
    with kbc.connect_closing() as conn:
        bodies = [c.body for c in kb.list_comments(conn, lanes["build"]["task_id"])]
    assert "Keep it behind config" in bodies

    listed = _call(server, "teams.run.list")["result"]["runs"]
    assert [r["id"] for r in listed] == [run["id"]] and listed[0]["done"] == 1


def test_get_refuses_a_task_that_is_not_a_run(server):
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_connect as kbc

    with kbc.connect_closing() as conn:
        task = kb.create_task(conn, title="plain card")
    out = _call(server, "teams.run.get", run_id=task)
    assert out["error"]["code"] == 4130
