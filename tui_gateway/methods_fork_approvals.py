from .contracts.server_requests import ApprovalChoice
from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped

_CHOICES = frozenset(choice.value for choice in ApprovalChoice)
_PUBLIC_FIELDS = (
    "request_id", "tool_call_id", "tool_name", "command", "description", "status",
    "choice", "created_at", "decided_at", "ran_at", "reason",
)


def _public_approval(row: dict) -> dict:
    return {key: row[key] for key in _PUBLIC_FIELDS}


@method("fork.approvals.list")
@_profile_scoped
def _(rid, params: dict) -> dict:
    from tools import approval_journal
    session_id = str(params.get("session_id") or "")
    if not session_id:
        return _err(rid, 4006, "session_id required")
    rows = approval_journal.approvals_for_session(session_id)
    return _ok(rid, {"approvals": [_public_approval(row) for row in rows]})


@method("fork.approvals.decide")
@_profile_scoped
def _(rid, params: dict) -> dict:
    from tools import approval as _approval
    from tools import approval_journal
    session_id = str(params.get("session_id") or "")
    request_id = str(params.get("request_id") or "")
    choice = params.get("choice")
    if not session_id or not request_id or choice not in _CHOICES:
        return _err(rid, 4006, "session_id, request_id and a valid choice required")
    row = approval_journal.get_approval(request_id)
    if row is None or row["session_id"] != session_id:
        return _err(rid, 4004, "approval not found")
    session_key = _live_session_key(session_id)
    resolved = bool(_approval.resolve_gateway_approval(
        session_key, choice, request_id=request_id)) if session_key else False
    return _ok(rid, {"approval": _public_approval(approval_journal.get_approval(request_id)),
                     "resolved": resolved})


def _live_session_key(session_id: str) -> str:
    with _sessions_lock:
        for session in _sessions.values():
            key = str(session.get("session_key") or "")
            if str(getattr(session.get("agent"), "session_id", "") or key) == session_id:
                return key
    return ""


def register(server) -> None:
    bind_module(globals(), server, skip=("_",))
