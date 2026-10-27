"""Durable journal of gateway approval requests in the plugin's own database.

Lives at ``<hermes home>/plugin-data/hermes-approvals/data.db`` (``plugins/plugin_storage.py``) in
the table ``fork_approvals``. A decision is recorded once: a row that is no
longer pending is never rewritten. A tool call that has run (``ran_at`` stamped) is never approved
again. Each row records the process that opened it; rows are expired only when that process is
provably dead, so a live process's pending request is never touched by another process sharing
the profile.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
from pathlib import Path
import sqlite3
import time
from typing import Any, Optional

from . import shared

logger = logging.getLogger("hermes_approvals.journal")

PENDING = "pending"
ALLOWED = "allowed"
DENIED = "denied"
EXPIRED = "expired"
WITHDRAWN = "withdrawn"

ALREADY_RAN_REASON = "This exact step already ran once; Hermes will not run it twice."
RESTART_REASON = "Hermes restarted before this was answered. Nothing ran."
RAN_BEFORE_RESTART_REASON = "Hermes restarted while this step was running. It will not run again."
# Upstream answers a prompt withdrawn by an interrupt or session stop with a deny; the desktop names it.
SESSION_STOPPED_REASON = "session_stopped"

_GRANT_CHOICES = frozenset({"once", "session", "always"})
_CANONICAL_CHOICES = frozenset({"once", "session", "always", "deny"})

_CHOICE_MAP = {
    "once": "once",
    "allow_once": "once",
    "session": "session",
    "allow_session": "session",
    "always": "always",
    "always_allow": "always",
    "allow_always": "always",
    "deny": "deny",
    "deny_always": "deny",
}

_COLUMNS = (
    "request_id, session_id, tool_call_id, tool_name, command, description, "
    "created_at, status, decided_at, choice, ran_at, reason"
)

_PUBLIC_FIELDS = (
    "request_id",
    "tool_call_id",
    "tool_name",
    "command",
    "description",
    "status",
    "choice",
    "created_at",
    "decided_at",
    "ran_at",
    "reason",
)

# Process-wide (shared.py), so a reloaded copy of the plugin does not sweep the file again.
_STATE = shared.get()
_swept_paths: set[str] = _STATE.swept_paths
_sweep_lock = _STATE.sweep_lock


def normalize_choice(choice: Any) -> Optional[str]:
    """Map aliases such as 'allow_once' or 'always_allow' to canonical choice strings."""
    if not isinstance(choice, str):
        return None
    return _CHOICE_MAP.get(choice.strip().lower())


def public_approval(row: Any) -> dict[str, Any]:
    """Extract the wire-safe public fields from an internal database row."""
    if row is None:
        return {}
    d = dict(row)
    return {k: d.get(k) for k in _PUBLIC_FIELDS}


PLUGIN_NAME = "hermes-approvals"
_DB_FILE = "data.db"


def get_db_path(home: Optional[str | Path] = None) -> Path:
    """``<hermes home>/plugin-data/hermes-approvals/data.db`` (plugins/plugin_storage.py layout)."""
    if home is None:
        try:
            from plugins.plugin_storage import plugin_data_dir
            return plugin_data_dir(PLUGIN_NAME) / _DB_FILE
        except ImportError:
            home = os.environ.get("HERMES_HOME") or (Path.home() / ".hermes")
    return Path(home) / "plugin-data" / PLUGIN_NAME / _DB_FILE


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
    CREATE TABLE IF NOT EXISTS fork_approvals (
        request_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL DEFAULT '',
        tool_name TEXT NOT NULL DEFAULT '',
        command TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        created_at REAL NOT NULL,
        status TEXT NOT NULL,
        decided_at REAL,
        choice TEXT,
        ran_at REAL,
        reason TEXT,
        owner TEXT
    )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_fork_approvals_session ON fork_approvals(session_id, created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_fork_approvals_tool_call ON fork_approvals(tool_call_id)")


def reset_sweep() -> None:
    """Clear the sweep cache so the next access re-scans for dead process orphans."""
    with _sweep_lock:
        _swept_paths.clear()


def _open(home: Optional[str | Path]) -> tuple[sqlite3.Connection, Path]:
    path = get_db_path(home)
    if home is None:
        try:
            from plugins.plugin_storage import plugin_db
            conn = plugin_db(PLUGIN_NAME, _DB_FILE)
        except ImportError:
            conn = None
        if conn is not None:
            conn.row_factory = sqlite3.Row
            return conn, path
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn, path


@contextlib.contextmanager
def get_db(home: Optional[str | Path] = None, *, sweep: bool = True):
    conn, path = _open(home)
    try:
        conn.execute("PRAGMA busy_timeout=5000")
        ensure_schema(conn)
        if sweep:
            _sweep_once(conn, path)
        yield conn
    finally:
        conn.close()


def migrate_from_state_db(conn: sqlite3.Connection, db_path: Path) -> int:
    """Copy rows an older core build journaled into ``<home>/state.db`` (read-only; never deletes them)."""
    state_db = db_path.parent.parent.parent / "state.db"
    if not state_db.is_file():
        return 0
    try:
        src = sqlite3.connect(f"file:{state_db}?mode=ro", uri=True, timeout=5.0)
    except sqlite3.Error:
        return 0
    try:
        src.row_factory = sqlite3.Row
        has = src.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fork_approvals'").fetchone()
        if not has:
            return 0
        rows = src.execute(f"SELECT {_COLUMNS}, owner FROM fork_approvals").fetchall()
    except sqlite3.Error:
        logger.warning("approval journal migration read failed", exc_info=True)
        return 0
    finally:
        src.close()
    copied = 0
    for row in rows:
        cur = conn.execute(
            f"INSERT OR IGNORE INTO fork_approvals ({_COLUMNS}, owner) VALUES ({', '.join('?' * 13)})",
            tuple(row))
        copied += cur.rowcount
    conn.commit()
    return copied


def _sweep_once(conn: sqlite3.Connection, path: Path) -> None:
    path_str = str(path)
    with _sweep_lock:
        if path_str in _swept_paths:
            return
        try:
            migrated = migrate_from_state_db(conn, path)
            if migrated:
                logger.info("hermes-approvals: migrated %d journal rows from state.db", migrated)
            expire_approvals(conn, pending_reason=RESTART_REASON, ran_reason=RAN_BEFORE_RESTART_REASON)
        except Exception:
            logger.warning("approval journal sweep failed", exc_info=True)
        else:
            _swept_paths.add(path_str)


def _owner_record() -> str:
    pid = os.getpid()
    start_ticks = None
    ns_id = None
    try:
        from hermes_state_common import _proc_start_ticks
        start_ticks = _proc_start_ticks(pid)
    except Exception:
        pass
    try:
        from hermes_state_pidns import pid_namespace_id
        ns_id = pid_namespace_id()
    except Exception:
        pass
    return json.dumps({"pid": pid, "pidns": ns_id, "start_ticks": start_ticks}, sort_keys=True)


def _owner_provably_dead(owner: Optional[str]) -> bool:
    if not owner:
        return False
    try:
        record = json.loads(owner)
    except Exception:
        return False
    if not isinstance(record, dict):
        return False
    try:
        from hermes_state_common import _lock_holder_provably_dead
        return bool(_lock_holder_provably_dead(record))
    except Exception:
        pass
    pid = record.get("pid")
    if not isinstance(pid, int):
        return False
    try:
        os.kill(pid, 0)
        return False
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    except Exception:
        return False


def expire_approvals(
    conn_or_home: Optional[sqlite3.Connection | str | Path] = None,
    *,
    pending_reason: str = RESTART_REASON,
    ran_reason: str = RAN_BEFORE_RESTART_REASON,
) -> int:
    """Settle rows whose owning process is provably dead: pending requests expire; an allowed call that
    never stamped ran_at is stamped, so a crash mid-run is never followed by a second run."""
    if isinstance(conn_or_home, sqlite3.Connection):
        return _do_expire(conn_or_home, pending_reason, ran_reason)
    with get_db(conn_or_home, sweep=False) as conn:
        return _do_expire(conn, pending_reason, ran_reason)


def _do_expire(conn: sqlite3.Connection, pending_reason: str, ran_reason: str) -> int:
    rows = conn.execute(
        "SELECT request_id, status, owner FROM fork_approvals WHERE status = ? OR (status = ? AND ran_at IS NULL)",
        (PENDING, ALLOWED),
    ).fetchall()
    dead: dict[Optional[str], bool] = {}
    orphans = []
    for row in rows:
        owner = row["owner"]
        if owner not in dead:
            dead[owner] = _owner_provably_dead(owner)
        if dead[owner]:
            orphans.append(row)
    if not orphans:
        return 0

    now = time.time()
    for row in orphans:
        if row["status"] == PENDING:
            conn.execute(
                "UPDATE fork_approvals SET status = ?, reason = ?, decided_at = ? "
                "WHERE request_id = ? AND status = ?",
                (EXPIRED, pending_reason, now, row["request_id"], PENDING),
            )
        else:
            conn.execute(
                "UPDATE fork_approvals SET ran_at = ?, reason = ? "
                "WHERE request_id = ? AND status = ? AND ran_at IS NULL",
                (now, ran_reason, row["request_id"], ALLOWED),
            )
    conn.commit()
    return len(orphans)


def record_request(
    request_id: str,
    *,
    session_id: str,
    tool_call_id: str = "",
    tool_name: str = "",
    command: str = "",
    description: str = "",
    home: Optional[str | Path] = None,
    owner: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Record a new approval request with PENDING status."""
    if not request_id:
        return None
    owner_rec = owner if owner is not None else _owner_record()
    now = time.time()
    with get_db(home, sweep=True) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO fork_approvals "
            "(request_id, session_id, tool_call_id, tool_name, command, description, created_at, status, owner) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                request_id,
                session_id,
                tool_call_id or "",
                tool_name or "",
                command or "",
                description or "",
                now,
                PENDING,
                owner_rec,
            ),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {_COLUMNS} FROM fork_approvals WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        return dict(row) if row is not None else None


def decide_approval(
    request_id: str,
    choice: str,
    *,
    home: Optional[str | Path] = None,
) -> tuple[Optional[dict[str, Any]], bool]:
    """Decide a pending approval request once; return ``(row, won)``.
    ``won`` is True if this call transitioned a pending request, False for duplicate answers or unknown/invalid choice.
    """
    if not request_id or not choice:
        return None, False
    norm_choice = normalize_choice(choice)
    if not norm_choice or norm_choice not in {*_GRANT_CHOICES, "deny"}:
        return get_approval(request_id, home=home), False
    status = ALLOWED if norm_choice in _GRANT_CHOICES else DENIED
    now = time.time()

    with get_db(home, sweep=False) as conn:
        cursor = conn.execute(
            "UPDATE fork_approvals SET status = ?, choice = ?, decided_at = ? "
            "WHERE request_id = ? AND status = ?",
            (status, norm_choice, now, request_id, PENDING),
        )
        conn.commit()
        changed = cursor.rowcount == 1
        row = conn.execute(
            f"SELECT {_COLUMNS} FROM fork_approvals WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        return (dict(row), changed) if row is not None else (None, False)


record_decision = decide_approval


def get_approval(request_id: str, *, home: Optional[str | Path] = None) -> Optional[dict[str, Any]]:
    """Look up one approval by request_id."""
    if not request_id:
        return None
    with get_db(home, sweep=False) as conn:
        row = conn.execute(
            f"SELECT {_COLUMNS} FROM fork_approvals WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        return dict(row) if row is not None else None


def list_approvals(
    session_id: str,
    *,
    home: Optional[str | Path] = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """List approvals for a stored session, returned in chronological order (oldest to newest)."""
    if not session_id:
        return []
    with get_db(home, sweep=True) as conn:
        rows = conn.execute(
            f"SELECT {_COLUMNS} FROM fork_approvals WHERE session_id = ? "
            "ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (session_id, limit),
        ).fetchall()
        return [dict(row) for row in reversed(rows)]


approvals_for_session = list_approvals


def settle(request_id: str, reason: str, *, status: str = WITHDRAWN, home: Optional[str | Path] = None) -> None:
    """Close a pending approval with a reason (withdrawn unless the agent was told otherwise)."""
    if not request_id or reason == "resolved":
        return
    now = time.time()
    with get_db(home, sweep=False) as conn:
        conn.execute(
            "UPDATE fork_approvals SET status = ?, reason = ?, decided_at = ? "
            "WHERE request_id = ? AND status = ?",
            (status, reason, now, request_id, PENDING),
        )
        conn.commit()


withdraw_approval = settle


def mark_ran(tool_call_id: str, *, home: Optional[str | Path] = None) -> None:
    """Stamp ran_at on an allowed tool call."""
    if not tool_call_id:
        return
    now = time.time()
    with get_db(home, sweep=False) as conn:
        conn.execute(
            "UPDATE fork_approvals SET ran_at = ? "
            "WHERE tool_call_id = ? AND status = ? AND ran_at IS NULL",
            (now, tool_call_id, ALLOWED),
        )
        conn.commit()


def already_ran(tool_call_id: str, *, home: Optional[str | Path] = None) -> bool:
    """Return True if this tool call has already completed once."""
    if not tool_call_id:
        return False
    path = get_db_path(home)
    if not path.is_file():
        return False
    with get_db(home, sweep=False) as conn:
        row = conn.execute(
            "SELECT 1 FROM fork_approvals WHERE tool_call_id = ? AND ran_at IS NOT NULL LIMIT 1",
            (tool_call_id,),
        ).fetchone()
        return row is not None


def find_by_tool_call(tool_call_id: str, *, home: Optional[str | Path] = None) -> Optional[dict[str, Any]]:
    """Look up the latest approval record for a tool call ID."""
    if not tool_call_id:
        return None
    with get_db(home, sweep=False) as conn:
        row = conn.execute(
            f"SELECT {_COLUMNS} FROM fork_approvals WHERE tool_call_id = ? "
            "ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (tool_call_id,),
        ).fetchone()
        return dict(row) if row is not None else None
