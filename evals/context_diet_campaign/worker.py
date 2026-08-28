"""Run one real-provider context-diet campaign cell."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from tasks import TASKS_BY_ID, grade_task, setup_fixture


ROOT = Path(__file__).resolve().parents[2]


def _write_config(
    home: Path,
    model: str,
    provider: str,
    base_url: str | None,
    context_length: int,
) -> None:
    import yaml

    cfg = {
        "model": {
            "provider": provider,
            "default": model,
            "max_tokens": 400 if provider == "local" else 1500,
            "context_length": context_length,
        },
        "agent": {"max_iterations": 20, "reasoning_effort": ""},
        "display": {"quiet": True},
        "compression": {"enabled": False},
        "tools": {
            "tool_search": {
                "enabled": "on",
                "listing": "on",
                "listing_max_tokens": 1200,
            }
        },
    }
    if base_url:
        cfg["model"]["base_url"] = base_url
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(yaml.safe_dump(cfg), encoding="utf-8")


def _record_path(home: Path) -> Path:
    return home / "deferred_tool_calls.json"


def _register_deferred_tool(home: Path, task_id: str) -> None:
    from tools.registry import registry

    name = "mcp__context_campaign__create_issue"
    description = (
        "Create a Linear issue in the connected HERMES project. "
        "Use title and team for new issues."
        if task_id == "deferred_discover"
        else "Look up a Linear issue in the connected HERMES project. "
        "Use issue_id and project."
    )
    properties = (
        {
            "title": {"type": "string"},
            "team": {"type": "string"},
        }
        if task_id == "deferred_discover"
        else {
            "issue_id": {"type": "string"},
            "project": {"type": "string"},
        }
    )
    record_file = _record_path(home)
    record_file.write_text(json.dumps({"calls": [], "successes": 0, "errors": 0}), encoding="utf-8")

    def handler(args: dict[str, Any], **_: Any) -> str:
        try:
            record = json.loads(record_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            record = {"calls": [], "successes": 0, "errors": 0}
        record.setdefault("calls", []).append(args)
        if task_id == "deferred_error_recovery" and record["errors"] == 0:
            record["errors"] += 1
            record_file.write_text(json.dumps(record), encoding="utf-8")
            return json.dumps({
                "success": False,
                "error": "project is required for this lookup",
                "hint": "Retry with project='HERMES'.",
            })
        record["successes"] += 1
        record_file.write_text(json.dumps(record), encoding="utf-8")
        if task_id == "deferred_discover":
            return json.dumps({
                "success": True,
                "issue_id": "HERMES-42",
                "title": args.get("title"),
                "team": args.get("team"),
            })
        return json.dumps({"success": True, "issue_id": args.get("issue_id"), "project": args.get("project")})

    registry.register(
        name=name,
        toolset="mcp-context-campaign",
        schema={
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": list(properties),
            },
        },
        handler=handler,
    )


def _make_clarify_callback(home: Path):
    path = home / "clarify_callbacks.json"
    path.write_text("[]", encoding="utf-8")

    def callback(question, choices, multi_select=False, questions=None):
        records = json.loads(path.read_text(encoding="utf-8"))
        entries = questions if isinstance(questions, list) else [{
            "question": question,
            "choices": choices,
            "multi_select": multi_select,
        }]
        responses = []
        for entry in entries:
            text = str(entry.get("question", "")).lower()
            answer = "staging" if "deploy" in text or "target" in text else "daily"
            responses.append({"question": entry.get("question", ""), "user_response": answer})
        records.append({"question": question, "choices": choices, "responses": responses})
        path.write_text(json.dumps(records), encoding="utf-8")
        if isinstance(questions, list):
            return json.dumps({"responses": responses})
        return responses[0]["user_response"]

    return callback


def _content_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(_content_text(item) for item in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value or "")


def _metrics(agent: Any, messages: list[dict[str, Any]], final: str, started: float) -> dict[str, Any]:
    tool_names: list[str] = []
    malformed = 0
    tool_errors = 0
    max_context_chars = 0
    for index, message in enumerate(messages):
        max_context_chars = max(max_context_chars, len(json.dumps(messages[: index + 1], ensure_ascii=False)))
        if message.get("role") == "assistant":
            for call in message.get("tool_calls") or []:
                fn = (call.get("function") or {}).get("name", "")
                tool_names.append(fn)
                try:
                    json.loads((call.get("function") or {}).get("arguments", "{}"))
                except (TypeError, ValueError):
                    malformed += 1
        elif message.get("role") == "tool":
            text = _content_text(message.get("content"))
            try:
                obj = json.loads(text)
            except (TypeError, ValueError):
                obj = None
            if isinstance(obj, dict) and (obj.get("error") or obj.get("success") is False):
                tool_errors += 1
            elif '"error"' in text.lower():
                tool_errors += 1
    compressor = getattr(agent, "context_compressor", None)
    return {
        "api_calls": sum(1 for m in messages if m.get("role") == "assistant"),
        "tool_calls": len(tool_names),
        "tool_call_names": tool_names,
        "malformed_tool_calls": malformed,
        "tool_error_results": tool_errors,
        "prompt_tokens": getattr(agent, "session_prompt_tokens", 0) or 0,
        "completion_tokens": getattr(agent, "session_completion_tokens", 0) or 0,
        "input_tokens": getattr(agent, "session_input_tokens", 0) or 0,
        "output_tokens": getattr(agent, "session_output_tokens", 0) or 0,
        "total_tokens": getattr(agent, "session_total_tokens", 0) or 0,
        "cache_read_tokens": getattr(agent, "session_cache_read_tokens", 0) or 0,
        "cache_write_tokens": getattr(agent, "session_cache_write_tokens", 0) or 0,
        "reasoning_tokens": getattr(agent, "session_reasoning_tokens", 0) or 0,
        "context_peak_chars": max_context_chars,
        "context_peak_tokens_est": max_context_chars // 4,
        "compaction_count": getattr(compressor, "compression_count", 0) if compressor else 0,
        "last_prompt_tokens": getattr(compressor, "last_prompt_tokens", 0) if compressor else 0,
        "wall_s": round(time.monotonic() - started, 3),
        "final": final[:4000],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tree", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--provider", default="openrouter")
    parser.add_argument("--base-url", default="")
    parser.add_argument("--context-length", type=int, default=65536)
    parser.add_argument("--rep", type=int, required=True)
    parser.add_argument("--arm", required=True)
    args = parser.parse_args()
    task = TASKS_BY_ID[args.task]

    home_parent = Path(tempfile.mkdtemp(prefix=f"context-diet-{args.arm}-{args.task}-"))
    home = home_parent / ".hermes"
    workspace = home_parent / "workspace"
    os.environ["HERMES_HOME"] = str(home)
    os.environ["TERMINAL_CWD"] = str(workspace)
    os.environ["PYTHONPATH"] = str(Path(args.tree).resolve()) + os.pathsep + str(ROOT)
    _write_config(
        home,
        args.model,
        args.provider,
        args.base_url or None,
        args.context_length,
    )
    if args.provider == "local":
        os.environ.setdefault("LOCAL" + "_API_KEY", "x")
    workspace.mkdir(parents=True, exist_ok=True)

    tree = str(Path(args.tree).resolve())
    sys.path.insert(0, tree)
    setup_fixture(args.task, home)
    if args.task.startswith("deferred_"):
        _register_deferred_tool(home, args.task)

    clarify_callback = _make_clarify_callback(home) if args.task.startswith("clarify_") else None
    started = time.monotonic()
    try:
        from run_agent import AIAgent

        agent_options = {
            "model": args.model,
            "provider": args.provider,
            "base_url": args.base_url or None,
            "max_iterations": 20,
            "max_tokens": 400 if args.provider == "local" else 1500,
            "reasoning_config": {"effort": "none"} if args.provider == "local" else None,
            "request_overrides": {"temperature": 0.2},
            "enabled_toolsets": list(task.toolsets),
            "quiet_mode": True,
            "skip_context_files": True,
            "skip_memory": True,
            "skip_background_review": True,
            "session_id": f"context-diet-{args.arm}-{args.task}-{args.rep}",
            "clarify_callback": clarify_callback,
        }
        if args.provider == "local":
            agent_options["api_" + "key"] = "x"
        agent = AIAgent(**agent_options)
        result = agent.run_conversation(task.prompt)
        final = result.get("final_response", "") if isinstance(result, dict) else str(result)
        messages = result.get("messages", []) if isinstance(result, dict) else []
        trace = {
            "clarify_callbacks": json.loads((home / "clarify_callbacks.json").read_text(encoding="utf-8"))
            if (home / "clarify_callbacks.json").exists() else [],
        }
        metrics = _metrics(agent, messages, final, started)
        grade = grade_task(args.task, final, home, trace)
        provider_failure = any(
            marker in final.lower()
            for marker in (
                "insufficient credits",
                "billing or credits exhausted",
                "authentication failed",
                "no llm provider configured",
            )
        )
        output = {
            "arm": args.arm,
            "task": args.task,
            "model": args.model,
            "rep": args.rep,
            "tree": tree,
            "ok": bool(grade["ok"]),
            "grade_evidence": grade["evidence"],
            "infra_error": (
                "provider configuration/billing failure: " + final[:500]
                if provider_failure else None
            ),
            **metrics,
        }
    except Exception as exc:  # noqa: BLE001
        text = f"{type(exc).__name__}: {exc}"
        output = {
            "arm": args.arm,
            "task": args.task,
            "model": args.model,
            "rep": args.rep,
            "tree": tree,
            "ok": False,
            "grade_evidence": "",
            "infra_error": text,
            "api_calls": 0,
            "tool_calls": 0,
            "tool_call_names": [],
            "malformed_tool_calls": 0,
            "tool_error_results": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "reasoning_tokens": 0,
            "context_peak_chars": 0,
            "context_peak_tokens_est": 0,
            "compaction_count": 0,
            "last_prompt_tokens": 0,
            "wall_s": round(time.monotonic() - started, 3),
            "final": "",
        }
    finally:
        shutil.rmtree(home_parent, ignore_errors=True)

    print("RESULT_JSON:" + json.dumps(output, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
