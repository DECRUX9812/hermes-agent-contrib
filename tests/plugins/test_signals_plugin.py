from __future__ import annotations

import json

from plugins.signals import register
from plugins.signals.store import record_turn


class _Context:
    def __init__(self) -> None:
        self.hooks = {}
        self.commands = {}

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def register_cli_command(self, **kwargs):
        self.commands[kwargs["name"]] = kwargs


def test_plugin_registers_live_post_turn_observer() -> None:
    ctx = _Context()

    register(ctx)

    assert "post_llm_call" in ctx.hooks
    assert "signals" in ctx.commands


def test_record_turn_persists_only_bounded_signal_data(tmp_path) -> None:
    secret = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    payload = record_turn(
        messages=[
            {"role": "tool", "tool_call_id": "1", "content": f"token={secret}"},
            {"role": "assistant", "content": "I found a token."},
        ],
        final_response="I found a token.",
        path=tmp_path / "signals.jsonl",
    )

    saved = (tmp_path / "signals.jsonl").read_text(encoding="utf-8")
    assert payload["signals"][0]["signal_id"] == "secret-risk"
    assert secret not in saved
    assert secret not in json.dumps(payload)
