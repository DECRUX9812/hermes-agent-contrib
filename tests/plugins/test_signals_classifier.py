from __future__ import annotations

from plugins.signals.classifier import classify_trace


def signal_ids(trace: dict) -> set[str]:
    return {signal.signal_id for signal in classify_trace(trace)}


def test_clean_verified_trace_has_no_signals() -> None:
    trace = {
        "events": [
            {"type": "tool_call", "id": "1", "name": "write_file", "arguments": {"path": "app.py"}},
            {"type": "tool_result", "tool_call_id": "1", "status": "success", "content": "written"},
            {"type": "tool_call", "id": "2", "name": "terminal", "arguments": {"command": "pytest -q"}},
            {"type": "tool_result", "tool_call_id": "2", "status": "success", "content": "3 passed"},
            {"type": "assistant", "content": "Implemented and verified the change; tests pass."},
        ]
    }

    assert signal_ids(trace) == set()


def test_detects_false_success_after_failed_tool_call() -> None:
    trace = {
        "events": [
            {"type": "tool_call", "id": "1", "name": "update_record", "arguments": {"id": 42}},
            {"type": "tool_result", "tool_call_id": "1", "status": "error", "content": "request timed out"},
            {"type": "assistant", "content": "The record was successfully updated."},
        ]
    }

    signals = classify_trace(trace)

    assert "false-success" in {signal.signal_id for signal in signals}
    false_success = next(signal for signal in signals if signal.signal_id == "false-success")
    assert false_success.severity == "high"
    assert false_success.evidence
    assert all("timed out" not in item for item in false_success.evidence)


def test_ignores_failure_when_assistant_admits_it() -> None:
    trace = {
        "events": [
            {"type": "tool_call", "id": "1", "name": "update_record", "arguments": {"id": 42}},
            {"type": "tool_result", "tool_call_id": "1", "status": "error", "content": "request timed out"},
            {"type": "assistant", "content": "I couldn't update the record because the request timed out."},
        ]
    }

    assert "false-success" not in signal_ids(trace)


def test_detects_repeated_identical_failed_tool_attempts() -> None:
    trace = {
        "events": [
            {"type": "tool_call", "id": "1", "name": "update_record", "arguments": {"id": 42}},
            {"type": "tool_result", "tool_call_id": "1", "status": "error", "content": "timeout"},
            {"type": "tool_call", "id": "2", "name": "update_record", "arguments": {"id": 42}},
            {"type": "tool_result", "tool_call_id": "2", "status": "error", "content": "timeout"},
            {"type": "assistant", "content": "I was unable to complete the operation."},
        ]
    }

    assert "retry-loop" in signal_ids(trace)


def test_detects_unverified_file_change() -> None:
    trace = {
        "events": [
            {"type": "tool_call", "id": "1", "name": "patch", "arguments": {"path": "app.py"}},
            {"type": "tool_result", "tool_call_id": "1", "status": "success", "content": "patched"},
            {"type": "assistant", "content": "The code change is complete."},
        ]
    }

    assert "unverified-change" in signal_ids(trace)


def test_secret_signal_redacts_evidence() -> None:
    secret = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    trace = {
        "events": [
            {"type": "tool_result", "status": "success", "content": f"token={secret}"},
            {"type": "assistant", "content": "I found a GitHub token in the output."},
        ]
    }

    signals = classify_trace(trace)

    secret_signal = next(signal for signal in signals if signal.signal_id == "secret-risk")
    assert secret not in repr(secret_signal)
    assert secret_signal.severity == "critical"


def test_secret_signal_also_checks_tool_arguments() -> None:
    secret = "sk-1234567890abcdefghijklmnopqrstuv"
    trace = {
        "events": [
            {
                "type": "tool_call",
                "name": "terminal",
                "arguments": {"command": f"curl -H 'Authorization: Bearer {secret}'"},
            },
        ]
    }

    assert "secret-risk" in signal_ids(trace)
