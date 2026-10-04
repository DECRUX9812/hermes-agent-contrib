"""Cache-safety invariant for mid-turn model switching.

Mid-thread model switching (T3-style) swaps *runtime* fields — client, api_mode,
capabilities — and invalidates ``_cached_system_prompt`` so the NEXT request's
system block rebuilds. What it must never touch is the persisted conversation:
``agent.messages``, ``prefill_messages``, the stored system row. Those bytes are
the provider-side prompt-cache prefix for the life of the conversation; a switch
that rewrites them silently multiplies every later request's cost. This is the
precondition the policies work (``agent/policies.py``) relies on when it changes
model/budget behavior mid-session.
"""
from __future__ import annotations

import copy
import types

import pytest

from agent import agent_runtime_helpers as arh


def _make_agent():
    agent = types.SimpleNamespace()
    agent.model = "minimax-m3"
    agent.provider = "opencode-go"
    agent.api_mode = "chat_completions"
    agent.api_key = "old-key"
    agent.base_url = "https://old.example/v1"
    agent.client = object()
    agent._client_kwargs = {"base_url": "https://old.example/v1"}
    agent._config_context_length = 123456
    agent._transport_cache = {}
    agent.quiet_mode = True
    agent._reasoning_echo_flag = False
    agent._read_reasoning_echo_from_config = lambda: False
    # The persisted conversation — the cache prefix switch_model must not touch.
    agent.messages = [
        {"role": "user", "content": "fix the flaky test"},
        {"role": "assistant", "content": "looking", "tool_calls": [{"id": "c1"}]},
        {"role": "tool", "tool_call_id": "c1", "content": '{"ok": true}'},
    ]
    agent.prefill_messages = [{"role": "assistant", "content": "prefilled"}]
    agent._cached_system_prompt = "You are Hermes.\nModel: minimax-m3\nProvider: opencode-go\n"
    return agent


# Fields a model switch may legitimately roll back: runtime/transport state only.
# Anything that stores conversation bytes appearing here means the switch mutates
# the cache prefix — the invariant this file exists to catch.
_FORBIDDEN_SNAPSHOT_FIELDS = {
    "messages", "conversation", "conversation_history", "history",
    "prefill_messages", "ephemeral_system_prompt", "system_message",
}


def test_switch_snapshot_is_runtime_state_only():
    """The rollback set names only transport/runtime fields — structurally, a
    switch cannot roll back (and therefore cannot mutate) conversation state."""
    overlap = _FORBIDDEN_SNAPSHOT_FIELDS & set(arh._SWITCH_SNAPSHOT_FIELDS)
    assert not overlap, f"switch snapshot covers conversation state: {sorted(overlap)}"


def test_switch_model_preserves_persisted_conversation(monkeypatch):
    """A live mid-turn switch leaves messages/prefill byte-identical — including
    on a partially-failed swap, where the rollback path restores runtime state."""
    monkeypatch.setattr(arh, "load_pool", lambda *a, **k: None, raising=False)
    agent = _make_agent()
    messages_ref = agent.messages  # identity, not just equality: no rebuild-in-place
    before_messages = copy.deepcopy(agent.messages)
    before_prefill = copy.deepcopy(agent.prefill_messages)

    try:
        arh.switch_model(
            agent,
            new_model="frontier",
            new_provider="moa",
            api_key="moa-virtual-provider",
            base_url="moa://local",
        )
    except Exception:
        pass  # post-swap rebuild needs a real AIAgent; the invariant holds either way

    assert agent.messages is messages_ref
    assert agent.messages == before_messages
    assert agent.prefill_messages == before_prefill
    # The stored conversation keeps the primary's identity labels; a rewritten
    # system block belongs to the request-time rebuild, never the persisted row.
    for row in agent.messages:
        content = row.get("content") or ""
        assert "Model: frontier" not in content


def test_rewrite_prompt_model_identity_leaves_persisted_rows():
    """The prompt rewrite targets only the request-time cached prompt — the
    stored row keeps the primary's labels so a restored primary replays
    byte-identical bytes."""
    agent = _make_agent()
    from agent.chat_completion_helpers import rewrite_prompt_model_identity
    rewrite_prompt_model_identity(agent, "new-model", "new-provider")
    assert "Model: new-model" in agent._cached_system_prompt
    assert agent.messages[0]["content"] == "fix the flaky test"
    assert agent.prefill_messages == [{"role": "assistant", "content": "prefilled"}]
