"""Behavior contracts for persisted, profile-owned Bot Mode routines."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tui_gateway import server


@pytest.fixture
def homes(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    ops_home = home / "profiles" / "ops"
    ops_home.mkdir(parents=True)
    (ops_home / "config.yaml").write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(server, "_hermes_home", str(home))
    return home, ops_home


def _call(method: str, **params):
    return server.handle_request({
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params,
    })


def _routine_rows(profile="default"):
    response = _call("fork.routines.list", profile=profile)
    assert "result" in response, response
    return response["result"]["routines"]


def test_schedule_and_watch_round_trip_and_mutate_in_place(homes):
    home, _ops_home = homes
    assert "result" in _call(
        "fork.routines.create", profile="default", name="Daily check", kind="schedule",
        schedule="every 1h", prompt="Review the current queue.",
    )
    assert "result" in _call(
        "fork.routines.create", profile="default", name="Build watch", kind="watch",
        schedule="every 15m", condition="the build on main is green",
    )

    rows = _routine_rows()
    schedule = next(row for row in rows if row["name"] == "Daily check")
    watch = next(row for row in rows if row["name"] == "Build watch")
    assert schedule["kind"] == "schedule"
    assert schedule["prompt"] == "Review the current queue."
    assert watch["kind"] == "watch"
    assert watch["condition"] == "the build on main is green"
    assert "[SILENT]" in watch["prompt"]

    # The routine discriminator and watch condition live in state.db, not a process cache.
    from hermes_state import SessionDB

    db = SessionDB(db_path=home / "state.db")
    assert json.loads(db.get_meta(f"fork.routine.{watch['id']}")) == {
        "kind": "watch", "condition": "the build on main is green",
    }
    db.close()
    assert next(row for row in _routine_rows() if row["id"] == watch["id"])["condition"] == (
        "the build on main is green")

    paused = _call("fork.routines.pause", profile="default", id=schedule["id"])
    assert paused["result"]["routines"]
    assert next(row for row in paused["result"]["routines"] if row["id"] == schedule["id"])["enabled"] is False
    resumed = _call("fork.routines.resume", profile="default", id=schedule["id"])
    assert next(row for row in resumed["result"]["routines"] if row["id"] == schedule["id"])["enabled"] is True

    updated = _call(
        "fork.routines.update", profile="default", id=watch["id"], name="Main build watch",
        condition="the release build is green",
    )
    updated_watch = next(row for row in updated["result"]["routines"] if row["id"] == watch["id"])
    assert updated_watch["id"] == watch["id"]
    assert updated_watch["name"] == "Main build watch"
    assert updated_watch["condition"] == "the release build is green"
    assert "release build is green" in updated_watch["prompt"]

    removed = _call("fork.routines.remove", profile="default", id=watch["id"])
    assert all(row["id"] != watch["id"] for row in removed["result"]["routines"])
    db = SessionDB(db_path=home / "state.db")
    assert db.get_meta(f"fork.routine.{watch['id']}") is None
    db.close()


def test_secondary_profile_owns_its_routine_store(homes):
    home, ops_home = homes
    response = _call(
        "fork.routines.create", profile="ops", name="Ops scan", kind="schedule",
        schedule="every 2h", prompt="Check the task queue.",
    )
    assert "result" in response, response
    assert [row["name"] for row in _routine_rows("ops")] == ["Ops scan"]
    assert _routine_rows("default") == []
    assert (ops_home / "cron" / "jobs.json").is_file()
    assert not (home / "cron" / "jobs.json").exists()


@pytest.mark.parametrize(
    ("method", "params"),
    [
        ("fork.routines.create", {"name": "Missing prompt", "kind": "schedule", "schedule": "every 1h"}),
        ("fork.routines.create", {"name": "Missing condition", "kind": "watch", "schedule": "every 1h"}),
        ("fork.routines.create", {"name": "Bad schedule", "kind": "schedule", "schedule": "not a schedule",
                                  "prompt": "Check the queue."}),
    ],
)
def test_invalid_routines_return_validation_error(homes, method, params):
    response = _call(method, profile="default", **params)
    assert response["error"]["code"] == 4002


def test_unknown_routine_returns_not_found(homes):
    response = _call("fork.routines.pause", profile="default", id="missing")
    assert response["error"]["code"] == 4044
