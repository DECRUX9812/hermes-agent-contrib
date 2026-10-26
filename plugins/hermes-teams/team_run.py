"""Team runs: a template written into the Kanban kernel as one task graph.

    run root (completed at once; the run's blackboard and audit anchor)
        └─ one task per step, assigned to the step role's profile,
           gated on the root and on the steps it ``needs``

Same shape and transaction discipline as ``hermes_cli.kanban_swarm``: the graph is created in one
write transaction, the root is flipped to done inline, and ``recompute_ready`` runs after commit so
the dispatcher sees the first steps ready. The step map lives in a structured blackboard comment on
the root, so a run is read back from Kanban alone.
"""

from __future__ import annotations

import sqlite3
from typing import Any, Mapping, Optional

from hermes_cli import kanban_db as kb
from hermes_cli import kanban_swarm as swarm

from .catalog import Role, Template, TeamsError, topo_order

CREATED_BY = "hermes-teams"
BLACKBOARD_KEY = "team_run"
RESULT_PREVIEW = 2000


def _protocol(root_id: str, goal: str, step_key: str, final: bool, needs: tuple[str, ...]) -> str:
    lines = [
        "",
        "## Team protocol",
        f"- Team run root / shared blackboard: `{root_id}`. Your step: `{step_key}`.",
        "- Read the handoffs of the steps you depend on in your Kanban context before working."
        if needs else "- You start the run; the steps after you read your handoff.",
        "- Post notes for teammates as comments on the run root.",
        "- Your completion summary is your handoff: keep it specific.",
    ]
    if final:
        lines.append("- You are the final step: your result is the team's deliverable.")
    lines.append(f"- Goal: {goal}")
    return "\n".join(lines) + "\n"


def start_run(
    conn: sqlite3.Connection, *, template: Template, goal: str, roles: Mapping[str, Role],
    assignees: Mapping[str, str], workspace_kind: Optional[str] = None,
    workspace_path: Optional[str] = None, priority: int = 0, idempotency_key: Optional[str] = None,
) -> str:
    """Create the run graph and return its root task id. ``assignees`` maps role id -> profile."""
    goal = (goal or "").strip()
    if not goal:
        raise TeamsError("goal is required")
    order = topo_order(template)
    missing_roles = sorted({s.role for s in order if s.role not in roles})
    if missing_roles:
        raise TeamsError(f"template {template.id} uses unknown roles {missing_roles}")
    common = dict(created_by=CREATED_BY, workspace_kind=workspace_kind, workspace_path=workspace_path)
    summary = f"Team run planned: {template.name}."
    activated = False
    with kb.write_txn(conn):
        root = kb.create_task(
            conn, title=f"Team run: {template.name} — {goal.splitlines()[0][:70]}",
            body=f"{template.name} team run root. Completed at once; it stays the run's blackboard.\n\nGoal:\n{goal}",
            priority=priority, idempotency_key=idempotency_key, initial_status="blocked", **common,
        )
        if BLACKBOARD_KEY in swarm.latest_blackboard(conn, root):
            return root
        ids: dict[str, str] = {}
        steps: dict[str, dict[str, Any]] = {}
        for step in order:
            role = roles[step.role]
            profile = assignees.get(step.role) or role.profile
            body = (step.instructions + "\n" if step.instructions else "") + f"Role: {role.name}.\n"
            ids[step.key] = kb.create_task(
                conn, title=step.title, body=body + _protocol(root, goal, step.key, step.final, step.needs),
                assignee=profile, parents=[root, *(ids[n] for n in step.needs)], priority=priority,
                model_override=role.model, provider_override=role.provider, **common,
            )
            steps[step.key] = {"task_id": ids[step.key], "role": step.role, "profile": profile,
                               "title": step.title, "needs": list(step.needs), "final": step.final}
        swarm.post_blackboard_update(conn, root, author=CREATED_BY, key=BLACKBOARD_KEY, value={
            "template": template.id, "template_name": template.name, "goal": goal,
            "order": [s.key for s in order], "steps": steps,
        })
        if not swarm._activate_root_inline(conn, root, summary=summary,
                                           metadata={"kind": "hermes_team_run_v1", "template": template.id}):
            raise TeamsError("could not activate the team run")
        activated = True
    if activated:
        # recompute_ready opens its own transaction: never under the write_txn above.
        kb.recompute_ready(conn)
        run = kb.latest_run(conn, root)
        kb._fire_kanban_lifecycle_hook("kanban_task_completed", root, board=kb.get_current_board(),
                                       assignee=None, run_id=run.id if run else None, summary=summary)
    return root


def _plan(conn: sqlite3.Connection, root_id: str) -> dict:
    plan = swarm.latest_blackboard(conn, root_id).get(BLACKBOARD_KEY)
    if not isinstance(plan, dict) or not isinstance(plan.get("steps"), dict):
        raise TeamsError(f"'{root_id}' is not a team run")
    return plan


_ATTENTION = {"blocked", "triage"}


def _lane(conn: sqlite3.Connection, key: str, meta: dict) -> dict:
    task = kb.get_task(conn, str(meta.get("task_id") or ""))
    lane = {"key": key, **{k: meta.get(k) for k in ("role", "profile", "title", "needs", "final", "task_id")}}
    if task is None:
        return lane | {"status": "missing"}
    result = task.result or None
    return lane | {
        "status": task.status, "assignee": task.assignee, "started_at": task.started_at,
        "completed_at": task.completed_at, "last_heartbeat_at": task.last_heartbeat_at,
        "worker_pid": task.worker_pid, "last_failure_error": task.last_failure_error,
        "result": result[:RESULT_PREVIEW] if result else None,
        "comments": len(kb.list_comments(conn, task.id)),
    }


def _state(lanes: list[dict]) -> str:
    statuses = [lane["status"] for lane in lanes]
    final = next((lane for lane in lanes if lane.get("final")), None)
    if final is not None and final["status"] == "done":
        return "done"
    if any(s in _ATTENTION or s == "missing" or s == "archived" for s in statuses):
        return "attention"
    return "running" if any(s == "running" for s in statuses) else "queued"


def run_view(conn: sqlite3.Connection, root_id: str) -> dict:
    root = kb.get_task(conn, root_id)
    if root is None:
        raise TeamsError(f"no team run '{root_id}'")
    plan = _plan(conn, root_id)
    order = plan.get("order") or list(plan["steps"])
    lanes = [_lane(conn, key, plan["steps"][key]) for key in order if key in plan["steps"]]
    notes = [{"id": c.id, "author": c.author, "body": c.body, "created_at": c.created_at}
             for c in kb.list_comments(conn, root_id) if not (c.body or "").startswith(swarm.BLACKBOARD_PREFIX)]
    return {
        "id": root_id, "title": root.title, "created_at": root.created_at,
        "template": plan.get("template"), "template_name": plan.get("template_name"), "goal": plan.get("goal"),
        "state": _state(lanes), "done": sum(1 for lane in lanes if lane["status"] == "done"), "total": len(lanes),
        "lanes": lanes, "notes": notes,
    }


def list_runs(conn: sqlite3.Connection, *, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        "SELECT id FROM tasks WHERE created_by = ? AND status != 'archived' AND title LIKE 'Team run:%' "
        "ORDER BY created_at DESC LIMIT ?", (CREATED_BY, max(1, min(int(limit), 200))),
    ).fetchall()
    out = []
    for row in rows:
        try:
            view = run_view(conn, row[0])
        except TeamsError:
            continue
        out.append({k: view[k] for k in ("id", "title", "created_at", "template", "template_name",
                                          "goal", "state", "done", "total")})
    return out


def post_message(conn: sqlite3.Connection, root_id: str, *, body: str, author: str,
                 step: Optional[str] = None) -> int:
    """A note on the run root, or on one step's task (its worker sees it in its Kanban context)."""
    body = (body or "").strip()
    if not body:
        raise TeamsError("message body is required")
    plan = _plan(conn, root_id)
    if step is None:
        return kb.add_comment(conn, root_id, author=author, body=body)
    meta = plan["steps"].get(step)
    if not isinstance(meta, dict):
        raise TeamsError(f"no step '{step}' in this run")
    return kb.add_comment(conn, str(meta["task_id"]), author=author, body=body)
