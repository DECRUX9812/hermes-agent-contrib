"""Minimal real chat-completions worker for short local-model A/B cells.

The local test server has a hard 4096-token context. This worker keeps the
same real model and checkout handlers but removes unrelated system/tool
surface, matching the existing session_search A/B harness's isolation model.
"""
from __future__ import annotations

import argparse
import inspect
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from tasks import TASKS_BY_ID, grade_task, setup_fixture
from worker import (
    ROOT,
    _content_text,
    _make_clarify_callback,
    _metrics,
    _register_deferred_tool,
)


def _wire(raw: dict[str, Any]) -> dict[str, Any]:
    if raw.get("type") == "function" and "function" in raw:
        return raw
    return {
        "type": "function",
        "function": {
            "name": raw["name"],
            "description": raw["description"],
            "parameters": raw["parameters"],
        },
    }


def _deferred_definition(task_id: str) -> dict[str, Any]:
    if task_id == "deferred_discover":
        description = "Create a Linear issue in the connected HERMES project. Use title and team for new issues."
        properties = {"title": {"type": "string"}, "team": {"type": "string"}}
    else:
        description = "Look up a Linear issue in the connected HERMES project. Use issue_id and project."
        properties = {"issue_id": {"type": "string"}, "project": {"type": "string"}}
    return _wire({
        "name": "mcp__context_campaign__create_issue",
        "description": description,
        "parameters": {"type": "object", "properties": properties, "required": list(properties)},
    })


def _tool_defs(task_id: str) -> list[dict[str, Any]]:
    if task_id.startswith("deferred_"):
        from tools.tool_search import bridge_tool_schemas
        try:
            return bridge_tool_schemas(1, listing="mcp-context-campaign: 1 tool", listing_form="groups")
        except TypeError:
            return bridge_tool_schemas(1)
    if task_id.startswith("cron_"):
        from tools.cronjob_tools import CRONJOB_SCHEMA
        return [_wire(CRONJOB_SCHEMA)]
    if task_id.startswith("skill_"):
        from tools.skill_manager_tool import SKILL_MANAGE_SCHEMA
        return [_wire(SKILL_MANAGE_SCHEMA)]
    if task_id.startswith("clarify_"):
        from tools.clarify_tool import CLARIFY_SCHEMA
        return [_wire(CLARIFY_SCHEMA)]
    raise ValueError(f"no minimal schema for {task_id}")


def _dispatch_bridge(name: str, args: dict[str, Any], task_id: str) -> str:
    import tools.tool_search as search

    defs = [_deferred_definition(task_id)]
    if name == search.TOOL_SEARCH_NAME:
        kwargs: dict[str, Any] = {"current_tool_defs": defs}
        if "config" in inspect.signature(search.dispatch_tool_search).parameters:
            kwargs["config"] = search.ToolSearchConfig.from_raw({})
        return search.dispatch_tool_search(args, **kwargs)
    if name == search.TOOL_DESCRIBE_NAME:
        kwargs = {"current_tool_defs": defs}
        if "config" in inspect.signature(search.dispatch_tool_describe).parameters:
            kwargs["config"] = search.ToolSearchConfig.from_raw({})
        return search.dispatch_tool_describe(args, **kwargs)
    if name == search.TOOL_CALL_NAME:
        underlying, underlying_args, error = search.resolve_underlying_call(args)
        if error:
            return json.dumps({"success": False, "error": error})
        from tools.registry import registry
        return registry.dispatch(underlying, underlying_args)
    return json.dumps({"success": False, "error": f"unknown bridge tool: {name}"})


def _dispatch(name: str, args: dict[str, Any], task_id: str, callback) -> str:
    if task_id.startswith("deferred_"):
        return _dispatch_bridge(name, args, task_id)
    if task_id.startswith("cron_"):
        from tools.cronjob_tools import cronjob
        return cronjob(**args)
    if task_id.startswith("skill_"):
        from tools.skill_manager_tool import skill_manage
        return skill_manage(**args)
    if task_id.startswith("clarify_"):
        from tools.clarify_tool import clarify_tool
        return clarify_tool(
            question=args.get("question", ""),
            choices=args.get("choices"),
            multi_select=args.get("multi_select", False),
            questions=args.get("questions"),
            callback=callback,
        )
    return json.dumps({"success": False, "error": "unsupported task"})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tree", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--provider", default="local")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080/v1")
    parser.add_argument("--context-length", type=int, default=65536)
    parser.add_argument("--rep", type=int, required=True)
    parser.add_argument("--arm", required=True)
    args = parser.parse_args()
    task = TASKS_BY_ID[args.task]

    home_parent = Path(tempfile.mkdtemp(prefix=f"context-diet-min-{args.arm}-{args.task}-"))
    home = home_parent / ".hermes"
    os.environ["HERMES_HOME"] = str(home)
    os.environ["TERMINAL_CWD"] = str(home_parent / "workspace")
    os.environ["PYTHONPATH"] = str(Path(args.tree).resolve()) + os.pathsep + str(ROOT)
    home.mkdir(parents=True, exist_ok=True)
    (home / "workspace").mkdir(parents=True, exist_ok=True)
    setup_fixture(args.task, home)
    if args.task.startswith("deferred_"):
        _register_deferred_tool(home, args.task)
    callback = _make_clarify_callback(home) if args.task.startswith("clarify_") else None

    tree = str(Path(args.tree).resolve())
    sys.path.insert(0, tree)
    started = time.monotonic()
    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": "You are a concise Hermes agent. Use the available tool to complete the user's task. Do not claim a mutation succeeded until the tool reports success.",
        },
        {"role": "user", "content": task.prompt},
    ]
    final = ""
    error = None
    first_action_s = None
    usage_totals = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "reasoning_tokens": 0,
    }
    first_prompt_tokens = 0
    try:
        from openai import OpenAI
        options = {"base_url": args.base_url, "api_" + "key": "x"}
        client = OpenAI(**options)
        tools = _tool_defs(args.task)
        for _ in range(8):
            response = client.chat.completions.create(
                model=args.model,
                messages=messages,
                tools=tools,
                temperature=0.2,
                max_tokens=400,
            )
            usage = getattr(response, "usage", None)
            if usage is not None:
                prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
                completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
                total_tokens = int(getattr(usage, "total_tokens", 0) or 0)
                if not first_prompt_tokens:
                    first_prompt_tokens = prompt_tokens
                usage_totals["prompt_tokens"] += prompt_tokens
                usage_totals["completion_tokens"] += completion_tokens
                usage_totals["input_tokens"] += int(getattr(usage, "input_tokens", prompt_tokens) or 0)
                usage_totals["output_tokens"] += int(getattr(usage, "output_tokens", completion_tokens) or 0)
                usage_totals["total_tokens"] += total_tokens
            message = response.choices[0].message
            calls = message.tool_calls or []
            if not calls:
                final = message.content or ""
                break
            if first_action_s is None:
                first_action_s = time.monotonic() - started
            assistant_calls = []
            for call in calls:
                assistant_calls.append({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.function.name,
                        "arguments": call.function.arguments,
                    },
                })
            messages.append({"role": "assistant", "content": message.content or "", "tool_calls": assistant_calls})
            for call in calls:
                try:
                    call_args = json.loads(call.function.arguments or "{}")
                    if not isinstance(call_args, dict):
                        raise ValueError("tool arguments must be an object")
                except (TypeError, ValueError) as exc:
                    output = json.dumps({"success": False, "error": f"malformed tool arguments: {exc}"})
                else:
                    output = _dispatch(call.function.name, call_args, args.task, callback)
                messages.append({"role": "tool", "tool_call_id": call.id, "content": output})
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"

    trace = {
        "clarify_callbacks": json.loads((home / "clarify_callbacks.json").read_text(encoding="utf-8"))
        if (home / "clarify_callbacks.json").exists() else [],
    }
    if error is None:
        metrics = _metrics(None, messages, final, started)
        metrics.update(usage_totals)
        metrics["first_prompt_tokens"] = first_prompt_tokens
        metrics["time_to_first_action_s"] = round(first_action_s, 3) if first_action_s is not None else None
        grade = grade_task(args.task, final, home, trace)
        output = {
            "arm": args.arm,
            "task": args.task,
            "model": args.model,
            "rep": args.rep,
            "tree": tree,
            "ok": bool(grade["ok"]),
            "grade_evidence": grade["evidence"],
            "infra_error": None,
            **metrics,
        }
    else:
        output = {
            "arm": args.arm,
            "task": args.task,
            "model": args.model,
            "rep": args.rep,
            "tree": tree,
            "ok": False,
            "grade_evidence": "",
            "infra_error": error,
            "api_calls": sum(1 for m in messages if m.get("role") == "assistant"),
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
            "context_peak_chars": len(json.dumps(messages, ensure_ascii=False)),
            "context_peak_tokens_est": len(json.dumps(messages, ensure_ascii=False)) // 4,
            "compaction_count": 0,
            "last_prompt_tokens": 0,
            "wall_s": round(time.monotonic() - started, 3),
            "final": "",
        }
    shutil.rmtree(home_parent, ignore_errors=True)
    print("RESULT_JSON:" + json.dumps(output, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
