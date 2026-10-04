"""Companion-thread ``session.ask``: answer a question ABOUT a session's transcript.

A side channel for "what was this run doing / why did it fail / where did it write X" that never
touches the live conversation — the transcript is read out (the in-memory copy for a live session,
the profile store's durable rows otherwise), digested to a bounded text, and answered by the
auxiliary model in a one-shot ``agent.auxiliary_client.call_llm`` call (same family as
``delegation.reports`` summaries and ``llm.oneshot``). Prompt caching in the real conversation is
untouched: nothing is appended to session history and the agent never sees the question.

The thread itself is client-owned: the caller may pass prior Q/A pairs as ``history`` so a
follow-up stays coherent without the server keeping companion state.
"""

from __future__ import annotations

import contextlib
import logging
from typing import Any, Dict, List, Optional, Tuple

from .method_ctx import HandlerRegistry, bind_module

logger = logging.getLogger(__name__)

_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped

_ASK_TASK = "session_ask"
_ASK_MAX_TOKENS = 1024
# The digest keeps the head (the goal) and the tail (where it ended up); the middle is what
# gets sacrificed first.
_ASK_HEAD_CHARS = 6000
_ASK_TAIL_CHARS = 24000
_ASK_LINE_MAX_CHARS = 2000
# Prior exchanges the client holds for thread continuity — bounded so a long side thread
# cannot smuggle a second transcript into the call.
_ASK_MAX_PRIOR = 8
_ASK_PRIOR_MAX_CHARS = 2000

_ASK_SYSTEM = (
    "You answer questions about a Hermes agent session. The session's transcript is provided "
    "below. Answer from the transcript only — quote file paths, commands, errors, and outcomes "
    "precisely when they matter, and say plainly when the transcript does not contain the answer "
    "instead of guessing. Keep answers concise; markdown code spans are fine."
)


def _message_digest_lines(messages: List[Dict[str, Any]]) -> List[str]:
    """``role: text`` lines for a stored/live conversation list (OpenAI-shaped dicts).

    Tool rows fold to one ``[tool name]`` line with a clipped result; assistant tool calls appear
    as a ``[calls …]`` marker so the model sees what ran without paying for raw payloads.
    """
    lines: List[str] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "")
        if role in {"system", "developer"}:
            continue
        content = msg.get("content")
        if isinstance(content, list):
            text = "\n".join(
                str(part.get("text") or "") for part in content
                if isinstance(part, dict) and part.get("type") in (None, "text", "input_text", "output_text"))
        else:
            text = str(content or "")
        text = text.strip()
        if role == "tool":
            name = str(msg.get("name") or msg.get("tool_call_id") or "tool")
            lines.append(f"[tool {name}]: {text[:400]}" if text else f"[tool {name}]")
            continue
        calls = msg.get("tool_calls") or []
        if role == "assistant" and isinstance(calls, list) and calls:
            names = ", ".join(
                str(((call.get("function") or {}).get("name")) or call.get("name") or "?")
                for call in calls[:8] if isinstance(call, dict))
            if names:
                lines.append(f"assistant [calls {names}]")
        if not text:
            continue
        if len(text) > _ASK_LINE_MAX_CHARS:
            text = text[:_ASK_LINE_MAX_CHARS].rstrip() + "…"
        lines.append(f"{role or 'message'}: {text}")
    return lines


def _digest_transcript(messages: List[Dict[str, Any]]) -> Tuple[str, int, bool]:
    """``(digest, messages_considered, truncated)`` — head + tail under a char budget."""
    lines = _message_digest_lines(messages)
    total = sum(len(line) + 1 for line in lines)
    if total <= _ASK_HEAD_CHARS + _ASK_TAIL_CHARS:
        return "\n".join(lines), len(lines), False
    head: List[str] = []
    used = 0
    for line in lines:
        if used + len(line) > _ASK_HEAD_CHARS:
            break
        head.append(line)
        used += len(line) + 1
    tail: List[str] = []
    used = 0
    for line in reversed(lines[len(head):]):
        if used + len(line) > _ASK_TAIL_CHARS:
            break
        tail.append(line)
        used += len(line) + 1
    tail.reverse()
    omitted = len(lines) - len(head) - len(tail)
    return "\n".join([*head, f"[… {omitted} earlier transcript lines omitted …]", *tail]), \
        len(head) + len(tail), True


def _prior_exchanges(params: dict) -> List[Tuple[str, str]]:
    raw = params.get("history")
    if not isinstance(raw, list):
        return []
    pairs: List[Tuple[str, str]] = []
    for item in raw[-_ASK_MAX_PRIOR:]:
        if not isinstance(item, dict):
            continue
        q = str(item.get("question") or "").strip()[:_ASK_PRIOR_MAX_CHARS]
        a = str(item.get("answer") or "").strip()[:_ASK_PRIOR_MAX_CHARS]
        if q and a:
            pairs.append((q, a))
    return pairs


def _ask_transcript(params: dict) -> Tuple[Optional[list], Optional[str], Optional[str]]:
    """``(messages, resolved_key, error)`` — live in-memory history when the id is live here,
    else the profile store's durable rows (prefix-resolved)."""
    target = str(params.get("session_id") or "").strip()
    session = _sessions.get(target)
    if session is not None:
        key = session.get("session_key")
        history: Optional[list] = list(session.get("history", []))
        if key:
            with _session_db(session) as db:
                if db is not None:
                    with contextlib.suppress(Exception):
                        history = db.get_messages_as_conversation(key, include_ancestors=True)
        return history, key or target, None
    with _profile_db(params) as db:
        if db is None:
            return None, None, "db"
        key = db.resolve_session_id(target) if hasattr(db, "resolve_session_id") else target
        if not key or not db.get_session(key):
            return None, None, "not_found"
        return db.get_messages_as_conversation(key, include_ancestors=True), key, None


@method("session.ask")
@_profile_scoped
def _(rid, params: dict) -> dict:
    """Answer ``question`` from the session's transcript via the auxiliary model. The stored id
    (or a live runtime id, which resolves to its session key) picks the transcript; the live
    conversation's context is never read or mutated by this call."""
    target = _str_param(params, "session_id")
    if not target:
        return _err(rid, 4000, "session_id required")
    if not (question := _str_param(params, "question")):
        return _err(rid, 4033, "question required")
    messages, resolved, err = _ask_transcript(params)
    if err == "db":
        return _db_unavailable_error(rid, code=5007)
    if err == "not_found":
        return _err(rid, 4001, "session not found")
    digest, considered, truncated = _digest_transcript(messages or [])
    if not digest.strip():
        return _err(rid, 4040, "session has no transcript yet")
    parts = [f"Transcript for session {resolved}:", digest]
    prior = _prior_exchanges(params)
    if prior:
        parts.append("Earlier questions and answers about this session:")
        parts.extend(f"Q: {q}\nA: {a}" for q, a in prior)
    parts.append(f"Question: {question}")
    try:
        from agent.auxiliary_client import call_llm, extract_content_or_reasoning
        response = call_llm(
            task=_ASK_TASK,
            messages=[{"role": "system", "content": _ASK_SYSTEM},
                      {"role": "user", "content": "\n\n".join(parts)}],
            # temperature=None keeps the field off the wire for default-only reasoning models
            # (same constraint as title_generation, #72351).
            temperature=None, max_tokens=_ASK_MAX_TOKENS, reasoning_config={"enabled": False})
        answer = extract_content_or_reasoning(response, max_reasoning_chars=4000)
    except Exception as exc:  # noqa: BLE001 — provider/config failure is the user's answer
        logger.warning("session.ask model call failed for %s: %s", resolved, exc)
        return _err(rid, 5030, f"session.ask failed: {exc}")
    if not answer.strip():
        return _err(rid, 5030, "session.ask returned an empty answer")
    return _ok(rid, {"answer": answer.strip(), "resolved_id": resolved,
                     "messages_considered": considered, "truncated": truncated})


def register(server):
    bind_module(globals(), server, skip=("_",))
