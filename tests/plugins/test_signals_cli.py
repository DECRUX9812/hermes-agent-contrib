from __future__ import annotations

import argparse
import json

from plugins.signals.cli import signals_command


def test_signals_scan_json_file_prints_actionable_summary(tmp_path, capsys) -> None:
    trace_path = tmp_path / "trace.json"
    trace_path.write_text(
        json.dumps(
            {
                "events": [
                    {"type": "tool_call", "id": "1", "name": "update_record", "arguments": {"id": 42}},
                    {"type": "tool_result", "tool_call_id": "1", "status": "error", "content": "timeout"},
                    {"type": "assistant", "content": "The record was successfully updated."},
                ]
            }
        ),
        encoding="utf-8",
    )

    result = signals_command(
        argparse.Namespace(signals_action="scan", path=str(trace_path), output="text")
    )

    assert result == 0
    output = capsys.readouterr().out
    assert "false-success" in output
    assert "HIGH" in output
    assert "timeout" not in output


def test_signals_demo_json_is_machine_readable(capsys) -> None:
    result = signals_command(argparse.Namespace(signals_action="demo", output="json"))

    assert result == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["trace_id"]
    assert "false-success" in {item["signal_id"] for item in payload["signals"]}
