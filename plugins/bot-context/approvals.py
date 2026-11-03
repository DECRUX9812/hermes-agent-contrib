"""Answering an activity approval — safely, and with an explicit failure code.

Three things can go wrong here and each has its own answer:

* **Missing context.** The activity's session key is what the host queue is
  keyed on. Without it we cannot ask the queue anything, so we refuse instead of
  guessing a session from the profile.
* **Insufficient permission.** A bot must not be able to approve its own blocked
  command; that is the whole point of the gate. Default scope is ``user``: only
  the operator's own (launch) profile may answer, and never a bot answering its
  own activity. Loosening it is an explicit, documented config change.
* **Approval failure.** The host's resolver is the only authority. If it reports
  nothing resolved, the prompt was answered on another surface, withdrawn, or
  expired — we say which we can prove and never claim an approval we did not
  perform.

Every path returns a dict; nothing raises into a tool call.
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from .activities import (
    ALL_CHOICES,
    CHOICE_DENY,
    SAFE_CHOICES,
    STATUS_APPROVED,
    STATUS_DENIED,
    STATUS_PENDING,
    STATUS_RESOLVED_ELSEWHERE,
    Activity,
    host_choices,
    outcome_status,
)
from .context import BotContext, is_launch_profile

logger = logging.getLogger("plugins.bot-context")

SCOPE_USER = "user"
SCOPE_SAME_PROFILE = "same_profile"
SCOPE_ANY = "any"
_SCOPES = (SCOPE_USER, SCOPE_SAME_PROFILE, SCOPE_ANY)

# Stable error codes: UIs and prompts branch on these, never on message text.
E_UNKNOWN_ACTIVITY = "unknown_activity"
E_ALREADY_SETTLED = "already_settled"
E_MISSING_CONTEXT = "missing_context"
E_INSUFFICIENT_PERMISSION = "insufficient_permission"
E_INVALID_CHOICE = "invalid_choice"
E_NOT_PENDING = "not_pending"
E_RESOLUTION_FAILED = "resolution_failed"
E_HOST_UNAVAILABLE = "host_unavailable"

_MESSAGES = {
    E_UNKNOWN_ACTIVITY: (
        "No pending activity with that id in this process. Approvals are process-local: "
        "the bot-context plugin only sees prompts raised while it was loaded in the same "
        "Hermes process that is holding the wait."
    ),
    E_MISSING_CONTEXT: (
        "This activity has no session key, so its approval queue cannot be addressed. "
        "Answer it from the bot's own session (the approval card) instead."
    ),
    E_INSUFFICIENT_PERMISSION: (
        "This session may not answer that activity. Answering is limited by the plugin's "
        "answer_scope setting, and a bot is never allowed to approve its own blocked action."
    ),
    E_INVALID_CHOICE: "That decision is not one the host will accept for this prompt.",
    E_NOT_PENDING: (
        "The host has no pending prompt with that id any more: it was answered on another "
        "surface, withdrawn, or it expired. Nothing was changed by this call."
    ),
    E_RESOLUTION_FAILED: "The host's approval resolver raised; the prompt was not answered.",
    E_HOST_UNAVAILABLE: (
        "This Hermes process has no gateway approval queue (CLI-only install, or a different "
        "process owns the waiting bot), so the prompt cannot be answered from here."
    ),
}


def error(code: str, *, message: str = "", field: str = "", detail: Any = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": False,
        "code": code,
        "error": message or _MESSAGES.get(code, "The activity could not be answered."),
    }
    if field:
        payload["field"] = field
    if detail is not None:
        payload["detail"] = detail
    return payload


def normalize_scope(raw: Any) -> str:
    value = raw.strip().lower() if isinstance(raw, str) else ""
    return value if value in _SCOPES else SCOPE_USER


def effective_choices(activity: Activity, *, allow_permanent: bool) -> tuple[str, ...]:
    """Choices we may offer right now.

    Live host flags (when the queue can be read) are authoritative. An inferred
    record is only ever narrowed to the always-safe pair, because offering
    ``always`` on a prompt the host would refuse could grant a permanent
    allowlist entry the UI never offered.
    """
    live = host_entry_data(activity.context.session_key, activity.activity_id)
    if live is not None:
        return host_choices(live, allow_permanent=allow_permanent)
    if activity.choices_source == "live":
        return tuple(c for c in activity.choices if c in ALL_CHOICES)
    return tuple(c for c in activity.choices if c in SAFE_CHOICES) or SAFE_CHOICES


def host_entry_data(session_key: str, request_id: str) -> Mapping[str, Any] | None:
    """The host's live queue entry for one prompt, or None when it cannot be read.

    ``tools.approval.list_gateway_approvals`` is the same read the gateway's own
    ``PendingControls.snapshot`` uses. It is optional on purpose: a CLI install or
    an older host has no such queue, and callers must treat None as "unverifiable",
    not "denied".
    """
    if not session_key or not request_id:
        return None
    try:
        from tools.approval import list_gateway_approvals
    except Exception:
        return None
    try:
        for entry in list_gateway_approvals(session_key) or ():
            if isinstance(entry, Mapping) and entry.get("request_id") == request_id:
                return entry
    except Exception as exc:  # pragma: no cover - host queue is defensive anyway
        logger.debug("bot-context: queue read failed for %s (%s)", session_key, exc)
    return None


def permission_check(
    activity: Activity,
    caller: BotContext,
    *,
    answer_scope: str,
) -> tuple[bool, str]:
    """``(allowed, reason)`` for answering *activity* from *caller*'s session.

    The invariant that matters: a bot session must never answer the prompt its
    own profile is blocked on. The operator's launch profile is always allowed —
    answering there is exactly what clicking the card does, and refusing it would
    only make single-profile installs unusable.
    """
    target_profile = activity.context.profile
    caller_profile = caller.profile
    scope = normalize_scope(answer_scope)

    if scope == SCOPE_ANY:
        return True, "answer_scope=any"

    operator = is_launch_profile(caller.profile_home)
    same_profile = bool(caller_profile) and caller_profile == target_profile

    if scope == SCOPE_SAME_PROFILE:
        if same_profile or operator:
            return True, "answer_scope=same_profile"
        return False, f"{caller_profile or 'unknown profile'} is not {target_profile or 'the target profile'}"

    # scope == user: the operator's own session, or nothing.
    if not operator:
        if same_profile:
            return False, (f"session belongs to the blocked bot's own profile "
                           f"({target_profile or 'unknown'}), which is self-approval")
        return False, f"{caller_profile or 'this session'} is not the operator's profile"
    return True, "operator profile"


def respond(
    activity_id: str,
    choice: str,
    *,
    ledger,
    caller: BotContext,
    answer_scope: str = SCOPE_USER,
    allow_permanent: bool = False,
    reason: str = "",
) -> dict[str, Any]:
    """Answer one pending activity. Returns ``{ok, status, ...}``; never raises."""
    activity_id = (activity_id or "").strip()
    choice = (choice or "").strip().lower()
    if not activity_id:
        return error(E_UNKNOWN_ACTIVITY, field="request_id", message="request_id is required")

    activity = ledger.get(activity_id)
    if activity is None:
        return error(E_UNKNOWN_ACTIVITY, field="request_id", detail={"request_id": activity_id})
    if activity.status != STATUS_PENDING:
        return {
            "ok": False,
            "status": "already_settled",
            "code": E_ALREADY_SETTLED,
            "error": f"This activity was already {activity.status}"
                     + (f" ({activity.settled_choice})" if activity.settled_choice else "")
                     + ".",
            "activity": activity.to_dict(),
        }
    if not activity.context.session_key:
        return error(E_MISSING_CONTEXT, detail={"missing": list(activity.context.missing)})

    allowed, why = permission_check(activity, caller, answer_scope=answer_scope)
    if not allowed:
        return error(E_INSUFFICIENT_PERMISSION, detail={"reason": why, "answer_scope": answer_scope})

    choices = effective_choices(activity, allow_permanent=allow_permanent)
    if choice not in choices:
        return error(
            E_INVALID_CHOICE,
            field="choice",
            message=f"{_MESSAGES[E_INVALID_CHOICE]} Allowed: {', '.join(choices)}.",
            detail={"allowed": list(choices)},
        )

    try:
        from tools.approval import resolve_gateway_approval
    except Exception:
        return error(E_HOST_UNAVAILABLE)

    try:
        resolved = int(resolve_gateway_approval(
            activity.context.session_key,
            choice,
            reason=(reason or None) if choice == CHOICE_DENY else None,
            request_id=activity.activity_id,
        ))
    except Exception as exc:
        logger.warning("bot-context: resolve_gateway_approval failed for %s: %s",
                       activity.activity_id, exc, exc_info=True)
        return error(E_RESOLUTION_FAILED, detail={"exception": exc.__class__.__name__})

    if resolved <= 0:
        # The ledger may already know why (settled by the post hook or by TTL).
        current = ledger.get(activity.activity_id)
        if current is not None and current.status != STATUS_PENDING:
            return {
                "ok": False,
                "status": "already_settled",
                "code": E_ALREADY_SETTLED,
                "error": f"This activity was already {current.status}.",
                "activity": current.to_dict(),
            }
        settled = ledger.settle(
            activity.activity_id,
            status=STATUS_RESOLVED_ELSEWHERE,
            by="bot-context",
            note="host queue held no prompt with this id",
        )
        return {
            "ok": False,
            "status": "stale",
            "code": E_NOT_PENDING,
            "error": _MESSAGES[E_NOT_PENDING],
            "activity": (settled.to_dict() if settled else activity.to_dict()),
        }

    status = outcome_status(choice)
    settled = ledger.settle(
        activity.activity_id,
        status=status,
        choice=choice,
        by=f"bot-context:{caller.profile or 'operator'}",
        note=f"answered via plugin (scope={normalize_scope(answer_scope)})",
    )
    return {
        "ok": True,
        "status": "resolved",
        "choice": choice,
        "decision": STATUS_APPROVED if status == STATUS_APPROVED else STATUS_DENIED,
        "activity": (settled.to_dict() if settled else activity.to_dict()),
        "bot": activity.context.label,
    }


def record_outcome(ledger, payload: Mapping[str, Any]) -> None:
    """Apply a ``post_approval_response`` hook payload to the ledger (never raises)."""
    try:
        request_id = payload.get("request_id") or payload.get("prompt_id")
        if not isinstance(request_id, str) or not request_id:
            return
        choice = payload.get("choice")
        status = outcome_status(choice)
        ledger.settle(request_id, status=status,
                      choice=(choice if isinstance(choice, str) else None),
                      by=str(payload.get("decided_by") or payload.get("surface") or "host"),
                      note="observed by post_approval_response")
    except Exception:  # pragma: no cover - hook path must stay silent
        logger.debug("bot-context: could not record approval outcome", exc_info=True)
