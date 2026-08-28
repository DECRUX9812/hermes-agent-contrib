"""Tasks and graders for the context-diet live A/B campaign.

Each task is run in a fresh temporary Hermes home by worker.py. Graders use
only persisted fixture state, callback/tool traces, and the final response;
there is no LLM judge in this layer.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class Task:
    task_id: str
    capability: str
    prompt: str
    toolsets: tuple[str, ...]


TASKS: tuple[Task, ...] = (
    Task(
        "cron_create",
        "cronjob simple recurring schedule",
        "Create a recurring job named `context-diet-cron-simple` for every Monday at 09:00. The job prompt must be exactly `Report the weekly context-diet benchmark status.` Set deliver to `local`. Do it now and then report the created job id.",
        ("cronjob",),
    ),
    Task(
        "cron_mutate_delete",
        "cronjob modification and deletion",
        "Find the existing cron job named `context-diet-seeded`, rename it to `context-diet-renamed`, change its prompt to exactly `Updated context-diet task.`, and then delete that renamed job. Do all three operations now and state what happened.",
        ("cronjob",),
    ),
    Task(
        "cron_malformed_recovery",
        "cronjob malformed schedule recovery",
        "First try to create a job with the malformed schedule `every someday` so the tool can explain the error. Then recover by creating exactly one job named `context-diet-cron-recovered` with schedule `every 2h`, prompt `Recovered after schedule validation.`, and deliver `local`. Report the final job id.",
        ("cronjob",),
    ),
    Task(
        "skill_create",
        "skill_manage create",
        "Create a skill named `context-diet-created` with category `campaign`. Its SKILL.md must have a valid YAML frontmatter block and the body must contain the exact marker `CONTEXT_DIET_CREATE_MARKER`. Use skill_manage now and confirm the persisted result.",
        ("skills",),
    ),
    Task(
        "skill_patch",
        "skill_manage targeted patch",
        "Update the existing skill `context-diet-patch-target` by replacing the exact text `ORIGINAL_CONTEXT_DIET_MARKER` with `PATCHED_CONTEXT_DIET_MARKER`. Use the targeted patch shape, not a full rewrite, and confirm the persisted result.",
        ("skills",),
    ),
    Task(
        "skill_rewrite",
        "skill_manage full-content rewrite",
        "Rewrite the complete SKILL.md for `context-diet-rewrite-target` so it contains the exact marker `REWRITTEN_CONTEXT_DIET_MARKER` and valid frontmatter. Use the current patch action with the `content` field for the full rewrite, then confirm the persisted result.",
        ("skills",),
    ),
    Task(
        "skill_legacy_edit",
        "skill_manage legacy edit compatibility",
        "Update `context-diet-legacy-target` so its SKILL.md contains `LEGACY_EDIT_COMPAT_MARKER`. Prefer the current supported shape, but complete the update without claiming success until the file is persisted.",
        ("skills",),
    ),
    Task(
        "clarify_single",
        "clarify one-question interaction",
        "This deployment decision is ambiguous. Ask me exactly one structured question offering `staging` and `production` as selectable choices, then continue using my answer.",
        ("clarify",),
    ),
    Task(
        "clarify_batch",
        "clarify multi-question interaction",
        "Ask me two independent structured questions in one clarify call: first choose `staging` or `production` for deployment, then choose `daily` or `weekly` for the report cadence. After I answer, continue using both answers.",
        ("clarify",),
    ),
    Task(
        "deferred_discover",
        "tool-search discovery and invocation",
        "Use the connected Linear issue capability to create an issue titled `Context diet benchmark probe` in team `HERMES`, then tell me the created issue id. Do not claim success without invoking the connected tool.",
        ("mcp-context-campaign",),
    ),
    Task(
        "deferred_error_recovery",
        "tool-search error recovery",
        "Use the connected Linear lookup capability to retrieve issue `HERMES-42`. If the first tool response is an error, follow its returned hint and retry with the corrected project argument. Do not claim success without a successful tool result.",
        ("mcp-context-campaign",),
    ),
)

TASKS_BY_ID = {task.task_id: task for task in TASKS}


_SEED_CONTENT = """---
name: {name}
description: Use when testing context-diet skill persistence.
version: 1.0.0
---

# {name}

Original marker: {marker}
"""


def setup_skill_fixture(task_id: str, home: Path) -> None:
    skills = home / "skills"
    if task_id == "skill_patch":
        target = skills / "context-diet-patch-target"
        target.mkdir(parents=True, exist_ok=True)
        (target / "SKILL.md").write_text(
            _SEED_CONTENT.format(
                name="context-diet-patch-target",
                marker="ORIGINAL_CONTEXT_DIET_MARKER",
            ),
            encoding="utf-8",
        )
    elif task_id == "skill_rewrite":
        target = skills / "context-diet-rewrite-target"
        target.mkdir(parents=True, exist_ok=True)
        (target / "SKILL.md").write_text(
            _SEED_CONTENT.format(
                name="context-diet-rewrite-target",
                marker="OLD_REWRITE_MARKER",
            ),
            encoding="utf-8",
        )
    elif task_id == "skill_legacy_edit":
        target = skills / "context-diet-legacy-target"
        target.mkdir(parents=True, exist_ok=True)
        (target / "SKILL.md").write_text(
            _SEED_CONTENT.format(
                name="context-diet-legacy-target",
                marker="OLD_LEGACY_MARKER",
            ),
            encoding="utf-8",
        )


def setup_cron_fixture(task_id: str, home: Path) -> None:
    if task_id != "cron_mutate_delete":
        return
    from cron.jobs import create_job

    create_job(
        prompt="Original context-diet task.",
        schedule="every 1h",
        name="context-diet-seeded",
        deliver="local",
    )


def setup_fixture(task_id: str, home: Path) -> None:
    setup_skill_fixture(task_id, home)
    setup_cron_fixture(task_id, home)


def _json_file(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _jobs(home: Path) -> list[dict[str, Any]]:
    raw = _json_file(home / "cron" / "jobs.json", {})
    if isinstance(raw, dict) and isinstance(raw.get("jobs"), list):
        return [j for j in raw["jobs"] if isinstance(j, dict)]
    if isinstance(raw, list):
        return [j for j in raw if isinstance(j, dict)]
    return []


def grade_task(task_id: str, final: str, home: Path, trace: dict[str, Any]) -> dict[str, Any]:
    low = final.lower()
    if task_id == "cron_create":
        jobs = _jobs(home)
        matches = [j for j in jobs if j.get("name") == "context-diet-cron-simple"]
        serialized = json.dumps(matches, ensure_ascii=False).lower()
        ok = bool(matches) and "weekly context-diet benchmark status." in serialized and "local" in serialized and (
            "monday" in serialized or "0 9" in serialized or "09:00" in serialized
        )
        return {"ok": ok, "evidence": serialized[:1200]}
    if task_id == "cron_mutate_delete":
        names = {str(j.get("name")) for j in _jobs(home)}
        ok = "context-diet-seeded" not in names and "context-diet-renamed" not in names
        return {"ok": ok, "evidence": json.dumps(sorted(names))}
    if task_id == "cron_malformed_recovery":
        jobs = [j for j in _jobs(home) if j.get("name") == "context-diet-cron-recovered"]
        serialized = json.dumps(jobs, ensure_ascii=False).lower()
        ok = bool(jobs) and "recovered after schedule validation." in serialized and "local" in serialized and (
            "2h" in serialized or '"kind": "interval"' in serialized
        )
        return {"ok": ok, "evidence": serialized[:1200]}
    if task_id.startswith("skill_"):
        names = {
            "skill_create": "context-diet-created",
            "skill_patch": "context-diet-patch-target",
            "skill_rewrite": "context-diet-rewrite-target",
            "skill_legacy_edit": "context-diet-legacy-target",
        }
        markers = {
            "skill_create": "CONTEXT_DIET_CREATE_MARKER",
            "skill_patch": "PATCHED_CONTEXT_DIET_MARKER",
            "skill_rewrite": "REWRITTEN_CONTEXT_DIET_MARKER",
            "skill_legacy_edit": "LEGACY_EDIT_COMPAT_MARKER",
        }
        path = home / "skills" / names[task_id] / "SKILL.md"
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            content = ""
        ok = content.startswith("---") and markers[task_id] in content
        return {"ok": ok, "evidence": content[:1200]}
    if task_id.startswith("clarify_"):
        callbacks = trace.get("clarify_callbacks") or []
        expected = 1 if task_id == "clarify_single" else 2
        responses = [
            response
            for callback in callbacks
            for response in (callback.get("responses") or [])
        ]
        response_text = json.dumps(responses, ensure_ascii=False).lower()
        if task_id == "clarify_single":
            ok = len(responses) >= expected and "staging" in response_text and "staging" in low
        else:
            ok = len(responses) >= expected and "staging" in response_text and "daily" in response_text and "staging" in low and "daily" in low
        return {"ok": ok, "evidence": response_text[:1200]}
    if task_id.startswith("deferred_"):
        record = _json_file(home / "deferred_tool_calls.json", {})
        calls = record.get("calls", []) if isinstance(record, dict) else []
        successes = record.get("successes", 0) if isinstance(record, dict) else 0
        errors = record.get("errors", 0) if isinstance(record, dict) else 0
        if task_id == "deferred_discover":
            ok = successes >= 1 and any("Context diet benchmark probe" in json.dumps(c) for c in calls)
        else:
            ok = errors >= 1 and successes >= 1
        return {"ok": ok, "evidence": json.dumps(record, ensure_ascii=False)[:1600]}
    return {"ok": False, "evidence": "unknown task"}
