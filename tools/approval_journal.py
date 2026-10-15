"""Durable journal glue for gateway approvals: the profile's ``state.db`` rows behind the approval queue.

A decision is recorded where the queue commits it, a request is settled where its wait ends, and a tool call
whose step already ran is refused before it is queued. Journal writes never break the approval they record."""

import contextlib
import logging
import threading
from pathlib import Path

from hermes_constants import get_hermes_home
from hermes_state_registry import acquire, release_or_close

logger = logging.getLogger("tools.approval")

ALREADY_RAN_REASON = "This exact step already ran once; Hermes will not run it twice."
RESTART_REASON = "Hermes restarted before this was answered. Nothing ran."
RAN_BEFORE_RESTART_REASON = "Hermes restarted while this step was running. It will not run again."

_swept_paths: set[str] = set()
_sweep_lock = threading.Lock()
_warning_lock = threading.Lock()
_warned_unavailable = False
_FAILED = object()


@contextlib.contextmanager
def _journal(home=None, *, sweep=True):
    db = acquire(Path(home or get_hermes_home()) / "state.db")
    try:
        if sweep:
            _sweep_once(db)
        yield db
    finally:
        release_or_close(db)


def _sweep_once(db) -> None:
    """Settle orphans left by a dead backend, once per process and profile home: the first journal open in
    this process after a restart expires them. Live owners' rows are never touched."""
    path = str(db.db_path)
    with _sweep_lock:
        if path in _swept_paths:
            return
        try:
            db.expire_fork_approvals(pending_reason=RESTART_REASON, ran_reason=RAN_BEFORE_RESTART_REASON)
        except Exception:
            _warn_unavailable("expiry")
        else:
            _swept_paths.add(path)


def _warn_unavailable(action: str) -> None:
    global _warned_unavailable
    with _warning_lock:
        if _warned_unavailable:
            return
        _warned_unavailable = True
    logger.warning("approval journal %s failed; continuing without durable approval state", action, exc_info=True)


def _guarded(action: str, fn, *, fallback=None, home=None, sweep=True):
    try:
        with _journal(home, sweep=sweep) as db:
            return fn(db)
    except Exception:
        _warn_unavailable(action)
        return fallback


def record_request(request_id: str, *, session_id: str, tool_call_id: str, tool_name: str,
                   command: str, description: str, home=None) -> bool | None:
    """Return True for a pending row, False for a settled row, or None if unavailable."""
    if not request_id:
        return False
    row = _guarded("request", lambda db: db.record_fork_approval_request(
        request_id, session_id=session_id, tool_call_id=tool_call_id, tool_name=tool_name,
        command=command, description=description), fallback=_FAILED, home=home)
    if row is _FAILED:
        return None
    return bool(row and row["status"] == "pending")


def record_decision(request_id: str, choice: str, *, home=None) -> tuple[dict | None, bool | None]:
    """Record one decision and return ``(row, won)``; ``won is None`` means unavailable or no row."""
    if not request_id:
        return None, None
    result = _guarded("decision", lambda db: db.decide_fork_approval(request_id, choice),
                      fallback=_FAILED, home=home, sweep=False)
    if result is _FAILED:
        return None, None
    if result[0] is None:
        return None, None
    return result


def settle(request_id: str, reason: str, *, home=None) -> None:
    # The queue records a decision before waking the waiter, so only non-answer endings withdraw it.
    if reason == "resolved":
        return
    _guarded("settle", lambda db: db.withdraw_fork_approval(request_id, reason), home=home)


def mark_ran(tool_call_id: str, *, home=None) -> None:
    _guarded("ran", lambda db: db.mark_fork_approval_ran(tool_call_id), home=home)


def already_ran(tool_call_id: str, *, home=None) -> bool:
    if not tool_call_id:
        return False
    # A fresh profile cannot have a previously approved call. Avoid constructing the full
    # SessionDB just to discover that its durable journal has not been created yet.
    try:
        path = Path(home or get_hermes_home()) / "state.db"
        if not path.is_file():
            return False
    except Exception:
        _warn_unavailable("ran lookup")
        return False
    return _guarded("ran lookup", lambda db: db.fork_approval_ran(tool_call_id), fallback=False, home=home)


def find_by_tool_call(tool_call_id: str, *, home=None) -> dict | None:
    if not tool_call_id:
        return None
    return _guarded("tool-call lookup", lambda db: db.find_fork_approval_by_tool_call(tool_call_id),
                    fallback=None, home=home)


def approvals_for_session(session_id: str, *, home=None) -> list[dict]:
    return _guarded("session list", lambda db: db.list_fork_approvals(session_id), fallback=[], home=home)


def get_approval(request_id: str, *, home=None):
    return _guarded("request lookup", lambda db: db.get_fork_approval(request_id), fallback=None, home=home)
