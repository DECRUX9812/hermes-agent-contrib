"""Durable journal of gateway approval requests for SessionDB.

One row per request. A decision is recorded once: a row that is no longer pending is never rewritten. A tool
call that has run (``ran_at`` stamped) is never approved again. Each row records the process that opened it;
rows are expired only when that process is provably dead, so a live process's pending request is never touched
by another process sharing the profile's ``state.db``."""

from __future__ import annotations

import json
import os
import time
from typing import Any, Optional

from hermes_state_common import _lock_holder_provably_dead, _proc_start_ticks
from hermes_state_pidns import pid_namespace_id

PENDING = "pending"
ALLOWED = "allowed"
DENIED = "denied"
EXPIRED = "expired"
WITHDRAWN = "withdrawn"
_GRANT_CHOICES = frozenset({"once", "session", "always"})

_COLUMNS = ("request_id, session_id, tool_call_id, tool_name, command, description, created_at, status, "
            "decided_at, choice, ran_at, reason")


def _owner_record() -> str:
    pid = os.getpid()
    return json.dumps({"pid": pid, "pidns": pid_namespace_id(), "start_ticks": _proc_start_ticks(pid)},
                      sort_keys=True)


def _owner_provably_dead(owner: Optional[str]) -> bool:
    if not owner:
        return False
    try:
        record = json.loads(owner)
    except ValueError:
        return False
    return isinstance(record, dict) and _lock_holder_provably_dead(record)


class SessionForkApprovalsMixin:
    """Approval journal reads and writes; every write runs under the SessionDB write lock."""

    def record_fork_approval_request(self, request_id: str, *, session_id: str, tool_call_id: str,
                                     tool_name: str, command: str, description: str) -> Optional[dict[str, Any]]:
        if not request_id:
            return None
        owner = _owner_record()

        def _do(conn):
            conn.execute(
                "INSERT OR IGNORE INTO fork_approvals (request_id, session_id, tool_call_id, tool_name, command, "
                "description, created_at, status, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (request_id, session_id, tool_call_id or "", tool_name or "", command or "", description or "",
                 time.time(), PENDING, owner))
            row = conn.execute(f"SELECT {_COLUMNS} FROM fork_approvals WHERE request_id = ?",
                               (request_id,)).fetchone()
            return dict(row) if row is not None else None
        return self._execute_write(_do)

    def decide_fork_approval(self, request_id: str, choice: str) -> tuple[Optional[dict[str, Any]], bool]:
        """Decide a pending row once; return its unchanged row and False for duplicate answers."""
        if choice not in {*_GRANT_CHOICES, "deny"}:
            return self.get_fork_approval(request_id), False
        status = ALLOWED if choice in _GRANT_CHOICES else DENIED

        def _do(conn):
            now = time.time()
            changed = conn.execute(
                "UPDATE fork_approvals SET status = ?, choice = ?, decided_at = ? WHERE request_id = ? AND status = ?",
                (status, choice, now, request_id, PENDING))
            row = conn.execute(f"SELECT {_COLUMNS} FROM fork_approvals WHERE request_id = ?",
                               (request_id,)).fetchone()
            return (dict(row), changed.rowcount == 1) if row is not None else (None, False)
        return self._execute_write(_do)

    def withdraw_fork_approval(self, request_id: str, reason: str) -> None:
        def _do(conn):
            conn.execute(
                "UPDATE fork_approvals SET status = ?, reason = ?, decided_at = ? WHERE request_id = ? AND status = ?",
                (WITHDRAWN, reason, time.time(), request_id, PENDING))
        self._execute_write(_do)

    def find_fork_approval_by_tool_call(self, tool_call_id: str) -> Optional[dict[str, Any]]:
        if not tool_call_id:
            return None
        row = self._read_one(
            f"SELECT {_COLUMNS} FROM fork_approvals WHERE tool_call_id = ? "
            "ORDER BY created_at DESC, rowid DESC LIMIT 1", (tool_call_id,))
        return dict(row) if row is not None else None

    def mark_fork_approval_ran(self, tool_call_id: str) -> None:
        if not tool_call_id or self._read_one(
                "SELECT 1 FROM fork_approvals WHERE tool_call_id = ? AND status = ? AND ran_at IS NULL LIMIT 1",
                (tool_call_id, ALLOWED)) is None:
            return

        def _do(conn):
            conn.execute(
                "UPDATE fork_approvals SET ran_at = ? WHERE tool_call_id = ? AND status = ? AND ran_at IS NULL",
                (time.time(), tool_call_id, ALLOWED))
        self._execute_write(_do)

    def fork_approval_ran(self, tool_call_id: str) -> bool:
        return bool(tool_call_id) and self._read_one(
            "SELECT 1 FROM fork_approvals WHERE tool_call_id = ? AND ran_at IS NOT NULL LIMIT 1",
            (tool_call_id,)) is not None

    def expire_fork_approvals(self, *, pending_reason: str, ran_reason: str) -> int:
        """Settle rows whose owning process is provably dead: pending requests expire; an allowed call that
        never stamped ``ran_at`` is stamped, so a crash mid-run is never followed by a second run."""
        rows = self._read_all(
            "SELECT request_id, status, owner FROM fork_approvals WHERE status = ? OR (status = ? AND ran_at IS NULL)",
            (PENDING, ALLOWED))
        dead: dict[Optional[str], bool] = {}
        orphans = []
        for row in rows:
            if row["owner"] not in dead:
                dead[row["owner"]] = _owner_provably_dead(row["owner"])
            if dead[row["owner"]]:
                orphans.append(row)
        if not orphans:
            return 0

        def _do(conn):
            now = time.time()
            for row in orphans:
                if row["status"] == PENDING:
                    conn.execute(
                        "UPDATE fork_approvals SET status = ?, reason = ?, decided_at = ? "
                        "WHERE request_id = ? AND status = ?",
                        (EXPIRED, pending_reason, now, row["request_id"], PENDING))
                else:
                    conn.execute(
                        "UPDATE fork_approvals SET ran_at = ?, reason = ? WHERE request_id = ? AND status = ? "
                        "AND ran_at IS NULL", (now, ran_reason, row["request_id"], ALLOWED))
            return len(orphans)
        return self._execute_write(_do)

    def list_fork_approvals(self, session_id: str, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._read_all(
            f"SELECT {_COLUMNS} FROM fork_approvals WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (session_id, limit))
        return [dict(row) for row in reversed(rows)]

    def get_fork_approval(self, request_id: str) -> Optional[dict[str, Any]]:
        row = self._read_one(f"SELECT {_COLUMNS} FROM fork_approvals WHERE request_id = ?", (request_id,))
        return dict(row) if row is not None else None
