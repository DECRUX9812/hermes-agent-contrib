"""Behavior contracts for the persisted Bot Mode computer timeline."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tui_gateway import server


@pytest.fixture
def home(tmp_path, monkeypatch):
    profile_home = tmp_path / ".hermes"
    profile_home.mkdir()
    ops_home = profile_home / "profiles" / "ops"
    ops_home.mkdir(parents=True)
    (ops_home / "config.yaml").write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(profile_home))
    monkeypatch.setattr(server, "_hermes_home", str(profile_home))
    return profile_home


def _call(session_id: str, *, limit: int | None = None):
    params = {"profile": "default", "session_id": session_id}
    if limit is not None:
        params["limit"] = limit
    return server.handle_request({
        "jsonrpc": "2.0", "id": 1, "method": "fork.computer.timeline", "params": params,
    })


def _call_record(tool_id: str, tool: str, arguments: dict) -> dict:
    return {
        "id": tool_id,
        "type": "function",
        "function": {"name": tool, "arguments": json.dumps(arguments)},
    }


def test_timeline_pairs_results_caps_details_and_returns_latest_todos(home):
    from hermes_state import SessionDB

    db = SessionDB(db_path=home / "state.db")
    db.create_session("bot-session", "desktop")
    calls = [
        _call_record("terminal-call", "terminal", {"command": "npm test"}),
        _call_record("file-call", "file_patch", {"path": "src/app.py"}),
        _call_record("browser-call", "browser_navigate", {"url": "https://sample.invalid/guide"}),
        _call_record("todo-call", "todo_list", {"todos": []}),
        _call_record("waiting-call", "process_manage", {"action": "list"}),
    ]
    db.append_message("bot-session", "assistant", "", tool_calls=calls, timestamp=100)
    db.append_message("bot-session", "tool", "x" * 5000, tool_call_id="terminal-call", timestamp=102)
    diff = "--- old\n" + ("+" + "change" * 3000 + "\n")
    db.append_message(
        "bot-session", "tool",
        json.dumps({"success": True, "path": "src/app.py", "diff": diff}),
        tool_call_id="file-call", timestamp=103,
    )
    db.append_message(
        "bot-session", "tool",
        json.dumps({"success": False, "error": "page unavailable", "url": "https://sample.invalid/guide",
                    "page_title": "Guide", "screenshot_path": "artifacts/page.png"}),
        tool_call_id="browser-call", timestamp=104,
    )
    db.append_message(
        "bot-session", "tool",
        json.dumps({"todos": [
            {"id": "task-1", "content": "Review the change", "status": "completed"},
            {"id": "task-2", "content": "Run the checks", "status": "in_progress"},
        ], "revision": 2}),
        tool_call_id="todo-call", timestamp=105,
    )
    db.close()

    response = _call("bot-session")
    assert "result" in response, response
    result = response["result"]
    steps = result["steps"]
    assert [step["id"] for step in steps] == [call["id"] for call in calls]
    assert [step["kind"] for step in steps] == ["terminal", "file", "browser", "other", "terminal"]
    assert steps[0]["title"] == "Ran npm test"
    assert steps[0]["detail"]["command"] == "npm test"
    assert len(steps[0]["detail"]["output_tail"].encode("utf-8")) <= 4096
    assert steps[0]["duration_s"] == 2.0
    assert steps[1]["title"] == "Edited src/app.py"
    assert steps[1]["detail"]["path"] == "src/app.py"
    assert len(steps[1]["detail"]["diff"].encode("utf-8")) <= 16 * 1024
    assert steps[2]["title"] == "Opened sample.invalid"
    assert steps[2]["status"] == "error"
    assert steps[2]["detail"]["page_title"] == "Guide"
    assert steps[2]["detail"]["screenshot_path"] == "artifacts/page.png"
    assert steps[-1]["status"] == "running"
    assert [todo["id"] for todo in result["todos"]] == ["task-1", "task-2"]
    assert result["todos"][1]["status"] == "in_progress"
    assert [step["index"] for step in steps] == list(range(len(steps)))

    limited = _call("bot-session", limit=2)["result"]["steps"]
    assert [step["id"] for step in limited] == ["todo-call", "waiting-call"]


def test_timeline_rejects_unknown_profile_session_pair(home, tmp_path, monkeypatch):
    response = _call("missing-session")
    assert response["error"]["code"] == 4044

    response = server.handle_request({
        "jsonrpc": "2.0", "id": 2, "method": "fork.computer.timeline",
        "params": {"profile": "ops", "session_id": "bot-session"},
    })
    assert response["error"]["code"] == 4044
