"""Per-session turn policies — hard caps that stop the loop without babysitting.

Resolved once per agent (first evaluation caches on ``agent._resolved_policies``),
evaluated between iterations from ``begin_iteration``. A trip only exits the loop
with a clear ``_turn_exit_reason`` plus a diagnostic line — it never mutates the
system prompt, tool schema, or persisted messages (prompt-caching invariant; see
``tests/agent/test_switch_model_cache_invariant.py`` for the switch-time sibling).

Config (``agent.policies`` in config.yaml):

- ``max_cost_usd``: hard cap on ``session_estimated_cost_usd``; null/0 = off.
- ``retry_loop_detector``: tripwire for a model stuck calling the same tool with
  the same arguments; default on.
- ``retry_loop_max_identical``: repeats of one (name, args) signature inside the
  trailing tool-call window that trip the detector (default 6).
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger("agent.policies")

_DEFAULT_MAX_IDENTICAL = 6
_RESOLVED_NONE = object()


@dataclass(frozen=True)
class AgentPolicies:
    """Resolved once per session — immutable like ``RuntimeMode`` so a mid-turn
    config write can never move the guardrails under a running conversation."""
    max_cost_usd: Optional[float]
    retry_loop_max_identical: Optional[int]


@dataclass(frozen=True)
class PolicyTrip:
    policy: str            # short id, also the _turn_exit_reason suffix
    reason: str            # human-readable diagnostic


def _config_policies(config: Optional[dict]) -> dict:
    if config is None:
        try:
            from hermes_cli.config import load_config_readonly
            config = load_config_readonly()
        except Exception:
            config = {}
    return ((config or {}).get("agent", {}) or {}).get("policies", {}) or {}


def resolve_policies(config: Optional[dict] = None) -> AgentPolicies:
    """``config["agent"]["policies"]`` → an immutable :class:`AgentPolicies`.

    ``retry_loop_detector: false`` disables the tripwire regardless of the count;
    a non-positive ``retry_loop_max_identical`` disables it the same way.
    """
    raw = _config_policies(config)
    try:
        max_cost = float(raw.get("max_cost_usd") or 0) or None
    except (TypeError, ValueError):
        max_cost = None
    enabled = raw.get("retry_loop_detector", True)
    try:
        max_identical = int(raw.get("retry_loop_max_identical", _DEFAULT_MAX_IDENTICAL))
    except (TypeError, ValueError):
        max_identical = _DEFAULT_MAX_IDENTICAL
    if enabled is False or max_identical <= 0:
        max_identical = None
    return AgentPolicies(max_cost_usd=max_cost, retry_loop_max_identical=max_identical)


def _policies_for(agent: Any) -> AgentPolicies:
    cached = getattr(agent, "_resolved_policies", _RESOLVED_NONE)
    if cached is _RESOLVED_NONE:
        cached = resolve_policies(getattr(agent, "_config", None))
        agent._resolved_policies = cached
    return cached


def _tool_call_signature(call: dict) -> str:
    """Stable signature for one tool call — name + canonicalized args, hashed so
    long tool payloads never accumulate in memory."""
    args = call.get("arguments") or call.get("args") or {}
    if isinstance(args, str):
        canonical = args[:4096]
    else:
        try:
            canonical = json.dumps(args, sort_keys=True, default=str)[:4096]
        except (TypeError, ValueError):
            canonical = str(args)[:4096]
    digest = hashlib.sha256(canonical.encode("utf-8", "replace")).hexdigest()[:16]
    name = call.get("name") or (call.get("function") or {}).get("name") or ""
    return f"{name}:{digest}"


def _recent_tool_call_signatures(messages: list, limit: int) -> list[str]:
    """Trailing ``limit`` tool-call signatures from the live message list."""
    sigs: list[str] = []
    for msg in reversed(messages or []):
        for call in reversed((msg or {}).get("tool_calls") or []):
            sigs.append(_tool_call_signature(call))
            if len(sigs) >= limit:
                return sigs
    return sigs


def evaluate(agent: Any, messages: Optional[list] = None) -> Optional[PolicyTrip]:
    """Check the resolved policies against live turn state; first trip wins.

    Returns ``None`` when nothing trips. Cost reads ``session_estimated_cost_usd``
    (the running estimate ``turn_usage`` maintains); the loop detector scans the
    trailing ``2 * max_identical`` tool calls and trips when any single signature
    appears ``max_identical`` times inside it — that catches both a straight
    A,A,A loop and an alternating A,B,A,B retry cycle.
    """
    policies = _policies_for(agent)

    if policies.max_cost_usd is not None:
        spent = float(getattr(agent, "session_estimated_cost_usd", 0.0) or 0.0)
        if spent >= policies.max_cost_usd:
            return PolicyTrip(
                policy="max_cost_usd",
                reason=f"session cost cap reached (${spent:.4f} >= ${policies.max_cost_usd:.4f})",
            )

    limit = policies.retry_loop_max_identical
    if limit:
        sigs = _recent_tool_call_signatures(messages or getattr(agent, "messages", None) or [], 2 * limit)
        for sig in set(sigs):
            if sigs.count(sig) >= limit:
                name = sig.split(":", 1)[0]
                return PolicyTrip(
                    policy="retry_loop",
                    reason=f"same tool call repeated {limit}+ times ({name or 'tool'}) — stopping a stuck retry loop",
                )
    return None
