"""Session-scoped subagent ledger for the Bot Mode activity feed.

Hermes already emits ``subagent_start`` / ``subagent_stop`` with the parent
session, the child goal, its terminal summary and the child's tool history.
Bot Mode needs the same evidence pinned to ONE parent session, so this module
keeps a small, bounded, process-local index (the live handle is process-local
by nature) and never guesses a parent when the host did not send one.

Records are intentionally ephemeral: after a gateway restart the children are
gone with the process, so keeping them would only offer a dead row. The
plugin-data directory keeps approval decisions, not live child handles.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping

_STATUS = {
    "completed": "succeeded",
    "success": "succeeded",
    "failed": "failed",
    "error": "failed",
    "timeout": "failed",
    "interrupted": "cancelled",
    "cancelled": "cancelled",
    "canceled": "cancelled",
    "queued": "queued",
    "running": "running",
}

_MAX_STEPS = 24
_MAX_RECORDS = 500
_MAX_TEXT = 2000


def _text(value: Any, limit: int = _MAX_TEXT) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit] if len(text) > limit else text


def _status(value: Any, default: str = "running") -> str:
    return _STATUS.get(str(value or "").strip().lower(), default)


def _time(value: Any, default: float | None = None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default if default is not None else time.time()
    return number if number > 0 else (default if default is not None else time.time())


@dataclass
class SubagentRecord:
    subagent_id: str
    parent_session_id: str
    session_id: str = ""
    parent_subagent_id: str = ""
    goal: str = ""
    role: str = ""
    status: str = "running"
    started_at: float = field(default_factory=time.time)
    stopped_at: float | None = None
    summary: str = ""
    duration_ms: int | None = None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "subagent_id": self.subagent_id,
            "parent_session_id": self.parent_session_id,
            "session_id": self.session_id,
            "parent_subagent_id": self.parent_subagent_id or None,
            "goal": self.goal,
            "role": self.role,
            "status": self.status,
            "started_at": self.started_at,
            "stopped_at": self.stopped_at,
            "summary": self.summary,
            "duration_ms": self.duration_ms,
            "tool_calls": list(self.tool_calls),
            "error": self.error,
        }


class SubagentLedger:
    """Thread-safe, bounded, session-indexed subagent records."""

    def __init__(self, *, max_records: int = _MAX_RECORDS, now=None):
        self._lock = threading.RLock()
        self._records: dict[str, SubagentRecord] = {}
        self._max_records = max(1, int(max_records))
        self._now = now or time.time

    def start(self, payload: Mapping[str, Any]) -> SubagentRecord | None:
        parent = _text(payload.get("parent_session_id"), 200)
        subagent_id = _text(payload.get("child_subagent_id"), 200)
        session_id = _text(payload.get("child_session_id"), 200)
        if not parent:
            return None
        if not subagent_id:
            subagent_id = session_id or f"{parent}:{int(self._now() * 1000)}"
        with self._lock:
            existing = self._records.get(subagent_id)
            record = existing or SubagentRecord(
                subagent_id=subagent_id,
                parent_session_id=parent,
                started_at=_time(payload.get("started_at"), self._now()),
            )
            record.parent_session_id = parent
            record.session_id = session_id or record.session_id
            record.parent_subagent_id = _text(payload.get("parent_subagent_id"), 200)
            record.goal = _text(payload.get("child_goal")) or record.goal
            record.role = _text(payload.get("child_role"), 80) or record.role
            record.status = _status(payload.get("child_status"), "running")
            record.stopped_at = None if record.status in ("running", "queued") else record.stopped_at
            self._records[subagent_id] = record
            self._trim()
            return record

    def stop(self, payload: Mapping[str, Any]) -> SubagentRecord | None:
        parent = _text(payload.get("parent_session_id"), 200)
        session_id = _text(payload.get("child_session_id"), 200)
        subagent_id = _text(payload.get("child_subagent_id"), 200)
        with self._lock:
            record = self._match(parent, subagent_id, session_id)
            if record is None:
                # A stop can arrive for a child whose start hook was dropped
                # (older host/build). Keep the receipt instead of losing it.
                if not parent:
                    return None
                record = SubagentRecord(
                    subagent_id=subagent_id or session_id or f"{parent}:{int(self._now() * 1000)}",
                    parent_session_id=parent,
                    session_id=session_id,
                    started_at=_time(payload.get("started_at"), self._now()),
                )
                self._records[record.subagent_id] = record
            record.status = _status(payload.get("child_status"), "succeeded")
            record.summary = _text(payload.get("child_summary")) or record.summary
            record.duration_ms = _int(payload.get("duration_ms"))
            record.stopped_at = self._now()
            if record.status == "failed":
                record.error = _text(payload.get("child_summary"), 500)
            record.tool_calls = _steps(payload.get("tool_call_history"))
            self._trim()
            return record

    def list(self, *, parent_session_id: str | None = None,
             session_id: str | None = None) -> list[SubagentRecord]:
        with self._lock:
            rows = list(self._records.values())
        if parent_session_id:
            rows = [row for row in rows if row.parent_session_id == parent_session_id]
        if session_id:
            rows = [row for row in rows if row.session_id == session_id]
        return sorted(rows, key=lambda row: (row.started_at, row.subagent_id))

    def finish_session(self, session_id: str) -> int:
        changed = 0
        with self._lock:
            for record in self._records.values():
                if record.parent_session_id == session_id and record.status in ("running", "queued"):
                    record.status = "cancelled"
                    record.stopped_at = self._now()
                    record.error = "the parent session ended"
                    changed += 1
        return changed

    def reset(self) -> None:
        with self._lock:
            self._records.clear()

    def _match(self, parent: str, subagent_id: str, session_id: str) -> SubagentRecord | None:
        if subagent_id and subagent_id in self._records:
            return self._records[subagent_id]
        for record in self._records.values():
            if parent and record.parent_session_id != parent:
                continue
            if session_id and record.session_id == session_id:
                return record
        return None

    def _trim(self) -> None:
        if len(self._records) <= self._max_records:
            return
        oldest = sorted(self._records.values(), key=lambda row: row.started_at)[: len(self._records) - self._max_records]
        for record in oldest:
            self._records.pop(record.subagent_id, None)


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _steps(value: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in (value if isinstance(value, (list, tuple)) else [])[:_MAX_STEPS]:
        if not isinstance(item, Mapping):
            continue
        targets = item.get("targets") if isinstance(item.get("targets"), Mapping) else {}
        out.append({
            "tool": _text(item.get("tool_name"), 120),
            "targets": {str(key): _text(val, 180) for key, val in list(targets.items())[:6]},
            "status": _text(item.get("status"), 40),
            "input_bytes": _int(item.get("input_bytes")),
            "output_bytes": _int(item.get("output_bytes")),
        })
    return out
