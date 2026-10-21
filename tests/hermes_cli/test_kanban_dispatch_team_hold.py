"""Team governance at the Kanban dispatcher: a paused or budget-exhausted teammate is not
handed NEW work, the card stays ready (nothing fails), and it flows again the moment the seat
resumes. Exercised end to end against a real team store, a real per-profile session ledger
(state.db) and the real dispatcher — no mocked gate."""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb
from hermes_cli import kanban_db_connect as kbc
from hermes_cli import kanban_db_dispatch as kbd
from tools import bot_team as bt


@pytest.fixture
def home(tmp_path, monkeypatch):
    h = tmp_path / ".hermes"
    h.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(h))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    kb.init_db()
    # the dispatcher memoizes the held set for a few seconds; tests flip state faster than that
    monkeypatch.setattr(kbd, "_TEAM_HELD_TTL", 0.0)
    return h


def _ledger(home: Path, cost: float) -> None:
    db = home / "state.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT, started_at REAL NOT NULL, "
                 "estimated_cost_usd REAL, actual_cost_usd REAL)")
    conn.execute("DELETE FROM sessions")
    conn.execute("INSERT INTO sessions VALUES ('s1', ?, ?, NULL)", (time.time(), cost))
    conn.commit()
    conn.close()


def _team(home: Path, limit: float):
    t = bt.create_team(home, name="Ops", mission="keep it running")
    bt.upsert_member(home, t["id"], profile="default", role="Operator", monthly_usd=limit)
    return t["id"]


def test_measured_spend_reads_the_profiles_own_ledger_and_ignores_last_month(home):
    conn = sqlite3.connect(home / "state.db")
    conn.execute("CREATE TABLE sessions (id TEXT, started_at REAL NOT NULL, estimated_cost_usd REAL, actual_cost_usd REAL)")
    now = time.time()
    conn.executemany("INSERT INTO sessions VALUES (?,?,?,?)", [
        ("a", now, 1.0, None),          # estimate only
        ("b", now, 9.0, 2.5),           # actual wins over the estimate
        ("old", now - 90 * 86400, 50.0, None),  # previous months never count
    ])
    conn.commit()
    conn.close()
    assert bt.month_spend_from_sessions(home, "default") == pytest.approx(3.5)
    assert bt.month_spend_from_sessions(home, "nobody") is None  # unknown is not zero


def test_exhausted_budget_holds_new_work_without_failing_it_and_resume_releases_it(home):
    tid_team = _team(home, limit=5.0)
    _ledger(home, cost=7.5)
    with kbc.connect() as conn:
        card = kb.create_task(conn, title="write report", assignee="default")
        res = kbd.dispatch_once(conn, dry_run=True)
        assert res.spawned == []
        assert [c for c, _why in res.skipped_team_held] == [card]
        assert "budget exhausted" in res.skipped_team_held[0][1]
        assert kb.get_task(conn, card).status == "ready"  # held, not failed

        # the board raises the limit: the very next tick claims it
        bt.upsert_member(home, tid_team, profile="default", monthly_usd=50)
        res = kbd.dispatch_once(conn, dry_run=True)
        assert [t for t, _a, _w in res.spawned] == [card]
        assert res.skipped_team_held == []


def test_paused_seat_takes_no_new_cards_and_non_members_are_unaffected(home):
    tid = _team(home, limit=100)
    bt.upsert_member(home, tid, profile="default", status="paused")
    with kbc.connect() as conn:
        card = kb.create_task(conn, title="x", assignee="default")
        assert kbd.dispatch_once(conn, dry_run=True).skipped_team_held[0][0] == card
        bt.upsert_member(home, tid, profile="default", status="active")
        assert [t for t, _a, _w in kbd.dispatch_once(conn, dry_run=True).spawned] == [card]


def test_a_broken_team_store_never_stops_the_board(home):
    (home / "bot-teams" / "teams").mkdir(parents=True)
    (home / "bot-teams" / "teams" / "team_x.json").write_text("{not json")
    with kbc.connect() as conn:
        card = kb.create_task(conn, title="x", assignee="default")
        assert [t for t, _a, _w in kbd.dispatch_once(conn, dry_run=True).spawned] == [card]


def test_delegated_goal_task_carries_the_why_lands_on_the_board_and_rolls_up(home):
    tid = _team(home, limit=100)
    goal = bt.upsert_goal(home, tid, title="Grow blog", owner="default")
    sub = bt.upsert_goal(home, tid, title="Ship 5 posts", parent_id=goal["id"], owner="default")

    made = bt.spawn_goal_task(home, tid, sub["id"], title="Write post 1", body="800 words on caching")
    again = bt.spawn_goal_task(home, tid, sub["id"], title="Write post 1")
    assert made["task_id"] == again["task_id"]  # idempotent per (goal, title)

    with kbc.connect() as conn:
        task = kb.get_task(conn, made["task_id"])
        assert task.assignee == "default" and task.created_by == f"team:{tid}"
        assert "keep it running → Grow blog → Ship 5 posts" in task.body  # ancestry travels with the work
        assert "800 words on caching" in task.body and "Operator" in task.body

        team = bt.get_team(home, tid)
        assert made["task_id"] in next(g for g in team["goals"] if g["id"] == sub["id"])["task_ids"]
        rolled = bt.rollup(team)
        assert rolled["goals"][goal["id"]]["total"] == 1  # child task counted in the parent's progress

        res = kbd.dispatch_once(conn, dry_run=True)
        assert [t for t, _a, _w in res.spawned] == [made["task_id"]]

        assert kb.complete_task(conn, made["task_id"], result="shipped")
    assert bt.rollup(bt.get_team(home, tid))["goals"][goal["id"]]["done"] == 1  # real board status flows up


def test_delegation_needs_a_hired_owner_and_a_real_seat(home):
    tid = _team(home, limit=100)
    goal = bt.upsert_goal(home, tid, title="g")  # no owner
    with pytest.raises(bt.TeamError, match="pick a teammate"):
        bt.spawn_goal_task(home, tid, goal["id"], title="x")
    open_seat = bt.upsert_member(home, tid, role="Designer")
    with pytest.raises(bt.TeamError, match="open"):
        bt.spawn_goal_task(home, tid, goal["id"], title="x", assignee=open_seat["slot"])
