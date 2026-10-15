"""Behaviour contracts for fork.memory.* RPCs."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

import tui_gateway.server as srv


@pytest.fixture
def env(tmp_path, monkeypatch):
    launch = tmp_path / ".hermes"
    launch.mkdir()
    launch_mem = launch / "memories"
    launch_mem.mkdir()
    (launch_mem / "MEMORY.md").write_text("# Launch Memory\n§\n- Launch note 1", encoding="utf-8")

    profiles_dir = launch / "profiles"
    secondary = profiles_dir / "assistant-bot"
    secondary.mkdir(parents=True)
    secondary_mem = secondary / "memories"
    secondary_mem.mkdir()
    (secondary_mem / "MEMORY.md").write_text("# Bot Memory\n§\n- Bot note 1", encoding="utf-8")
    (secondary_mem / "USER.md").write_text("# Bot User Profile\n§\n- User pref 1", encoding="utf-8")

    monkeypatch.setenv("HERMES_HOME", str(launch))
    monkeypatch.setattr(srv, "_hermes_home", launch)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    return launch, secondary


def test_fork_memory_list(env):
    _launch, _secondary = env
    resp = srv._methods["fork.memory.list"](1, {"profile": "assistant-bot"})
    assert "error" not in resp, resp.get("error")
    res = resp["result"]
    assert "entries" in res
    assert "usage" in res
    assert "enabled" in res

    texts = [e["text"] for e in res["entries"]]
    assert "- Bot note 1" in texts
    assert "- User pref 1" in texts
    assert res["enabled"]["memory"] is True
    assert res["enabled"]["user"] is True
    assert res["usage"]["memory"]["limit"] > 0
    assert res["usage"]["user"]["limit"] > 0


def test_fork_memory_crud_round_trip(env):
    _launch, secondary = env
    # Add to memory
    add_resp = srv._methods["fork.memory.add"](
        2,
        {"profile": "assistant-bot", "target": "memory", "text": "- Bot note 2"},
    )
    assert "error" not in add_resp, add_resp.get("error")
    entries = add_resp["result"]["entries"]
    bot_note_2_entry = next((e for e in entries if e["text"] == "- Bot note 2"), None)
    assert bot_note_2_entry is not None
    assert bot_note_2_entry["target"] == "memory"
    item_id = bot_note_2_entry["id"]

    # Verify on disk in secondary home
    memory_content = (secondary / "memories" / "MEMORY.md").read_text(encoding="utf-8")
    assert "- Bot note 2" in memory_content

    # Update
    update_resp = srv._methods["fork.memory.update"](
        3,
        {"profile": "assistant-bot", "id": item_id, "text": "- Bot note 2 updated"},
    )
    assert "error" not in update_resp, update_resp.get("error")
    entries = update_resp["result"]["entries"]
    updated_entry = next((e for e in entries if e["text"] == "- Bot note 2 updated"), None)
    assert updated_entry is not None
    assert updated_entry["id"] != item_id  # Content sha1 changed

    memory_content = (secondary / "memories" / "MEMORY.md").read_text(encoding="utf-8")
    assert "- Bot note 2 updated" in memory_content
    # The old exact entry should no longer exist
    from tools.memory_tool_store import MemoryStore
    parsed = MemoryStore._parse_entries(memory_content)
    assert "- Bot note 2" not in parsed
    assert "- Bot note 2 updated" in parsed

    # Remove
    remove_resp = srv._methods["fork.memory.remove"](
        4,
        {"profile": "assistant-bot", "id": updated_entry["id"]},
    )
    assert "error" not in remove_resp, remove_resp.get("error")
    entries = remove_resp["result"]["entries"]
    assert not any(e["text"] == "- Bot note 2 updated" for e in entries)

    memory_content = (secondary / "memories" / "MEMORY.md").read_text(encoding="utf-8")
    assert "- Bot note 2 updated" not in memory_content


def test_fork_memory_isolation_and_environ(env):
    launch, _secondary = env
    environ_before = dict(os.environ)

    resp = srv._methods["fork.memory.add"](
        5,
        {"profile": "assistant-bot", "target": "memory", "text": "- Secondary exclusive"},
    )
    assert "error" not in resp

    # Launch MEMORY.md must be untouched
    launch_memory = (launch / "memories" / "MEMORY.md").read_text(encoding="utf-8")
    assert "- Secondary exclusive" not in launch_memory
    assert launch_memory == "# Launch Memory\n§\n- Launch note 1"

    # Environment untouched
    assert os.environ == environ_before


def test_fork_memory_stale_id_answers_4093(env):
    _launch, _secondary = env
    # Update with non-existent id
    resp_up = srv._methods["fork.memory.update"](
        6,
        {"profile": "assistant-bot", "id": "0123456789ab", "text": "Fail update"},
    )
    assert resp_up.get("error") is not None
    assert resp_up["error"]["code"] == 4093
    assert "memory item changed" in resp_up["error"]["message"]

    # Remove with non-existent id
    resp_rm = srv._methods["fork.memory.remove"](
        7,
        {"profile": "assistant-bot", "id": "0123456789ab"},
    )
    assert resp_rm.get("error") is not None
    assert resp_rm["error"]["code"] == 4093
    assert "memory item changed" in resp_rm["error"]["message"]


def test_fork_memory_over_limit_answers_4094(env):
    _launch, _secondary = env
    huge_text = "x" * 4000
    resp = srv._methods["fork.memory.add"](
        8,
        {"profile": "assistant-bot", "target": "memory", "text": huge_text},
    )
    assert resp.get("error") is not None
    assert resp["error"]["code"] == 4094
    assert "exceeds" in resp["error"]["message"].lower() or "limit" in resp["error"]["message"].lower()
