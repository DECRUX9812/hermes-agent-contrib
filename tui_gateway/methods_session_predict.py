"""Composer predictions: ``session.predict_next`` drafts the user's likely next message.

After a turn settles, the composer can show a faint suggestion the user accepts with Tab. The
draft comes from one small auxiliary-model call over the transcript's tail plus a few of the
user's own recent messages (so it reads in their voice, not the assistant's). Like
``session.ask`` it is a side channel: nothing is appended to history and the live conversation's
cached prefix is never touched.

Opt-in (``auxiliary.composer_prediction.enabled``): it costs a model call per settled turn, so a
disabled install answers ``{"text": ""}`` without calling anything.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .method_ctx import HandlerRegistry, bind_module
from .methods_session_ask import _ask_transcript, _message_digest_lines

logger = logging.getLogger(__name__)

_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped

_PREDICT_TASK = "composer_prediction"
_PREDICT_MAX_TOKENS = 160
_PREDICT_TAIL_CHARS = 8000
_STYLE_SAMPLES = 6
_STYLE_SAMPLE_CHARS = 300
# A suggestion is one message the user would type, not an essay.
_MAX_PREDICTION_CHARS = 280

_PREDICT_SYSTEM = (
    "You predict the very next message the USER will send in a conversation with their AI agent. "
    "Write it exactly as the user would type it: match their length, tone, casing, punctuation and "
    "vocabulary from their earlier messages. Usually it is a short follow-up, a go-ahead, a "
    "correction or the obvious next request given where the assistant left off. Output only the "
    "message text, with no quotes, labels or explanation. If there is no confident, natural next "
    "message, output nothing."
)

_LABEL_RE = re.compile(r"^(?:user|you|next message|message)\s*:\s*", re.IGNORECASE)


def _prediction_enabled() -> bool:
    aux = (_load_cfg().get("auxiliary") or {}).get(_PREDICT_TASK) or {}
    return bool(aux.get("enabled"))


def _user_style_samples(messages: list[dict[str, Any]]) -> list[str]:
    samples: list[str] = []
    for line in reversed(_message_digest_lines(messages)):
        if line.startswith("user: "):
            samples.append(line[len("user: "):][:_STYLE_SAMPLE_CHARS])
            if len(samples) == _STYLE_SAMPLES:
                break
    return list(reversed(samples))


def _tail(lines: list[str]) -> str:
    kept: list[str] = []
    used = 0
    for line in reversed(lines):
        if used + len(line) > _PREDICT_TAIL_CHARS:
            break
        kept.append(line)
        used += len(line) + 1
    return "\n".join(reversed(kept))


def clean_prediction(raw: str) -> str:
    """One line in the user's voice, or '' when the model answered instead of predicting."""
    text = _LABEL_RE.sub("", (raw or "").strip()).strip().strip('"“”').strip()
    if not text or len(text) > _MAX_PREDICTION_CHARS or "\n\n" in text:
        return ""
    return " ".join(text.split())


@method("session.predict_next")
@_profile_scoped
def _(rid, params: dict) -> dict:
    """``{"text": <suggestion or "">}`` for the session's composer. Empty is a normal answer:
    predictions off, nothing to go on, or no confident next message."""
    if not _str_param(params, "session_id"):
        return _err(rid, 4000, "session_id required")
    if not _prediction_enabled():
        return _ok(rid, {"text": ""})
    messages, _resolved, err = _ask_transcript(params)
    if err or not messages:
        return _ok(rid, {"text": ""})
    lines = _message_digest_lines(messages)
    # Only predict after the assistant has spoken last; mid-turn there is nothing to follow.
    if not lines or not lines[-1].startswith("assistant: "):
        return _ok(rid, {"text": ""})
    parts = ["Conversation so far (most recent last):", _tail(lines)]
    if samples := _user_style_samples(messages):
        parts.append("How this user writes (their recent messages):\n" + "\n".join(f"- {s}" for s in samples))
    parts.append("The user's next message:")
    try:
        from agent.auxiliary_client import call_llm, extract_content_or_reasoning
        response = call_llm(
            task=_PREDICT_TASK,
            messages=[{"role": "system", "content": _PREDICT_SYSTEM},
                      {"role": "user", "content": "\n\n".join(parts)}],
            temperature=None, max_tokens=_PREDICT_MAX_TOKENS, reasoning_config={"enabled": False})
        raw = extract_content_or_reasoning(response, max_reasoning_chars=0)
    except Exception as exc:  # a missed suggestion is silent by design
        logger.info("session.predict_next skipped: %s", exc)
        return _ok(rid, {"text": ""})
    return _ok(rid, {"text": clean_prediction(raw)})


def register(server):
    bind_module(globals(), server, skip=("_",))
