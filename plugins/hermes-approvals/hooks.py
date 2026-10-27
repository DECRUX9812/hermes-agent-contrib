"""Stock lifecycle hooks that keep the approval journal (no core journaling).

- ``pre_approval_request``: record a pending row keyed by the prompt's ``request_id``.
- ``post_approval_response``: record the user's choice once, or settle the row as withdrawn.
- ``pre_tool_call``: remember the tool name per call, and veto a call that already ran once.
- ``post_tool_call``: stamp ``ran_at`` on a call this process allowed.
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from typing import Any

from . import journal

log = logging.getLogger("hermes_approvals.hooks")

_GRANTS = frozenset({"once", "session", "always"})
_MAX_TRACKED = 512
_lock = threading.Lock()
_tool_names: "OrderedDict[str, str]" = OrderedDict()
_allowed_calls: "OrderedDict[str, None]" = OrderedDict()
# request_id -> the approval queue key of a prompt still waiting in this process.
_live_keys: "OrderedDict[str, str]" = OrderedDict()


def _remember(store: OrderedDict, key: str, value: Any) -> None:
    with _lock:
        store[key] = value
        store.move_to_end(key)
        while len(store) > _MAX_TRACKED:
            store.popitem(last=False)


def _stored_session_id(session_key: str) -> str:
    """The stored session id the desktop lists approvals by, from the live gateway session."""
    try:
        from tui_gateway.server import _sessions, _sessions_lock
    except Exception:
        return ""
    with _sessions_lock:
        for session in _sessions.values():
            if str(session.get("session_key") or "") == session_key:
                return str(getattr(session.get("agent"), "session_id", "") or "")
    return ""


def live_session_key(request_id: str) -> str:
    """The queue key a still-waiting prompt resolves under, or "" once it has settled."""
    with _lock:
        return _live_keys.get(request_id, "")


def on_pre_approval_request(**kw: Any) -> None:
    request_id = str(kw.get("request_id") or "")
    if not request_id or kw.get("coalesced"):
        return
    session_key = str(kw.get("session_key") or "")
    if session_key:
        _remember(_live_keys, request_id, session_key)
    session_id = _stored_session_id(session_key) or str(kw.get("session_id") or "") or session_key
    if not session_id:
        return
    tool_call_id = str(kw.get("tool_call_id") or "")
    with _lock:
        tool_name = _tool_names.get(tool_call_id, "") if tool_call_id else ""
    journal.record_request(
        request_id, session_id=session_id, tool_call_id=tool_call_id, tool_name=tool_name,
        command=str(kw.get("command") or ""), description=str(kw.get("description") or ""))


def on_post_approval_response(**kw: Any) -> None:
    request_id = str(kw.get("request_id") or "")
    if not request_id or kw.get("coalesced"):
        return
    with _lock:
        _live_keys.pop(request_id, None)
    choice = str(kw.get("choice") or "")
    if choice in _GRANTS or choice == "deny":
        journal.decide_approval(request_id, choice)
        row = journal.get_approval(request_id)
        if row and row.get("status") == journal.ALLOWED and row.get("tool_call_id"):
            _remember(_allowed_calls, str(row["tool_call_id"]), None)
        return
    journal.settle(request_id, str(kw.get("cancelled") or choice or "session_closed"))


def on_pre_tool_call(**kw: Any):
    tool_call_id = str(kw.get("tool_call_id") or "")
    if not tool_call_id:
        return None
    _remember(_tool_names, tool_call_id, str(kw.get("tool_name") or ""))
    try:
        if journal.already_ran(tool_call_id):
            return {"action": "block", "message": journal.ALREADY_RAN_REASON}
    except Exception:
        log.debug("already_ran check failed", exc_info=True)
    return None


def on_post_tool_call(**kw: Any) -> None:
    tool_call_id = str(kw.get("tool_call_id") or "")
    if not tool_call_id:
        return
    with _lock:
        _tool_names.pop(tool_call_id, None)
        tracked = _allowed_calls.pop(tool_call_id, False) is None
    if tracked:
        journal.mark_ran(tool_call_id)


def _safe(fn):
    def wrapper(**kw: Any):
        try:
            return fn(**kw)
        except Exception:
            log.warning("hermes-approvals %s failed", fn.__name__, exc_info=True)
            return None
    wrapper.__name__ = fn.__name__
    return wrapper


HOOKS = {
    "pre_approval_request": _safe(on_pre_approval_request),
    "post_approval_response": _safe(on_post_approval_response),
    "pre_tool_call": _safe(on_pre_tool_call),
    "post_tool_call": _safe(on_post_tool_call),
}


def install(ctx: Any) -> list[str]:
    if ctx is None or not hasattr(ctx, "register_hook"):
        return []
    for name, fn in HOOKS.items():
        ctx.register_hook(name, fn)
    return list(HOOKS)
