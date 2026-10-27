"""RPC method registrations for fork.approvals.* on the gateway server."""

from __future__ import annotations

import logging
from typing import Any

from . import hooks, journal

logger = logging.getLogger("hermes_approvals.rpc")

_CHOICES = frozenset({"once", "allow_once", "session", "allow_session", "always", "always_allow", "deny", "deny_always"})

def _ok(rid: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "result": result}

def _err(rid: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}

def handle_list(rid: Any, params: dict[str, Any]) -> dict[str, Any]:
    session_id = str(params.get("session_id") or "")
    if not session_id:
        return _err(rid, 4006, "session_id required")
    rows = journal.list_approvals(session_id)
    return _ok(rid, {"approvals": [journal.public_approval(r) for r in rows]})

def handle_decide(rid: Any, params: dict[str, Any]) -> dict[str, Any]:
    session_id = str(params.get("session_id") or "")
    request_id = str(params.get("request_id") or "")
    choice_raw = params.get("choice")
    choice = journal.normalize_choice(choice_raw)
    
    if not session_id or not request_id or not choice:
        return _err(rid, 4006, "session_id, request_id and a valid choice required")
        
    row = journal.get_approval(request_id)
    if row is None or row.get("session_id") != session_id:
        return _err(rid, 4004, "approval not found")
        
    # A prompt still waiting here is answered through the stock resolver under the
    # queue key its pre_approval_request hook reported, so the row never says
    # "allowed" for a prompt the agent did not receive.
    resolved = False
    session_key = hooks.live_session_key(request_id)
    if session_key:
        try:
            from tools import approval as _approval
            resolved = bool(_approval.resolve_gateway_approval(session_key, choice, request_id=request_id))
        except Exception as exc:
            logger.warning("hermes-approvals: live resolve of %s failed: %s", request_id, exc)
    if resolved or not session_key:
        # Delivered now, or nothing waits in this process (the row outlived its prompt).
        row_decided, _won = journal.decide_approval(request_id, choice)
    else:
        # The prompt settled (timeout, interrupt) between the lookup and the resolve.
        row_decided = journal.get_approval(request_id)

    return _ok(rid, {
        "approval": journal.public_approval(row_decided or row),
        "resolved": resolved
    })

def install(server: Any) -> list[str]:
    names = []
    if hasattr(server, "register_method"):
        server.register_method("fork.approvals.list", handle_list)
        server.register_method("fork.approvals.decide", handle_decide)
        names.extend(["fork.approvals.list", "fork.approvals.decide"])
    return names
