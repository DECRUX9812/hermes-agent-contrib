from __future__ import annotations

from plugins.signals.classifier import classify_trace


def test_eventual_success_is_not_false_success() -> None:
    trace = {
        "events": [
            {"type": "tool_call", "id": "1", "name": "update_record", "arguments": {"id": 42}},
            {"type": "tool_result", "tool_call_id": "1", "status": "error", "content": "timeout"},
            {"type": "tool_call", "id": "2", "name": "update_record", "arguments": {"id": 42}},
            {"type": "tool_result", "tool_call_id": "2", "status": "success", "content": "updated"},
            {"type": "assistant", "content": "The record was successfully updated."},
        ]
    }

    assert "false-success" not in {signal.signal_id for signal in classify_trace(trace)}
