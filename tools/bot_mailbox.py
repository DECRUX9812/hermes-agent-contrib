"""Agent mailbox — structured async notes (task hand-offs with a status) between Bot
Mode agents, and between the Desktop user and an agent.

Store: one JSON file per note under ``<install root>/bot-mailbox/notes/``. The mailbox
is install-wide — the same root ``tools/bot_relay`` uses — because a note is exactly the
state that lives BETWEEN profiles: profiles stay islands, the mailbox is the bridge.

Writers: ``tools/bot_mode_dm.py`` (``message_agent`` with a ``task=`` arg writes a note
for a local target or rides one inside the relay envelope for a remote one),
``tui_gateway/methods_bot_mailbox.py::bots_mailbox.send`` (Desktop "assign task"), and
``tui_gateway/methods_bot_relay.py::bot_relay.deliver`` (upserts the sender's note onto
the target install). Status flips come from ``update_task`` (the bot-side injected tool)
and ``bots_mailbox.update`` (Desktop). A note's ``id`` is minted by the SENDER and shared
by every copy, so a relayed upsert never forks the record.
"""

from __future__ import annotations

import contextlib
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from utils import atomic_json_write

logger = logging.getLogger(__name__)

MAILBOX_DIR_NAME = "bot-mailbox"
NOTES_DIR = "notes"

NOTE_ID_PREFIX = "mbx_"

# Payload bounds — a note is a pointer to work, not the work itself. The body cap matches
# the DM cap (the DM text doubles as the note body); the payload dict stays small so a
# stray paste can't turn a roster badge into a megabyte read.
TITLE_MAX_CHARS = 200
BODY_MAX_CHARS = 16000  # tools/bot_mode_dm.py MESSAGE_MAX_CHARS — kept a literal so this
# module stays importable without the DM module's lazy deps.
PAYLOAD_MAX_BYTES = 8192

# Lifecycle. open is the only entry state; accepted is the in-flight acknowledgment;
# done/declined are terminal. update_note enforces the order — a settled note is never
# silently re-opened (write a new note instead).
NOTE_STATUSES = ("open", "accepted", "declined", "done")
_NOTE_TERMINAL = frozenset({"declined", "done"})
_NOTE_TRANSITIONS = {
    "open": frozenset({"accepted", "declined", "done"}),
    "accepted": frozenset({"done", "declined"}),
    "declined": frozenset(),
    "done": frozenset(),
}

# Settled notes age out sooner than open ones — an open note is still a promise.
SWEEP_SETTLED_SECONDS = 30 * 24 * 60 * 60
SWEEP_ANY_SECONDS = 180 * 24 * 60 * 60


def mailbox_root(root: Path | str) -> Path:
    """Install-wide mailbox dir. ``root`` is the Hermes MACHINE root (``_hermes_root`` of
    any profile home): same formula and same reasoning as ``tools.bot_relay.relay_root`` —
    a note between two bots must be visible to both sides, so per-profile storage would
    split the mailbox exactly where it needs to be shared."""
    return Path(root) / MAILBOX_DIR_NAME


def _notes_dir(root: Path | str) -> Path:
    d = mailbox_root(root) / NOTES_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def _note_path(root: Path | str, note_id: str) -> Path:
    return _notes_dir(root) / f"{note_id}.json"


def new_note_id() -> str:
    """Mint a note id — the sender owns it so a relayed copy on the target install names
    the same record (upsert key)."""
    return f"{NOTE_ID_PREFIX}{uuid.uuid4().hex[:20]}"


def _normalize_party(raw: Any) -> dict:
    """One end of a note: ``{kind, profile, handle, name, connection}``. ``kind`` is 'bot'
    or 'user'; ``connection`` is the SENDER-side connection id (opaque cross-install —
    useful for display, never for routing). Never raises."""
    if not isinstance(raw, dict):
        return {"kind": "bot"}
    return {
        k: str(raw.get(k) or "")
        for k in ("kind", "profile", "handle", "name", "connection")
        if raw.get(k)
    } or {"kind": str(raw.get("kind") or "bot")}


def _normalize_status(raw: Any) -> str:
    status = str(raw or "open").strip().lower()
    return status if status in NOTE_STATUSES else "open"


def _bounded_payload(raw: Any) -> Any:
    """payload is a free-form dict for the UI to render (links, refs, task fields). Strings
    are wrapped as {text}; anything not JSON-bounded-serializable within the cap is dropped."""
    if raw is None:
        return None
    value = raw if isinstance(raw, dict) else {"text": str(raw)}
    try:
        if len(json.dumps(value)) > PAYLOAD_MAX_BYTES:
            return None
    except (TypeError, ValueError):
        return None
    return value


def append_note(
    root: Path | str,
    *,
    to: dict,
    sender: dict,
    title: str,
    body: str = "",
    kind: str = "task",
    payload: Any = None,
    note_id: Optional[str] = None,
    created_at: Optional[float] = None,
    room: Optional[str] = None,
) -> dict:
    """Write a note; returns the stored dict. Idempotent UPSERT keyed on ``note_id``: a
    relayed copy re-delivered by a retry merges into the existing record — an existing
    note keeps its status/reply (a delivered-then-answered note is never reset to open
    by a redelivery)."""
    if not title or not str(title).strip():
        raise ValueError("title required")
    nid = str(note_id or "").strip() or new_note_id()
    existing = get_note(root, nid)
    if existing is not None:
        return existing

    now = int(time.time())
    note = {
        "id": nid,
        "kind": str(kind or "task"),
        "to": _normalize_party(to),
        "sender": _normalize_party(sender),
        "title": str(title).strip()[:TITLE_MAX_CHARS],
        "body": str(body or "")[:BODY_MAX_CHARS],
        "payload": _bounded_payload(payload),
        "status": "open",
        "reply": "",
        "created_at": int(created_at) if created_at else now,
        "updated_at": now,
    }
    if room:
        note["room"] = str(room)
    atomic_json_write(_note_path(root, nid), note)
    return note


def get_note(root: Path | str, note_id: str) -> Optional[dict]:
    try:
        data = json.loads(_note_path(root, note_id).read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) and data.get("id") else None
    except (OSError, ValueError):
        return None


def list_notes(root: Path | str, handle: Optional[str] = None) -> list[dict]:
    """Newest first. ``handle`` narrows to notes a given bot sends or receives."""
    want = str(handle or "").strip().lstrip("@").lower()
    notes: list[dict] = []
    directory = _notes_dir(root)
    try:
        paths = sorted(directory.glob(f"{NOTE_ID_PREFIX}*.json"))
    except OSError:
        return []
    for path in paths:
        try:
            note = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        if not isinstance(note, dict) or not note.get("id"):
            continue
        if want and want not in {
            str(note.get("to", {}).get("handle") or "").lower(),
            str(note.get("sender", note.get("from", {})).get("handle") or "").lower(),
        }:
            continue
        notes.append(note)
    notes.sort(key=lambda n: (-(float(n.get("created_at") or 0)), str(n.get("id") or "")))
    return notes


def update_note(root: Path | str, note_id: str, *, status: str, reply: str = "") -> dict:
    """Flip ``status`` along the lifecycle; returns the note. Raises KeyError when the note
    does not exist and ValueError on an illegal transition."""
    note = get_note(root, note_id)
    if note is None:
        raise KeyError(f"no mailbox note '{note_id}'")
    current = _normalize_status(note.get("status"))
    want = str(status or "").strip().lower()
    if want not in NOTE_STATUSES:
        raise ValueError(f"unknown status '{status}' — one of {', '.join(NOTE_STATUSES)}")
    if want != current:
        if want not in _NOTE_TRANSITIONS.get(current, frozenset()):
            raise ValueError(f"note '{note_id}' is {current} — cannot become {want}")
        note["status"] = want
        note["updated_at"] = int(time.time())
    reply = str(reply or "")[:BODY_MAX_CHARS]
    if reply:
        note["reply"] = reply
        note["updated_at"] = int(time.time())
    atomic_json_write(_note_path(root, str(note["id"])), note)
    return note


def sweep_mailbox(root: Path | str, *, now: Optional[float] = None) -> int:
    """Prune settled notes past SWEEP_SETTLED_SECONDS and any note past SWEEP_ANY_SECONDS.
    Returns the removed count; never raises."""
    now = now if now is not None else time.time()
    removed = 0
    try:
        paths = list(_notes_dir(root).glob("*.json"))
    except OSError:
        return 0
    for path in paths:
        try:
            note = json.loads(path.read_text(encoding="utf-8-sig"))
            updated = float(note.get("updated_at") or note.get("created_at") or path.stat().st_mtime)
            settled = str(note.get("status") or "") in _NOTE_TERMINAL
        except (OSError, ValueError, TypeError):
            updated = path.stat().st_mtime
            settled = False
        age = now - updated
        if age > SWEEP_ANY_SECONDS or (settled and age > SWEEP_SETTLED_SECONDS):
            with contextlib.suppress(OSError):
                path.unlink()
                removed += 1
    return removed


# ── update_task — the bot-side status door ────────────────────────────────────────────
# Injected ONLY into managed Bot Chat sessions, beside message_agent (same gate —
# turn_context calls both). The recipient of a hand-off flips the note; the sender sees
# the status next mailbox list / roster repaint.

UPDATE_TASK_TOOL_NAME = "update_task"


def update_task_tool_schema() -> dict:
    return {
        "type": "function",
        "function": {
            "name": UPDATE_TASK_TOOL_NAME,
            "description": (
                "Set the status of a mailbox task hand-off (a note whose id arrived in a "
                "'[task mbx_…]' marker on an incoming message). status: 'accepted' = you "
                "took it, 'done' = finished (put the outcome in reply), 'declined' = you "
                "won't do it (say why in reply). The sender sees the status on their "
                "roster/mailbox — you do NOT need to also message them unless the reply "
                "needs prose."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "note": {
                        "type": "string",
                        "description": "The note id from the task marker (mbx_…).",
                    },
                    "status": {
                        "type": "string",
                        "enum": ["accepted", "declined", "done"],
                        "description": "The new status for the note.",
                    },
                    "reply": {
                        "type": "string",
                        "description": "Short outcome or reason the sender reads on the note.",
                    },
                },
                "required": ["note", "status"],
            },
        },
    }


def ensure_update_task_tool(agent: Any) -> bool:
    """Inject ``update_task`` beside ``message_agent`` under the same Bot Chat gate.
    Session-stable from first turn, idempotent — prompt-cache safe like the DM tool."""
    try:
        from tools.bot_mode_dm import message_agent_authorized

        if not message_agent_authorized(agent):
            return False
        tools = getattr(agent, "tools", None)
        present = bool(tools) and any(
            isinstance(t, dict) and t.get("function", {}).get("name") == UPDATE_TASK_TOOL_NAME
            for t in tools
        )
        if not present:
            if agent.tools is None:
                agent.tools = []
            agent.tools.append(update_task_tool_schema())
        valid = getattr(agent, "valid_tool_names", None)
        if isinstance(valid, set):
            valid.add(UPDATE_TASK_TOOL_NAME)
        return True
    except Exception:  # pragma: no cover — must never break a turn
        logger.debug("ensure_update_task_tool failed", exc_info=True)
        return False


def update_task_tool(note: str = "", status: str = "", reply: str = "", agent: Any = None) -> str:
    """Flip a mailbox note's status from inside a Bot Chat. Same dispatch re-gate as
    message_agent: a forged call outside a managed Bot Chat returns a structured error."""
    from tools.bot_mode_dm import _agent_home, message_agent_authorized
    from tools.bot_mode_probe import _hermes_root

    if not message_agent_authorized(agent):
        return json.dumps({"error": "update_task is only available in a Bot Mode 'Bot Chat' session.",
                           "reason": "not_authorized"})
    root = _hermes_root(Path(_agent_home(agent)))
    note_id = str(note or "").strip()
    if not note_id:
        return json.dumps({"error": "note is required — the mbx_… id from the task marker."})
    try:
        updated = update_note(root, note_id, status=status, reply=reply)
    except KeyError:
        known = [n["id"] for n in list_notes(root)][:20]
        return json.dumps({"error": f"no mailbox note '{note_id}'", "known_notes": known})
    except ValueError as exc:
        return json.dumps({"error": str(exc)})
    return json.dumps({"ok": True, "note": updated})
