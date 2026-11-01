"""Un-executed work narration: a text-only final that DESCRIBES a whole tool run.

Observed failure (desktop session ``local-10cbdc...``, model ``swe-2-max`` behind the
``devin-swe2`` shim): the provider flattened a multi-step tool run into ONE plain-text
assistant message — ``"Let me check ... Checking ... Implementing ... All applied. Done —"`` —
with ``finish_reason="stop"``, zero ``tool_calls``, zero tool results and zero usage. The
conversation loop classified it ``text_response(finish_reason=stop)``, reported the turn
complete, and shipped 3.9 KB of internal narration to the user, including "Done — the tool feed
is now hard-coded hidden" and "the changes are verified by inspection only". Nothing had run.

The existing guards do not cover this shape:

* ``trailing_continue_intent`` only reads the message TAIL and only for short replies;
* ``promoted_reasoning_announces_action`` only inspects PROMOTED reasoning;
* ``looks_like_degenerate_final`` only fires on an ENTIRE answer that is a fragment;
* ``_looks_like_codex_intermediate_ack`` covers short acknowledgements.

So a long, confident, multi-step narration of work that never happened was accepted as a
finished answer. This module supplies the missing predicate, plus the truthful notice that
replaces an unverified claim set once the bounded re-prompts are exhausted.

Discipline: the predicate is narrow on purpose. It requires a work-request from the user, a
long body, SEVERAL step cues, AND completion claims — so ordinary prose, a terse answer, or a
summary of work done earlier (which has tool results in this turn) never trips it.
"""

from __future__ import annotations

import re
from typing import Any

# Below this length a body cannot hold several steps plus a completion claim.
MIN_NARRATION_CHARS = 240

# Step cues are only counted at the START of a sentence/clause: mid-sentence "checking" inside a
# normal answer ("the health check is fine") is not a step announcement.
_STEP_CUE_RE = re.compile(
    r"(?:^|[.!?:;]\s+|\n)\s*[>*\-–—]?\s*(?:"
    r"let me|let’s|let's|now let me|"
    r"checking|reading|inspecting|searching|grepping|looking at|"
    r"implementing|applying|patching|editing|updating|writing|adding|refactoring|renaming|"
    r"verifying|re-?running|running|executing|testing|"
    r"first,? i|next,? i|then i|now i|i(?:’|')?ll|i will"
    r")\b",
    re.IGNORECASE,
)

# Claims that the work is finished. A body full of these with zero tool results is the
# fabrication signature.
_COMPLETION_CLAIM_RE = re.compile(
    r"(?i)("
    r"\ball (?:applied|set|done|good|wired|landed|patched)\b"
    r"|\bdone\s*(?:—|–|-|:)"
    r"|\bwhat changed\b"
    r"|\bnow defaults? to\b"
    r"|\bhas (?:now )?been (?:applied|updated|fixed|implemented|hidden)\b"
    r"|\b(?:tests|suite)\s+(?:updated|pass(?:ed|ing))\b"
    r"|\bchanges? landed\b"
    r"|\bthe (?:first|second|third|last) edit (?:actually )?landed\b"
    r"|\bi(?:’|')ve (?:updated|applied|implemented|changed|fixed|landed|shipped|patched)\b"
    r"|\bi (?:updated|applied|implemented|changed|fixed|landed|shipped|patched)\b"
    r"|\bnothing else needed\b"
    r"|\bship with\b"
    r"|\beverything (?:is|now) (?:in place|applied|updated|done)\b"
    r")"
)

# Fused sentence boundaries ("where config lives.Config already has") happen when a transport
# concatenates separate assistant chunks into one string — the same flattening that drops the
# tool calls. Two or more is strong corroboration for a flattened run.
_FUSED_BOUNDARY_RE = re.compile(r"[a-z0-9`)_\]]\.[A-Z][a-z]")

# A user message asking for work, not for a description of work.
_WORK_REQUEST_RE = re.compile(
    r"(?i)\b(implement|fix|add|update|change|refactor|migrate|remove|hide|suppress|wire|"
    r"build|ensure|apply|ship|debug|repair|patch|write|create|replace|restructure|delete|"
    r"rename|make (?:it|them|the|sure)|set up|finish|continue)\b"
)

_NOTICE = (
    "⚠️ No tool call ran in this turn (0 tool calls, 0 tool results), so nothing described "
    "below was executed, verified, or changed. The claims are unconfirmed — re-ask if you want "
    "the work actually done."
)


def _text_of(value: Any) -> str:
    """Flatten a str or OpenAI-style multi-part content list (never raises)."""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        parts = []
        for item in value:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or ""))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(part for part in parts if part)
    return "" if value is None else str(value)


def is_work_request(user_message: Any) -> bool:
    """Whether the user asked for work to be performed (not for an explanation)."""
    return bool(_WORK_REQUEST_RE.search(_text_of(user_message)))


def narration_signals(text: Any, user_message: Any = None) -> dict[str, int | bool]:
    """Diagnostic breakdown of the narration shape (used by the guard and its tests)."""
    body = _text_of(text).strip()
    return {
        "chars": len(body),
        "step_cues": len(set(m.group(0).strip().lower() for m in _STEP_CUE_RE.finditer(body))),
        "completion_claims": len(_COMPLETION_CLAIM_RE.findall(body)),
        "fused_boundaries": len(_FUSED_BOUNDARY_RE.findall(body)),
        "work_request": is_work_request(user_message),
    }


def looks_like_unexecuted_work_narration(
    text: Any, *, user_message: Any = None, tool_results: int = 0
) -> bool:
    """Whether ``text`` narrates an entire tool run while the turn produced no tool result.

    ``tool_results`` is the caller's ``tool_results_this_turn(messages)``: any result means the
    turn really acted, so the claim set is plausible and the guard must stay out of the way.
    """
    if tool_results:
        return False
    signals = narration_signals(text, user_message)
    if signals["chars"] < MIN_NARRATION_CHARS or not signals["work_request"]:
        return False
    cues = int(signals["step_cues"])
    claims = int(signals["completion_claims"])
    fused = int(signals["fused_boundaries"])
    # Two steps in a body this long is already suspicious; a flattened multi-step run shows three
    # or more distinct cues (or the chunk-fusion artefacts that come from the same flattening).
    if cues < 2 or (cues < 3 and fused < 2):
        return False
    # Two independent completion claims, or one claim corroborated by chunk-fusion artefacts.
    return claims >= 2 or (claims >= 1 and fused >= 2)


def unverified_work_notice(text: Any, *, model: str = "", provider: str = "") -> str:
    """The user-facing replacement for a claim set that no tool call backs.

    Keeps the original body (it may contain a useful plan or the right file list) but removes
    its "this is done" framing and states plainly that nothing ran.
    """
    body = _text_of(text).strip()
    detail = ", ".join(part for part in (model, provider) if part)
    header = f"{_NOTICE} ({detail})" if detail else _NOTICE
    if not body:
        return header
    return f"{header}\n\n---\n\n{body}"
