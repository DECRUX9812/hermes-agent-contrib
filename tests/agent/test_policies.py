"""agent/policies.py — cost cap + retry-loop tripwire, resolved once per session."""
from __future__ import annotations

import copy
import types

from agent.policies import AgentPolicies, evaluate, resolve_policies


def _cfg(policies: dict | None) -> dict:
    return {"agent": {"policies": policies or {}}}


def _agent(**kw) -> types.SimpleNamespace:
    agent = types.SimpleNamespace(session_estimated_cost_usd=0.0, messages=[])
    agent.__dict__.update(kw)
    return agent


def _calls(name: str, args: dict, n: int):
    """Assistant rows each carrying n identical tool calls — a retry loop."""
    return [{"role": "assistant", "tool_calls": [{"name": name, "arguments": args}]} for _ in range(n)]


def test_resolve_defaults_and_overrides():
    default = resolve_policies(_cfg(None))
    assert default.max_cost_usd is None
    assert default.retry_loop_max_identical == 6

    tuned = resolve_policies(_cfg({"max_cost_usd": 2.5, "retry_loop_max_identical": 3}))
    assert tuned == AgentPolicies(max_cost_usd=2.5, retry_loop_max_identical=3)

    off = resolve_policies(_cfg({"retry_loop_detector": False}))
    assert off.retry_loop_max_identical is None
    assert resolve_policies(_cfg({"retry_loop_max_identical": 0})).retry_loop_max_identical is None


def test_cost_cap_trips_only_at_ceiling():
    under = _agent(session_estimated_cost_usd=1.0, _resolved_policies=AgentPolicies(2.0, 6))
    assert evaluate(under) is None
    over = _agent(session_estimated_cost_usd=2.5, _resolved_policies=AgentPolicies(2.0, 6))
    trip = evaluate(over)
    assert trip is not None and trip.policy == "max_cost_usd"
    assert "cost cap" in trip.reason


def test_retry_loop_trips_on_repeated_signature():
    messages = _calls("read_file", {"path": "/tmp/x"}, 6)
    agent = _agent(_resolved_policies=AgentPolicies(None, 6))
    trip = evaluate(agent, messages)
    assert trip is not None and trip.policy == "retry_loop"
    assert "read_file" in trip.reason


def test_retry_loop_ignores_distinct_calls_and_sub_limit():
    varied = [{"role": "assistant", "tool_calls": [{"name": "read_file", "arguments": {"path": f"/f{i}"}}]}
              for i in range(8)]
    agent = _agent(_resolved_policies=AgentPolicies(None, 6))
    assert evaluate(agent, varied) is None
    assert evaluate(agent, _calls("read_file", {"path": "/x"}, 5)) is None


def test_retry_loop_catches_alternating_cycle():
    """A,B,A,B alternating calls still repeat one signature inside the window."""
    ab = [{"role": "assistant", "tool_calls": [
        {"name": "read_file", "arguments": {"path": "/a"}},
        {"name": "terminal", "arguments": {"command": "ls"}},
    ]} for _ in range(3)]
    agent = _agent(_resolved_policies=AgentPolicies(None, 3))
    trip = evaluate(agent, ab)
    assert trip is not None and trip.policy == "retry_loop"


def test_evaluate_is_read_only_and_resolves_once():
    """No message mutation (cache invariant); resolution caches per agent."""
    messages = _calls("t", {}, 7)
    before = copy.deepcopy(messages)
    agent = _agent(_resolved_policies=AgentPolicies(0.0, 6))  # cost trip wins first
    trip = evaluate(agent, messages)
    assert trip is not None and trip.policy == "max_cost_usd"
    assert messages == before

    lazy = _agent()
    evaluate(lazy)
    resolved = lazy._resolved_policies
    evaluate(lazy)
    assert lazy._resolved_policies is resolved  # resolved once, reused per call
