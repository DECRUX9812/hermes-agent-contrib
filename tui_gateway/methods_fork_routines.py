"""Profile-scoped routine management for Bot Mode."""

from __future__ import annotations

import json
from pathlib import Path

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped
_ROUTINE_META_PREFIX = "fork.routine."
_WATCH_PROMPT = (
    "Check this condition: {condition}\n"
    "If it is not true yet, answer exactly [SILENT] and nothing else. "
    "If it is true, say in one or two sentences what changed."
)


@_profile_scoped
@method("fork.routines.list")
def fork_routines_list(rid, params: dict) -> dict:
    if not _fork_routines_profile(params):
        return _err(rid, 4002, "profile is required")
    return _ok(rid, _fork_routines_list_result())


@_profile_scoped
@method("fork.routines.create")
def fork_routines_create(rid, params: dict) -> dict:
    name = str(params.get("name") or "").strip()
    kind = params.get("kind")
    schedule = str(params.get("schedule") or "").strip()
    prompt = str(params.get("prompt") or "").strip()
    condition = str(params.get("condition") or "").strip()
    if not _fork_routines_profile(params):
        return _err(rid, 4002, "profile is required")
    if not name or not schedule:
        return _err(rid, 4002, "name and schedule are required")
    if kind == "schedule" and not prompt:
        return _err(rid, 4002, "schedule routines need a prompt")
    if kind == "watch" and not condition:
        return _err(rid, 4002, "watch routines need a condition")
    if kind not in {"schedule", "watch"}:
        return _err(rid, 4002, "kind must be 'schedule' or 'watch'")

    routine_prompt = _WATCH_PROMPT.format(condition=condition) if kind == "watch" else prompt
    created, error = _fork_routines_cron_action(
        "create", name=name, schedule=schedule, prompt=routine_prompt,
        deliver=f"bot-chat:{params['profile']}")
    if error:
        return _err(rid, 4002, error)
    job_id = created.get("job_id")
    try:
        _fork_routines_write_meta(job_id, {"kind": kind, "condition": condition or None})
        return _ok(rid, _fork_routines_list_result())
    except Exception:
        _fork_routines_cron_action("remove", job_id=job_id)
        raise


@_profile_scoped
@method("fork.routines.update")
def fork_routines_update(rid, params: dict) -> dict:
    if not _fork_routines_profile(params):
        return _err(rid, 4002, "profile is required")
    job_id = str(params.get("id") or "").strip()
    record = _fork_routines_get_record(job_id)
    meta = _fork_routines_read_meta(job_id)
    if not record or not meta:
        return _err(rid, 4044, "routine not found")
    updates = {}
    for key in ("name", "schedule"):
        value = params.get(key)
        if value is not None:
            updates[key] = value

    kind = meta.get("kind", "schedule")
    condition = str(params.get("condition") or "").strip() if params.get("condition") is not None else meta.get("condition")
    if kind == "watch":
        if params.get("prompt") is not None:
            return _err(rid, 4002, "watch prompts are generated from the condition")
        if params.get("condition") is not None:
            if not condition:
                return _err(rid, 4002, "watch routines need a condition")
            updates["prompt"] = _WATCH_PROMPT.format(condition=condition)
    elif params.get("prompt") is not None:
        prompt = str(params["prompt"]).strip()
        if not prompt:
            return _err(rid, 4002, "schedule routines need a prompt")
        updates["prompt"] = prompt

    if not updates:
        return _err(rid, 4002, "no routine updates provided")
    _changed, error = _fork_routines_cron_action("update", job_id=job_id, **updates)
    if error:
        return _err(rid, 4002, error)
    if kind == "watch" and params.get("condition") is not None:
        _fork_routines_write_meta(job_id, {"kind": kind, "condition": condition})
    return _ok(rid, _fork_routines_list_result())


@_profile_scoped
@method("fork.routines.pause")
def fork_routines_pause(rid, params: dict) -> dict:
    return _fork_routines_lifecycle(rid, params, "pause")


@_profile_scoped
@method("fork.routines.resume")
def fork_routines_resume(rid, params: dict) -> dict:
    return _fork_routines_lifecycle(rid, params, "resume")


@_profile_scoped
@method("fork.routines.remove")
def fork_routines_remove(rid, params: dict) -> dict:
    if not _fork_routines_profile(params):
        return _err(rid, 4002, "profile is required")
    job_id = str(params.get("id") or "").strip()
    if not _fork_routines_is_routine(job_id):
        return _err(rid, 4044, "routine not found")
    _removed, error = _fork_routines_cron_action("remove", job_id=job_id)
    if error:
        return _err(rid, 5000, error)
    _fork_routines_delete_meta(job_id)
    return _ok(rid, _fork_routines_list_result())


@_profile_scoped
@method("fork.routines.run_now")
def fork_routines_run_now(rid, params: dict) -> dict:
    if not _fork_routines_profile(params):
        return _err(rid, 4002, "profile is required")
    job_id = str(params.get("id") or "").strip()
    if not _fork_routines_is_routine(job_id):
        return _err(rid, 4044, "routine not found")
    try:
        from agent.memory_provider import spawn_context_thread

        def run() -> None:
            _fork_routines_cron_action("run", job_id=job_id)

        spawn_context_thread(run, name="fork-routine-run").start()
        return _ok(rid, {**_fork_routines_list_result(), "started": True})
    except (ImportError, RuntimeError) as exc:
        return _err(rid, 5000, f"could not start routine: {exc}")


def _fork_routines_lifecycle(rid, params: dict, action: str) -> dict:
    if not _fork_routines_profile(params):
        return _err(rid, 4002, "profile is required")
    job_id = str(params.get("id") or "").strip()
    if not _fork_routines_is_routine(job_id):
        return _err(rid, 4044, "routine not found")
    _updated, error = _fork_routines_cron_action(action, job_id=job_id)
    if error:
        return _err(rid, 5000, error)
    return _ok(rid, _fork_routines_list_result())


def _fork_routines_profile(params: dict) -> str:
    return str(params.get("profile") or "").strip()


def _fork_routines_cron_action(action: str, **kwargs) -> tuple[dict, str | None]:
    from tools.cronjob_tools import cronjob

    try:
        result = json.loads(cronjob(action=action, **kwargs))
    except (TypeError, ValueError) as exc:
        return {}, str(exc)
    if not isinstance(result, dict) or not result.get("success"):
        return {}, str(result.get("error") or f"cron action '{action}' failed")
    return result, None


def _fork_routines_get_record(job_id: str) -> dict | None:
    from cron.jobs import get_job

    return get_job(job_id)


def _fork_routines_is_routine(job_id: str) -> bool:
    return bool(job_id and _fork_routines_get_record(job_id) and _fork_routines_read_meta(job_id))


def _fork_routines_meta_db():
    from hermes_constants import get_hermes_home
    from hermes_state_registry import acquire

    return acquire(Path(get_hermes_home()) / "state.db")


def _fork_routines_read_meta(job_id: str) -> dict | None:
    from hermes_state_registry import release_or_close

    db = _fork_routines_meta_db()
    try:
        raw = db.get_meta(_ROUTINE_META_PREFIX + job_id)
        value = json.loads(raw) if raw else None
        return value if isinstance(value, dict) else None
    finally:
        release_or_close(db)


def _fork_routines_write_meta(job_id: str, value: dict) -> None:
    from hermes_state_registry import release_or_close

    db = _fork_routines_meta_db()
    try:
        db.set_meta(_ROUTINE_META_PREFIX + job_id, json.dumps(value, ensure_ascii=False))
    finally:
        release_or_close(db)


def _fork_routines_delete_meta(job_id: str) -> None:
    from hermes_state_registry import release_or_close

    db = _fork_routines_meta_db()
    try:
        db._write_sql("DELETE FROM state_meta WHERE key = ?", (_ROUTINE_META_PREFIX + job_id,))
    finally:
        release_or_close(db)


def _fork_routines_list_result() -> dict:
    from cron.jobs import list_jobs
    from hermes_state_registry import release_or_close

    jobs = list_jobs(include_disabled=True)
    db = _fork_routines_meta_db()
    try:
        routines = []
        for job in jobs:
            raw_meta = db.get_meta(_ROUTINE_META_PREFIX + str(job["id"]))
            meta = json.loads(raw_meta) if raw_meta else None
            if not isinstance(meta, dict) or meta.get("kind") not in {"schedule", "watch"}:
                continue
            routine = {
                "id": job["id"],
                "name": job.get("name") or "",
                "kind": meta["kind"],
                "schedule": job.get("schedule_display") or "",
                "prompt": job.get("prompt") or "",
                "enabled": bool(job.get("enabled", True)),
                "next_run_at": job.get("next_run_at"),
                "last_run_at": job.get("last_run_at"),
                "last_status": job.get("last_status"),
                "deliver": job.get("deliver"),
            }
            if meta.get("condition") is not None:
                routine["condition"] = meta["condition"]
            routines.append(routine)
        return {"routines": routines}
    finally:
        release_or_close(db)


def register(server) -> None:
    bind_module(globals(), server)
