"""Real Kanban/profile integration coverage for the goal-first team board RPCs."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
from pathlib import Path

import pytest


@pytest.fixture
def team_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_KANBAN_DB", str(home / "kanban.db"))
    monkeypatch.delenv("HERMES_KANBAN_BOARD", raising=False)
    monkeypatch.setenv("HERMES_TEST_ISOLATION", "1")

    from hermes_cli.profiles import create_profile
    from hermes_cli.profiles import profile_exists

    create_profile("worker", no_alias=True, no_skills=True)
    assert profile_exists("worker")
    return home


def _rpc(method: str, params: dict, request_id: int = 1) -> dict:
    from tui_gateway import server

    return server.handle_request({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params,
    })


def _team_with_goal(home: Path, *, name: str = "Test team") -> tuple[dict, dict, dict]:
    from tools import bot_team as bt

    team = bt.create_team(home, name=name, mission="Ship a verified result")
    lead = bt.upsert_member(
        home, team["id"], profile="default", role="lead", title="Lead", lead=True,
    )
    bt.upsert_member(
        home, team["id"], profile="worker", role="engineer", title="Engineer",
        reports_to=lead["slot"],
    )
    goal = bt.upsert_goal(
        home, team["id"], title="Ship the feature", owner=lead["slot"], detail="",
    )
    return team, lead, goal


def _create_task(home: Path, title: str, *, status: str = "ready", assignee: str = "worker") -> str:
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_connect as kbc

    db_path = kb.kanban_db_path()
    with kbc.connect_closing(db_path=db_path) as conn:
        task_id = kb.create_task(
            conn, title=title, assignee=assignee, created_by="test",
            initial_status="running",
        )
        conn.execute("UPDATE tasks SET status = ? WHERE id = ?", (status, task_id))
        return task_id


def _link(home: Path, team: dict, goal: dict, task_id: str) -> None:
    from hermes_cli import kanban_db as kb
    from tools import bot_team as bt

    bt.link_task(
        home,
        team["id"],
        goal["id"],
        task_id,
        board_path=str(kb.kanban_db_path()),
    )


def _read_board(team: dict, goal: dict) -> dict:
    response = _rpc("fork.team.board", {"team_id": team["id"], "goal_id": goal["id"]})
    assert "error" not in response
    return response["result"]


def _write_usage(profile: str, session_id: str, input_tokens: int, output_tokens: int, cost: float) -> None:
    from hermes_state_registry import acquire, release_or_close
    from tools.team_board import _profile_scope

    with _profile_scope(profile) as profile_home:
        db = acquire(profile_home / "state.db")
        try:
            db.create_session(session_id, source="kanban")
            db.update_token_counts(
                session_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                actual_cost_usd=cost,
                absolute=True,
                api_call_count=1,
            )
            assert db.flush_token_counts()
        finally:
            release_or_close(db)


def test_board_uses_real_workflow_statuses_and_deduplicates_descendants(team_home):
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_connect as kbc
    from hermes_cli.kanban_workflow import DEFAULT_STATUSES

    team, _lead, goal = _team_with_goal(team_home)
    expected = {
        "triage": "queued",
        "todo": "queued",
        "ready": "queued",
        "scheduled": "queued",
        "claimed": "in_progress",
        "running": "in_progress",
        "blocked": "needs_approval",
        "review": "needs_approval",
        "done": "done",
        "archived": "done",
    }
    assert DEFAULT_STATUSES <= expected.keys()

    ids = {}
    for status in DEFAULT_STATUSES:
        task_id = _create_task(team_home, f"status-{status}")
        with kbc.connect_closing(db_path=kb.kanban_db_path()) as conn:
            conn.execute("UPDATE tasks SET status = ? WHERE id = ?", (status, task_id))
        ids[task_id] = status
        _link(team_home, team, goal, task_id)

    child = _create_task(team_home, "child")
    grandchild = _create_task(team_home, "grandchild")
    ready_parent = next(task_id for task_id, status in ids.items() if status == "ready")
    with kbc.connect_closing(db_path=kb.kanban_db_path()) as conn:
        kb.link_tasks(conn, ready_parent, child)
        kb.link_tasks(conn, child, grandchild)
        conn.execute("UPDATE tasks SET status = 'todo' WHERE id = ?", (child,))
        conn.execute("UPDATE tasks SET status = 'done' WHERE id = ?", (grandchild,))
    _link(team_home, team, goal, child)

    result = _read_board(team, goal)
    cards = result["cards"]
    by_status = {status: next(card for card in cards if card["status"] == status) for status in DEFAULT_STATUSES}
    assert {
        status: by_status[status]["column"] for status in DEFAULT_STATUSES
    } == {status: expected[status] for status in DEFAULT_STATUSES}
    assert len(cards) == len(DEFAULT_STATUSES) + 2
    assert len({card["task_id"] for card in cards}) == len(cards)
    assert result["totals"]["queued"] == sum(expected[s] == "queued" for s in DEFAULT_STATUSES) + 1
    assert result["totals"]["done"] == sum(expected[s] == "done" for s in DEFAULT_STATUSES) + 1
    assert {status: by_status[status]["needs_you"] for status in ("triage", "blocked", "review")} == {
        "triage": "question",
        "blocked": "blocked",
        "review": "review",
    }
    assert result["totals"]["needs_you"] == sum(card["needs_you"] is not None for card in cards)


def test_goal_start_is_idempotent_and_reports_validation_errors(team_home):
    from tools import bot_team as bt
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_connect as kbc

    team, _lead, _goal = _team_with_goal(team_home)
    params = {"team_id": team["id"], "title": "Build a release"}
    first = _rpc("fork.team.goal.start", params, request_id=11)
    second = _rpc("fork.team.goal.start", params, request_id=12)
    assert first["result"]["goal"]["id"] == second["result"]["goal"]["id"]
    assert first["result"]["lead_task_id"] == second["result"]["lead_task_id"]
    with kbc.connect_closing(db_path=kb.kanban_db_path()) as conn:
        lead_task = kb.get_task(conn, first["result"]["lead_task_id"])
    assert "this lead card's task id" in lead_task.body
    assert "<lead-task-id>" not in lead_task.body
    board = _read_board(team, first["result"]["goal"])
    assert board["totals"]["tokens"] == 0
    assert board["totals"]["cost_usd"] == 0.0

    no_lead = bt.create_team(team_home, name="No seated lead")
    open_lead = bt.upsert_member(
        team_home, no_lead["id"], profile=None, role="lead", title="Lead", lead=True,
    )
    bt.upsert_member(
        team_home, no_lead["id"], profile="worker", role="worker", title="Worker",
        reports_to=open_lead["slot"],
    )
    response = _rpc(
        "fork.team.goal.start",
        {"team_id": no_lead["id"], "title": "Needs a lead"},
    )
    assert response["error"]["code"] == 4131

    no_teammate = bt.create_team(team_home, name="No other teammate")
    only_lead = bt.upsert_member(
        team_home, no_teammate["id"], profile="default", role="lead", title="Lead", lead=True,
    )
    bt.upsert_goal(team_home, no_teammate["id"], title="Needs a teammate", owner=only_lead["slot"])
    response = _rpc(
        "fork.team.goal.start",
        {"team_id": no_teammate["id"], "title": "Needs a teammate"},
    )
    assert response["error"]["code"] == 4132


def test_board_reads_session_costs_from_the_run_profile(team_home):
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_connect as kbc

    team, _lead, goal = _team_with_goal(team_home)
    task_id = _create_task(team_home, "costed run")
    with kbc.connect_closing(db_path=kb.kanban_db_path()) as conn:
        assert kb.claim_task(conn, task_id)
        run = kb.latest_run(conn, task_id)
        conn.execute(
            "UPDATE task_runs SET metadata = ? WHERE id = ?",
            (json.dumps({"worker_session_id": "worker-session"}), run.id),
        )
    _write_usage("worker", "worker-session", 13, 5, 0.42)
    _write_usage("default", "worker-session", 700, 900, 19.99)
    _link(team_home, team, goal, task_id)

    result = _read_board(team, goal)
    card = next(card for card in result["cards"] if card["task_id"] == task_id)
    assert card["tokens"] == 18
    assert card["cost_usd"] == pytest.approx(0.42)
    assert result["totals"]["tokens"] == 18
    assert result["totals"]["cost_usd"] == pytest.approx(0.42)


def test_goal_task_stays_on_its_recorded_board_after_board_switch(team_home):
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_connect as kbc
    from tools import bot_team as bt

    team, lead, goal = _team_with_goal(team_home)
    original_path = kb.kanban_db_path()
    first = bt.spawn_goal_task(
        team_home,
        team["id"],
        goal["id"],
        title="Persistent board assignment",
        assignee=lead["slot"],
    )
    saved_team = bt.get_team(team_home, team["id"])
    saved_goal = next(item for item in saved_team["goals"] if item["id"] == goal["id"])
    saved_goal["task_keys"].pop("persistent-board-assignment")
    saved_goal.setdefault("task_key_boards", {})["persistent-board-assignment"] = {
        "path": str(original_path),
        "board": "default",
    }
    bt._save(team_home, saved_team)
    alternate_path = team_home / "alternate-kanban.db"
    patch = pytest.MonkeyPatch()
    patch.setenv("HERMES_KANBAN_DB", str(alternate_path))
    try:
        retry = bt.spawn_goal_task(
            team_home,
            team["id"],
            goal["id"],
            title="Persistent board assignment",
            assignee=lead["slot"],
        )
        assert retry["task_id"] == first["task_id"]
        stored_goal = bt.get_team(team_home, team["id"])["goals"][0]
        assert stored_goal["task_boards"][first["task_id"]] == str(original_path)
        with kbc.connect_closing(db_path=original_path) as conn:
            assert kb.get_task(conn, first["task_id"]) is not None
        assert not alternate_path.exists()
        result = _read_board(team, goal)
        assert any(card["task_id"] == first["task_id"] for card in result["cards"])
    finally:
        patch.undo()


def test_team_and_tool_approvals_mark_cards_needs_approval(team_home):
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_connect as kbc
    from tools import approval, bot_team as bt

    team, lead, goal = _team_with_goal(team_home)
    tool_task = _create_task(team_home, "tool approval")
    team_task = _create_task(team_home, "team approval")
    with kbc.connect_closing(db_path=kb.kanban_db_path()) as conn:
        assert kb.claim_task(conn, tool_task)
        run = kb.latest_run(conn, tool_task)
        conn.execute(
            "UPDATE task_runs SET metadata = ? WHERE id = ?",
            (json.dumps({"worker_session_id": "approval-session"}), run.id),
        )
    bt.request_approval(
        team_home,
        team["id"],
        kind="action",
        subject=team_task,
        requested_by=lead["slot"],
        payload={"task_id": team_task},
    )
    _link(team_home, team, goal, tool_task)
    _link(team_home, team, goal, team_task)

    from tools.approval_gateway_wait import _await_gateway_decision

    queued = threading.Event()
    answer = {}

    def wait_for_decision():
        answer["value"] = _await_gateway_decision(
            "approval-session",
            lambda _data: queued.set(),
            {"request_id": "board-approval", "command": "confirm", "pattern_key": "confirm"},
        )

    waiter = threading.Thread(target=wait_for_decision, daemon=True)
    waiter.start()
    try:
        assert queued.wait(timeout=10)
        result = _read_board(team, goal)
        cards = {card["task_id"]: card for card in result["cards"]}
        assert cards[team_task]["needs_you"] == "approval"
        assert cards[team_task]["column"] == "needs_approval"
        assert cards[tool_task]["needs_you"] == "approval"
        assert cards[tool_task]["column"] == "needs_approval"
    finally:
        approval.resolve_gateway_approval("approval-session", "deny")
        waiter.join(timeout=10)
    assert not waiter.is_alive()
    assert answer["value"]["resolved"] is True


def test_stop_takeover_resume_uses_fingerprint_and_preserves_session(team_home):
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_connect as kbc
    from hermes_cli import kanban_db_dispatch as kbd

    team, _lead, goal = _team_with_goal(team_home)
    task_id = _create_task(team_home, "worker process")
    process = subprocess.Popen(
        [sys.executable, "-c", "import sys; sys.stdin.read()"],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        with kbc.connect_closing(db_path=kb.kanban_db_path()) as conn:
            assert kb.claim_task(conn, task_id)
            kbd._set_worker_pid(conn, task_id, process.pid)
            run = kb.latest_run(conn, task_id)
            conn.execute(
                "UPDATE task_runs SET metadata = ? WHERE id = ?",
                (json.dumps({
                    "worker_session_id": "worker-live-session",
                    "last_tool": {"name": "execute_code", "status": "done"},
                }), run.id),
            )
        _link(team_home, team, goal, task_id)

        stopped = _rpc("fork.team.card.stop", {"task_id": task_id})
        assert stopped["result"] == {"task_id": task_id, "stopped": True, "status": "blocked"}
        assert process.wait(timeout=10) is not None

        takeover = _rpc("fork.team.card.takeover", {"task_id": task_id})
        assert takeover["result"] == {
            "session_id": "worker-live-session",
            "profile": "worker",
        }
        resumed = _rpc(
            "fork.team.card.resume",
            {"task_id": task_id, "assignee": "worker"},
        )
        assert resumed["result"]["task_id"] == task_id
        assert resumed["result"]["status"] == "ready"
        assert resumed["result"]["assignee"] == "worker"

        review_task = _create_task(team_home, "review handoff")
        with kbc.connect_closing(db_path=kb.kanban_db_path()) as conn:
            conn.execute("UPDATE tasks SET status = 'review' WHERE id = ?", (review_task,))
        _link(team_home, team, goal, review_task)
        reopened = _rpc(
            "fork.team.card.resume",
            {"task_id": review_task, "assignee": "worker"},
        )
        assert reopened["result"]["status"] == "ready"
        rejected = _rpc(
            "fork.team.card.resume",
            {"task_id": review_task, "assignee": "outside-team"},
        )
        assert rejected["error"]["code"] == 4143
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


def test_template_apply_is_idempotent_and_creates_profile_tree(team_home):
    from hermes_cli.profiles import create_profile

    listed = _rpc("fork.team.templates.list", {})
    template_ids = {template["template_id"] for template in listed["result"]["templates"]}
    assert {"full-stack-swarm", "research-report"} <= template_ids

    create_profile("fs-lead", no_alias=True, no_skills=True)
    params = {
        "request_id": "template-request-1",
        "template_id": "full-stack-swarm",
        "assign": {"qa": "worker"},
    }
    first = _rpc("fork.team.templates.apply", params, request_id=21)
    second = _rpc("fork.team.templates.apply", params, request_id=22)
    assert "error" not in first
    assert first["result"]["created"] is True
    assert second["result"]["created"] is False
    assert second["result"]["team"]["id"] == first["result"]["team"]["id"]

    team = first["result"]["team"]
    seats = {member["role"]: member for member in team["members"]}
    lead = seats["lead"]
    assert lead["profile"] == "fs-lead-2"
    assert seats["quality assurance"]["profile"] == "worker"
    assert all(
        member["reports_to"] == lead["slot"]
        for role, member in seats.items()
        if role != "lead"
    )


def test_rpc_contract_rejects_unknown_parameters(team_home):
    team, _lead, goal = _team_with_goal(team_home)
    response = _rpc(
        "fork.team.board",
        {"team_id": team["id"], "goal_id": goal["id"], "uncontracted": True},
    )
    assert response["error"]["code"] == 4000
