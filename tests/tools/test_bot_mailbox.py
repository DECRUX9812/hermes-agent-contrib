"""tools/bot_mailbox.py — the agent mailbox store (#48): append/list/update
round-trips, the status machine, idempotent upsert, and the update_task gate."""

import json

import pytest

from tools.bot_mailbox import (
    append_note, list_notes, mailbox_root, sweep_mailbox, update_note,
    update_task_tool, _NOTE_TRANSITIONS)


@pytest.fixture
def root(tmp_path):
    (tmp_path / "profiles" / "alice").mkdir(parents=True)
    return tmp_path


def _party(kind="bot", profile="alice", handle="alice"):
    return {"kind": kind, "profile": profile, "handle": handle}


def test_append_and_list_roundtrip(root):
    note = append_note(root, to=_party(), sender=_party("bot", "bob", "bob"), title="Summarize PR", body="see #123")
    assert note["id"].startswith("mbx_")
    assert note["status"] == "open"
    assert note["to"]["profile"] == "alice"

    notes = list_notes(root)
    assert [n["id"] for n in notes] == [note["id"]]
    # handle filter matches either party
    assert list_notes(root, "alice") == notes
    assert list_notes(root, "bob") == notes
    assert list_notes(root, "carol") == []


def test_append_is_idempotent_by_note_id(root):
    first = append_note(root, note_id="mbx_abc", to=_party(), sender=_party("bot", "bob", "bob"), title="t")
    update_note(root, "mbx_abc", status="accepted")
    # A relayed re-delivery keeps the settled status rather than re-forking open.
    again = append_note(root, note_id="mbx_abc", to=_party(), sender=_party("bot", "bob", "bob"), title="t")
    assert again["status"] == "accepted"
    assert len(list_notes(root)) == 1


def test_update_status_machine(root):
    note = append_note(root, to=_party(), sender=_party("bot", "bob", "bob"), title="t")

    with pytest.raises(ValueError):
        update_note(root, note["id"], status="bogus")
    # Re-asserting the current status is a no-op, not an error.
    assert update_note(root, note["id"], status="open")["status"] == "open"

    accepted = update_note(root, note["id"], status="accepted", reply="on it")
    assert accepted["status"] == "accepted"
    assert accepted["reply"] == "on it"

    # open → nothing once accepted except done/declined (the transition table is the rule)
    assert _NOTE_TRANSITIONS["accepted"] == {"done", "declined"}
    done = update_note(root, note["id"], status="done")
    assert done["status"] == "done"

    with pytest.raises(ValueError):
        update_note(root, note["id"], status="accepted")

    with pytest.raises(KeyError):
        update_note(root, "mbx_missing", status="done")


def test_list_newest_first(root):
    append_note(root, note_id="mbx_1", to=_party(), sender=_party("bot", "b", "b"), title="a", created_at=1)
    append_note(root, note_id="mbx_2", to=_party(), sender=_party("bot", "b", "b"), title="b", created_at=2)
    assert [n["id"] for n in list_notes(root)] == ["mbx_2", "mbx_1"]


def test_sweep_drops_old_terminal_notes(root):
    old = append_note(root, note_id="mbx_old", to=_party(), sender=_party("bot", "b", "b"), title="x",
                      created_at=1)
    update_note(root, "mbx_old", status="done")
    # age the file back past SWEEP_SETTLED_SECONDS via stored timestamps
    import time

    stale = 31 * 86400
    path = mailbox_root(root) / "notes" / "mbx_old.json"
    data = json.loads(path.read_text())
    data["updated_at"] = int(time.time()) - stale
    path.write_text(json.dumps(data))
    open_note = append_note(root, to=_party(), sender=_party("bot", "b", "b"), title="live")

    sweep_mailbox(root, now=time.time())
    assert [n["id"] for n in list_notes(root)] == [open_note["id"]]
    assert old["id"] == "mbx_old"


def test_update_task_tool_rejects_unauthorized(monkeypatch, root):
    from tools import bot_mode_dm

    monkeypatch.setattr(bot_mode_dm, "message_agent_authorized", lambda agent: False)
    out = json.loads(update_task_tool("mbx_x", "done", agent=object()))
    assert "error" in out


def test_update_task_tool_roundtrip(monkeypatch, root):
    from tools import bot_mode_dm
    import tools.bot_mode_probe as probe

    # update_task_tool imports all three lazily at call time.
    monkeypatch.setattr(bot_mode_dm, "message_agent_authorized", lambda agent: True)
    monkeypatch.setattr(bot_mode_dm, "_agent_home", lambda agent: str(root / "profiles" / "alice"))
    monkeypatch.setattr(probe, "_hermes_root", lambda home: home.parent.parent)

    note = append_note(root, to=_party(), sender=_party("bot", "bob", "bob"), title="t")
    out = json.loads(update_task_tool(note["id"], "done", reply="finished", agent=object()))
    assert out["ok"] is True
    assert out["note"]["status"] == "done"
    assert out["note"]["reply"] == "finished"

    missing = json.loads(update_task_tool("mbx_nope", "done", agent=object()))
    assert "error" in missing
    assert "known_notes" in missing
