"""Kanban Squads: templates validate as graphs, and a started squad is a gated Kanban graph."""

from __future__ import annotations

from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb
from hermes_cli import kanban_db_connect as kbc
from hermes_cli import kanban_squads as sq


@pytest.fixture
def home(tmp_path, monkeypatch):
    root = tmp_path / ".hermes"
    root.mkdir()
    (root / "config.yaml").write_text("model:\n  default: test/model\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(root))
    kb.init_db()
    return root


def _step(key, needs=(), final=False):
    return {"key": key, "role": "analyst", "needs": list(needs), "final": final}


@pytest.mark.parametrize(("steps", "error"), [
    ([_step("a", ["b"]), _step("b", ["a"], True)], "cycle"),
    ([_step("a", ["zzz"], True)], "unknown needs"),
    ([_step("a"), _step("b")], "exactly one step must be final"),
    ([_step("a"), _step("a", final=True)], "unique"),
])
def test_template_graph_is_validated(steps, error):
    with pytest.raises(sq.SquadError, match=error):
        sq.template_from_dict("t", {"name": "T", "steps": steps})


def test_steps_come_out_in_dependency_order():
    template = sq.template_from_dict("t", {"name": "T", "steps": [
        _step("review", ["build"], True), _step("build", ["plan"]), _step("plan")]})
    assert [s.key for s in sq.step_order(template)] == ["plan", "build", "review"]


def test_user_yaml_replaces_a_builtin_template(home):
    folder = home / "kanban" / "squads" / "templates"
    folder.mkdir(parents=True)
    (folder / "feature.yaml").write_text(
        "name: Tiny feature\nsteps:\n  - {key: build, role: developer, final: true}\n", encoding="utf-8")
    feature = sq.templates()["feature"]
    assert feature.name == "Tiny feature" and not feature.builtin
    assert [s.key for s in feature.steps] == ["build"]


def test_assignees_refuse_teammates_without_a_profile(home):
    with pytest.raises(sq.SquadError, match="squad-analyst"):
        sq.resolve_assignees(sq.get_template("feature"), sq.roles())


def test_create_missing_makes_role_bots_with_the_role_soul(home):
    assignees = sq.resolve_assignees(sq.get_template("feature"), sq.roles(), create_missing=True)
    assert assignees == {"analyst": "squad-analyst", "developer": "squad-developer",
                         "qa": "squad-qa", "reviewer": "squad-reviewer"}
    soul = (home / "profiles" / "squad-reviewer" / "SOUL.md").read_text(encoding="utf-8")
    assert soul.startswith("# Reviewer")
    assert sq.ensure_role_bot(sq.get_role("reviewer")) == ("squad-reviewer", False)


def _start(conn, **kw):
    template = sq.get_template("feature")
    catalog = sq.roles()
    assignees = {r: catalog[r].profile for r in ("analyst", "developer", "qa", "reviewer")}
    return sq.start_run(conn, template=template, goal="Add a --dry-run flag", catalog=catalog,
                        assignees=assignees, **kw)


def test_started_squad_gates_steps_on_their_needs(home):
    with kbc.connect_closing() as conn:
        root = _start(conn)
        run = sq.run_view(conn, root)
        lanes = {lane["key"]: lane for lane in run["lanes"]}
        assert list(lanes) == ["plan", "build", "tests", "review"]
        assert lanes["plan"]["status"] == "ready"
        assert {lanes[k]["status"] for k in ("build", "tests", "review")} == {"todo"}
        assert run["state"] == "queued" and (run["done"], run["total"]) == (0, 4)

        kb.complete_task(conn, lanes["plan"]["task_id"], summary="Plan: add the flag in cli.py")
        lanes = {lane["key"]: lane for lane in sq.run_view(conn, root)["lanes"]}
        assert lanes["build"]["status"] == lanes["tests"]["status"] == "ready"
        assert lanes["review"]["status"] == "todo"
        assert set(kb.parent_ids(conn, lanes["review"]["task_id"])) >= {
            lanes["build"]["task_id"], lanes["tests"]["task_id"]}


def test_idempotent_start_returns_the_same_squad(home):
    with kbc.connect_closing() as conn:
        first = _start(conn, idempotency_key="k1")
        again = _start(conn, idempotency_key="k1")
        assert first == again
        assert [r["id"] for r in sq.list_runs(conn)] == [first]


def test_messages_reach_the_step_task(home):
    with kbc.connect_closing() as conn:
        root = _start(conn)
        sq.post_message(conn, root, body="Keep it behind config", author="you", step="build")
        sq.post_message(conn, root, body="Ship by Friday", author="you")
        run = sq.run_view(conn, root)
        build = next(lane for lane in run["lanes"] if lane["key"] == "build")
        assert "Keep it behind config" in [c.body for c in kb.list_comments(conn, build["task_id"])]
        assert [n["body"] for n in run["notes"]] == ["Ship by Friday"]
        with pytest.raises(sq.SquadError, match="no step"):
            sq.post_message(conn, root, body="x", author="you", step="nope")


def test_a_plain_task_is_not_a_squad(home):
    with kbc.connect_closing() as conn:
        task = kb.create_task(conn, title="plain card")
        with pytest.raises(sq.SquadError, match="not a squad"):
            sq.run_view(conn, task)


def test_run_state_reports_stuck_and_finished_squads():
    lane = lambda status, final=False: {"status": status, "final": final}
    assert sq.run_state([lane("done"), lane("blocked"), lane("todo", True)]) == "attention"
    assert sq.run_state([lane("running"), lane("todo", True)]) == "running"
    assert sq.run_state([lane("done"), lane("done", True)]) == "done"
