"""Activity records for approvals: normalize, validate, and render.

An *activity* is one thing a bot is waiting on a human for: a dangerous command,
a protected write, an MCP consent prompt, a plugin-transport escalation. The
record is built from the host's own ``pre_approval_request`` payload, so it
carries the host's redacted preview rather than anything we re-derive.

Validation is explicit and per-field. A payload we cannot trust is refused with
``MalformedActivity`` naming the field and the reason — never silently coerced
into an approval the user might answer blind. ``truncate`` covers "valid but
huge" (a 2 MB heredoc preview), which stays answerable.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from .context import BotContext, context_from_hook, resolve_bot_context

# Host choice vocabulary (``tools/approval_gateway_wait`` + ``PendingControls.register``).
CHOICE_ONCE = "once"
CHOICE_SESSION = "session"
CHOICE_ALWAYS = "always"
CHOICE_DENY = "deny"
SAFE_CHOICES = (CHOICE_ONCE, CHOICE_DENY)
ALL_CHOICES = (CHOICE_ONCE, CHOICE_SESSION, CHOICE_ALWAYS, CHOICE_DENY)

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_DENIED = "denied"
STATUS_EXPIRED = "expired"
STATUS_RESOLVED_ELSEWHERE = "resolved_elsewhere"

# Where the record came from. ``gateway`` prompts can be answered through the
# host queue; ``local`` prompts (the interactive CLI's own input panel) cannot,
# because no cross-process queue holds them.
SOURCE_GATEWAY = "gateway"
SOURCE_LOCAL = "local"

_MAX_PREVIEW = 2000
_MAX_ID = 256


class MalformedActivity(ValueError):
    """An approval payload that cannot be recorded safely."""

    def __init__(self, field: str, reason: str):
        self.field = field
        self.reason = reason
        super().__init__(f"malformed activity: {field} {reason}")


def _text(value: Any, field: str, *, required: bool = False, limit: int = _MAX_PREVIEW) -> str:
    if value is None:
        if required:
            raise MalformedActivity(field, "is missing")
        return ""
    if not isinstance(value, str):
        raise MalformedActivity(field, f"must be a string, got {type(value).__name__}")
    text = value.strip() if required else value
    if required and not text:
        raise MalformedActivity(field, "is empty")
    if len(text) > limit:
        text = text[:limit] + f"… [truncated {len(text) - limit} chars]"
    return text


def _request_id(payload: Mapping[str, Any]) -> str:
    """The host's prompt id: the only thing an answer may be keyed on."""
    for key in ("request_id", "prompt_id", "id"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            if len(value) > _MAX_ID:
                raise MalformedActivity(key, f"is longer than {_MAX_ID} chars")
            return value.strip()
    raise MalformedActivity("request_id", "is missing — the host must supply a prompt id")


def local_request_id(payload: Mapping[str, Any]) -> str:
    """A stable id for a prompt no gateway queue can address (the local CLI panel).

    It is deliberately namespaced (``local:``) so it can never collide with a
    host request id, and stable for the same prompt text so a duplicate hook
    does not create two rows.
    """
    import hashlib

    material = "\x1f".join(
        str(payload.get(key) or "")
        for key in ("session_key", "command", "description", "pattern_key", "surface")
    )
    return f"local:{hashlib.sha256(material.encode('utf-8')).hexdigest()[:24]}"


def host_choices(data: Mapping[str, Any] | None, *, allow_permanent: bool) -> tuple[str, ...]:
    """The choices the host will actually accept for one pending approval.

    Mirrors ``PendingControls.register``: ``session``/``always`` are offered only
    when the host allows them and smart-approval did not already refuse them.
    ``allow_permanent`` is the operator's own plugin setting, applied on top.
    """
    data = data or {}
    smart_denied = bool(data.get("smart_denied"))
    choices: list[str] = [CHOICE_ONCE, CHOICE_DENY]
    if allow_permanent and not smart_denied:
        if data.get("allow_session", True):
            choices.append(CHOICE_SESSION)
        if data.get("allow_permanent", True):
            choices.append(CHOICE_ALWAYS)
    return tuple(choices)


def inferred_choices(payload: Mapping[str, Any], *, allow_permanent: bool) -> tuple[str, ...]:
    """Choices for a record built from a hook payload (which omits the host's allow flags)."""
    return host_choices(
        {"smart_denied": payload.get("smart_denied"),
         "allow_session": payload.get("allow_session", True),
         "allow_permanent": payload.get("allow_permanent", True)},
        allow_permanent=allow_permanent,
    )


def activity_kind(payload: Mapping[str, Any]) -> str:
    """Classify what kind of gate raised this approval, from host-supplied facts only."""
    explicit = payload.get("kind")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()[:64]
    surface = str(payload.get("surface") or "")
    if surface.startswith("transport:"):
        return "plugin_transport"
    tool = payload.get("tool_name")
    if isinstance(tool, str) and tool.strip():
        return f"tool:{tool.strip()[:64]}"
    return "command"


@dataclass(frozen=True)
class Activity:
    """One approval request a bot is blocked on (or recently was)."""

    activity_id: str
    kind: str
    status: str
    command: str
    description: str
    pattern_key: str
    pattern_keys: tuple[str, ...]
    choices: tuple[str, ...]
    choices_source: str
    requested_at: float
    context: BotContext
    answerable: bool = True
    source: str = SOURCE_GATEWAY
    settled_at: float | None = None
    settled_choice: str | None = None
    settled_by: str = ""
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "activity_id": self.activity_id,
            "kind": self.kind,
            "status": self.status,
            "command": self.command,
            "description": self.description,
            "pattern_key": self.pattern_key,
            "pattern_keys": list(self.pattern_keys),
            "choices": list(self.choices),
            "choices_source": self.choices_source,
            "requested_at": self.requested_at,
            "settled_at": self.settled_at,
            "settled_choice": self.settled_choice,
            "settled_by": self.settled_by,
            "note": self.note,
            "answerable": self.answerable,
            "source": self.source,
            "bot": {
                "profile": self.context.profile,
                "title": self.context.bot_title,
                "label": self.context.label,
                "profile_home": self.context.profile_home,
            },
            "session": {
                "key": self.context.session_key,
                "id": self.context.session_id,
                "turn_id": self.context.turn_id,
                "tool_call_id": self.context.tool_call_id,
                "surface": self.context.surface,
                "platform": self.context.platform,
            },
            "room": {
                "id": self.context.room,
                "generation": self.context.room_generation,
            } if self.context.room else None,
            "context_complete": self.context.complete,
            "context_missing": list(self.context.missing),
            "context_degraded": list(self.context.degraded),
            "legacy": self.legacy_prompt(),
        }

    def legacy_prompt(self) -> dict[str, Any]:
        """The Desktop group-chat wire shape (``GroupPendingApproval``), unchanged.

        ``apps/desktop/src/plugins/hermes-bots/group-turns.ts`` reads exactly these
        fields off a member's resume snapshot, so a UI built against that contract
        can render a plugin activity without a second mapping.
        """
        return {
            "request_id": self.activity_id,
            "kind": "approval",
            "command": self.command,
            "description": self.description,
            "choices": list(self.choices),
        }

    def with_status(self, status: str, *, choice: str | None = None, by: str = "",
                    note: str = "") -> Activity:
        return Activity(
            activity_id=self.activity_id,
            kind=self.kind,
            status=status,
            command=self.command,
            description=self.description,
            pattern_key=self.pattern_key,
            pattern_keys=self.pattern_keys,
            choices=self.choices,
            choices_source=self.choices_source,
            requested_at=self.requested_at,
            context=self.context,
            answerable=self.answerable,
            source=self.source,
            settled_at=time.time() if status != STATUS_PENDING else None,
            settled_choice=choice,
            settled_by=by,
            note=note,
        )


def build_activity(
    payload: Mapping[str, Any],
    *,
    allow_permanent: bool = False,
    now: float | None = None,
    context: BotContext | None = None,
    request_id: str | None = None,
    answerable: bool = True,
    source: str = SOURCE_GATEWAY,
    choices: tuple[str, ...] | None = None,
    choices_source: str | None = None,
) -> Activity:
    """Validate a hook payload into an ``Activity``; raises ``MalformedActivity``.

    ``request_id`` is normally discovered by the caller from the host's live
    queue, because stock Hermes does not include it on the hook payload. When
    the prompt has no gateway queue (the interactive CLI panel), pass
    ``answerable=False`` and a ``local:`` id so the row is still visible but
    never offered as remotely answerable.
    """
    if not isinstance(payload, Mapping):
        raise MalformedActivity("payload", f"must be a mapping, got {type(payload).__name__}")

    activity_id = (request_id or "").strip() or _request_id(payload)
    if len(activity_id) > _MAX_ID:
        raise MalformedActivity("request_id", f"is longer than {_MAX_ID} chars")
    command = _text(payload.get("command"), "command")
    description = _text(payload.get("description"), "description")
    pattern_key = _text(payload.get("pattern_key"), "pattern_key", limit=_MAX_ID)
    raw_keys = payload.get("pattern_keys")
    if raw_keys is None:
        pattern_keys = (pattern_key,) if pattern_key else ()
    elif isinstance(raw_keys, (list, tuple)):
        pattern_keys = tuple(
            k.strip() for k in raw_keys if isinstance(k, str) and k.strip() and len(k) <= _MAX_ID
        )
    else:
        raise MalformedActivity("pattern_keys", "must be a list of strings")

    ctx = context or context_from_hook(payload)
    if not command and not description:
        # The host always sends at least one preview. Neither means the payload is
        # not an approval request at all — refuse rather than record a blank card.
        raise MalformedActivity("command", "and description are both empty")

    resolved_choices = choices or inferred_choices(payload, allow_permanent=allow_permanent)
    return Activity(
        activity_id=activity_id,
        kind=activity_kind(payload),
        status=STATUS_PENDING,
        command=command,
        description=description,
        pattern_key=pattern_key,
        pattern_keys=pattern_keys,
        choices=tuple(resolved_choices),
        choices_source=choices_source or "inferred",
        requested_at=float(now if now is not None else time.time()),
        context=ctx,
        answerable=bool(answerable),
        source=source if source in (SOURCE_GATEWAY, SOURCE_LOCAL) else SOURCE_GATEWAY,
    )


def outcome_status(choice: Any) -> str:
    """Map a host decision to a settled status (anything unknown is a non-approval)."""
    value = choice.strip().lower() if isinstance(choice, str) else ""
    if value in (CHOICE_ONCE, CHOICE_SESSION, CHOICE_ALWAYS):
        return STATUS_APPROVED
    if value == CHOICE_DENY:
        return STATUS_DENIED
    if value in ("timeout", "expired"):
        return STATUS_EXPIRED
    return STATUS_RESOLVED_ELSEWHERE


def is_settled(status: str) -> bool:
    return status != STATUS_PENDING


def summarize(activities: Iterable[Activity], limit: int = 10) -> str:
    """One-line-per-activity text for a slash command or CLI table."""
    rows = [a for a in activities][:limit]
    if not rows:
        return "No bot activity is waiting on you."
    lines = []
    for a in rows:
        room = f" in room {a.context.room}" if a.context.room else ""
        where = " (answer in its terminal)" if not a.answerable else ""
        lines.append(f"{a.activity_id[:8]}  {a.context.label}{room}{where}  {a.command or a.description}")
    return "\n".join(lines)
