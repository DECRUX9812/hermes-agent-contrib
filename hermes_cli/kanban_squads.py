"""Kanban Squads: role-based teams written into the Kanban kernel.

A **role** is a profile template: a SOUL.md and an optional pinned model. Its bot is an ordinary
profile (``squad-<role>``), so every other surface (Bot Chat, cron, messaging) treats it like any
profile. A **squad template** is a small step graph: each step names a role and the steps it
``needs``; exactly one step is ``final``. **Starting** a squad writes that graph as Kanban tasks:

    run root (completed at once; the run's blackboard and audit anchor)
        └─ one task per step, assigned to the step role's profile,
           gated on the root and on the steps it needs

Same shape and transaction discipline as :mod:`hermes_cli.kanban_swarm` (no second scheduler): the
dispatcher runs the steps, parent handoffs reach children through Kanban context, and the step map
lives in a structured blackboard comment on the root, so a run reads back from Kanban alone.

Built-in roles and templates can be extended or replaced with YAML under
``<kanban home>/kanban/squads/{roles,templates}/<id>.yaml``; a file named after a built-in replaces
it. Roles: ``name``, ``soul`` (required), ``emoji``, ``summary``, ``model``, ``provider``.
Templates: ``name``, ``summary``, ``steps: [{key, role, title, instructions, needs, final}]``.
"""

from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping, Optional

from hermes_cli import kanban_db as kb
from hermes_cli import kanban_swarm as swarm

PROFILE_PREFIX = "squad-"
CREATED_BY = "kanban-squads"
BLACKBOARD_KEY = "squad_run"
ROOT_TITLE_PREFIX = "Squad: "
RESULT_PREVIEW = 2000


class SquadError(ValueError):
    """A refusal every surface can show verbatim."""


# --- Catalog ----------------------------------------------------------------


@dataclass(frozen=True)
class Role:
    id: str
    name: str
    emoji: str
    summary: str
    soul: str
    model: Optional[str] = None
    provider: Optional[str] = None
    builtin: bool = True

    @property
    def profile(self) -> str:
        return f"{PROFILE_PREFIX}{self.id}"

    def as_dict(self) -> dict[str, Any]:
        return asdict(self) | {"profile": self.profile}


@dataclass(frozen=True)
class Step:
    key: str
    role: str
    title: str
    instructions: str = ""
    needs: tuple[str, ...] = ()
    final: bool = False


@dataclass(frozen=True)
class Template:
    id: str
    name: str
    summary: str
    steps: tuple[Step, ...]
    builtin: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "summary": self.summary, "builtin": self.builtin,
                "steps": [asdict(s) | {"needs": list(s.needs)} for s in self.steps]}


def _soul(title: str, mission: str, rules: tuple[str, ...]) -> str:
    bullets = "\n".join(f"- {r}" for r in rules)
    return f"# {title}\n\n{mission}\n\n## How you work\n{bullets}\n"


_HANDOFF = "Finish with a short handoff: what you did, what is left, and what the next teammate must know."

BUILTIN_ROLES: Mapping[str, Role] = {r.id: r for r in (
    Role("analyst", "Analyst", "🧭", "Turns a goal into a concrete plan with acceptance criteria.", _soul(
        "Analyst", "You turn a goal into a plan someone else can build without asking you questions.",
        ("Read the code and context before planning.", "List the files to touch and the acceptance criteria.",
         "Call out risks and open questions instead of guessing.", _HANDOFF))),
    Role("developer", "Developer", "🛠", "Implements the plan with the smallest complete change.", _soul(
        "Developer", "You implement the plan you are handed, completely and with the smallest diff that does it.",
        ("Follow the repository's conventions and instruction files.", "Run the relevant tests and fix what fails.",
         "Do not widen scope; note follow-ups instead.", _HANDOFF))),
    Role("qa", "QA", "🧪", "Writes and runs the tests that prove the change works.", _soul(
        "QA engineer", "You prove the change works, and find where it does not.",
        ("Write behaviour tests for the acceptance criteria.", "Exercise edge cases and failure paths.",
         "Report failures with exact reproduction steps.", _HANDOFF))),
    Role("reviewer", "Reviewer", "🔍", "Reviews the finished work and gates it.", _soul(
        "Reviewer", "You review the squad's finished work and decide whether it is ready.",
        ("Check correctness first, then tests, then style.", "Only flag issues you can point to.",
         "Approve, or block with the exact work still missing.", _HANDOFF))),
    Role("researcher", "Researcher", "📚", "Finds and verifies sources.", _soul(
        "Researcher", "You find what is true, with sources a reader can check.",
        ("Prefer primary sources and say how fresh they are.", "Separate facts, claims and your own inference.",
         "Quote sparingly and link everything.", _HANDOFF))),
    Role("writer", "Writer", "✍", "Turns findings into a clear brief.", _soul(
        "Writer", "You turn your teammates' findings into a brief a busy reader can act on.",
        ("Lead with the answer.", "Keep only what the reader needs; cite sources inline.",
         "Flag disagreements between sources instead of hiding them.", _HANDOFF))),
)}

BUILTIN_TEMPLATES: Mapping[str, Template] = {t.id: t for t in (
    Template("feature", "Feature", "Plan, then build and test in parallel, then review.", (
        Step("plan", "analyst", "Plan the change"),
        Step("build", "developer", "Build it", needs=("plan",)),
        Step("tests", "qa", "Test it", needs=("plan",)),
        Step("review", "reviewer", "Review and gate", needs=("build", "tests"), final=True),
    )),
    Template("research-brief", "Research brief", "Two researchers in parallel, then one brief.", (
        Step("primary", "researcher", "Primary sources", "Find primary sources: papers, specs, official docs, data."),
        Step("practice", "researcher", "Practice and field reports",
             "Find how practitioners use it: case studies, issues, talks, benchmarks."),
        Step("brief", "writer", "Write the brief", needs=("primary", "practice"), final=True),
    )),
)}


def squads_root() -> Path:
    """Beside the board, not in a profile home: a squad spans profiles like the board does."""
    return kb.kanban_home() / "kanban" / "squads"


def _yaml_entries(kind: str) -> list[tuple[str, dict]]:
    from utils import load_yaml_file_readonly

    folder = squads_root() / kind
    out = []
    for path in sorted(folder.glob("*.yaml")) if folder.is_dir() else ():
        try:
            data = load_yaml_file_readonly(path) or {}
        except Exception as exc:  # the parser's error types belong to the YAML backend
            raise SquadError(f"{path.name}: {exc}") from exc
        if not isinstance(data, dict):
            raise SquadError(f"{path.name}: expected a mapping")
        out.append((path.stem, data))
    return out


def _text(data: dict, key: str, where: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SquadError(f"{where}: '{key}' is required")
    return value.strip()


def role_from_dict(role_id: str, data: dict) -> Role:
    where = f"role {role_id}"
    model, provider = data.get("model") or None, data.get("provider") or None
    if provider and not model:
        raise SquadError(f"{where}: 'provider' needs 'model'")
    return Role(role_id, _text(data, "name", where), str(data.get("emoji") or "🤖"),
                str(data.get("summary") or ""), _text(data, "soul", where), model, provider, builtin=False)


def template_from_dict(template_id: str, data: dict) -> Template:
    where = f"template {template_id}"
    raw = data.get("steps")
    if not isinstance(raw, list) or not raw:
        raise SquadError(f"{where}: 'steps' must be a non-empty list")
    steps = []
    for i, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            raise SquadError(f"{where}: step {i} must be a mapping")
        key = _text(item, "key", f"{where} step {i}")
        needs = item.get("needs") or []
        if not isinstance(needs, list) or not all(isinstance(n, str) for n in needs):
            raise SquadError(f"{where} step {key}: 'needs' must be a list of step keys")
        steps.append(Step(key, _text(item, "role", f"{where} step {key}"), str(item.get("title") or key),
                          str(item.get("instructions") or ""), tuple(needs), bool(item.get("final"))))
    template = Template(template_id, _text(data, "name", where), str(data.get("summary") or ""),
                        tuple(steps), builtin=False)
    step_order(template)
    return template


def step_order(template: Template) -> list[Step]:
    """Steps in dependency order. Refuses duplicate keys, unknown needs, cycles, and anything but
    exactly one final step."""
    where = f"template {template.id}"
    by_key = {s.key: s for s in template.steps}
    if len(by_key) != len(template.steps):
        raise SquadError(f"{where}: step keys must be unique")
    for step in template.steps:
        unknown = [n for n in step.needs if n not in by_key]
        if unknown:
            raise SquadError(f"{where} step {step.key}: unknown needs {unknown}")
    finals = sum(1 for s in template.steps if s.final)
    if finals != 1:
        raise SquadError(f"{where}: exactly one step must be final (found {finals})")
    order: list[Step] = []
    placed: set[str] = set()

    def visit(key: str, trail: tuple[str, ...]) -> None:
        if key in placed:
            return
        if key in trail:
            raise SquadError(f"{where}: steps form a cycle through {' -> '.join((*trail, key))}")
        for need in by_key[key].needs:
            visit(need, (*trail, key))
        placed.add(key)
        order.append(by_key[key])

    for step in template.steps:
        visit(step.key, ())
    return order


def roles() -> dict[str, Role]:
    return dict(BUILTIN_ROLES) | {rid: role_from_dict(rid, d) for rid, d in _yaml_entries("roles")}


def templates() -> dict[str, Template]:
    return dict(BUILTIN_TEMPLATES) | {tid: template_from_dict(tid, d) for tid, d in _yaml_entries("templates")}


def get_role(role_id: str) -> Role:
    found = roles().get(role_id)
    if found is None:
        raise SquadError(f"no role '{role_id}'")
    return found


def get_template(template_id: str) -> Template:
    found = templates().get(template_id)
    if found is None:
        raise SquadError(f"no squad template '{template_id}'")
    return found


def ensure_role_bot(role: Role, *, clone_from: Optional[str] = None) -> tuple[str, bool]:
    """Create the role's profile if missing; returns ``(profile, created)``.

    It clones the source profile's config so it starts with a working model and keys
    (``create_profile`` strips messaging channels from every clone), then takes the role's SOUL.md.
    """
    from hermes_cli.profiles import create_profile, profile_exists

    if profile_exists(role.profile):
        return role.profile, False
    create_profile(role.profile, clone_from=clone_from, clone_config=True, soul=role.soul,
                   description=f"{role.name}: {role.summary}" if role.summary else role.name)
    return role.profile, True


def roles_view() -> list[dict[str, Any]]:
    from hermes_cli.profiles import profile_exists

    return [r.as_dict() | {"bot_exists": profile_exists(r.profile)} for r in roles().values()]


def resolve_assignees(template: Template, catalog: Mapping[str, Role], chosen: Optional[Mapping[str, str]] = None,
                      *, create_missing: bool = False) -> dict[str, str]:
    """Role -> profile for every role ``template`` uses. A role defaults to its own bot; with
    ``create_missing`` the missing default bots are created. Any profile still missing is refused."""
    from hermes_cli.profiles import profile_exists

    chosen = dict(chosen or {})
    unknown = sorted({s.role for s in template.steps if s.role not in catalog})
    if unknown:
        raise SquadError(f"template {template.id} uses unknown roles {unknown}")
    out = {s.role: str(chosen.get(s.role) or catalog[s.role].profile) for s in template.steps}
    for role_id, profile in out.items():
        if create_missing and profile == catalog[role_id].profile:
            ensure_role_bot(catalog[role_id])
    missing = sorted({p for p in out.values() if not profile_exists(p)})
    if missing:
        raise SquadError(f"these teammates have no profile yet: {', '.join(missing)}")
    return out


# --- Runs -------------------------------------------------------------------


def _protocol(root_id: str, goal: str, step: Step) -> str:
    lines = [
        "", "## Squad protocol",
        f"- Squad root / shared blackboard: `{root_id}`. Your step: `{step.key}`.",
        "- Read the handoffs of the steps you depend on in your Kanban context before working."
        if step.needs else "- You start the squad; the steps after you read your handoff.",
        "- Post notes for teammates as comments on the squad root.",
        "- Your completion summary is your handoff: keep it specific.",
    ]
    if step.final:
        lines.append("- You are the final step: your result is the squad's deliverable.")
    lines.append(f"- Goal: {goal}")
    return "\n".join(lines) + "\n"


def start_run(
    conn: sqlite3.Connection, *, template: Template, goal: str, catalog: Mapping[str, Role],
    assignees: Mapping[str, str], workspace_kind: Optional[str] = None, workspace_path: Optional[str] = None,
    priority: int = 0, idempotency_key: Optional[str] = None,
) -> str:
    """Write the squad graph atomically and return the root task id. ``assignees`` maps role -> profile."""
    goal = (goal or "").strip()
    if not goal:
        raise SquadError("goal is required")
    order = step_order(template)
    common = dict(created_by=CREATED_BY, workspace_kind=workspace_kind, workspace_path=workspace_path)
    summary = f"Squad planned: {template.name}."
    with kb.write_txn(conn):
        root = kb.create_task(
            conn, title=f"{ROOT_TITLE_PREFIX}{template.name} — {goal.splitlines()[0][:70]}",
            body=f"{template.name} squad root. Completed at once; it stays the squad's blackboard.\n\nGoal:\n{goal}",
            priority=priority, idempotency_key=idempotency_key, initial_status="blocked", **common,
        )
        # An idempotent replay returns the existing root: never write a second graph under it.
        if BLACKBOARD_KEY in swarm.latest_blackboard(conn, root):
            return root
        ids: dict[str, str] = {}
        steps: dict[str, dict[str, Any]] = {}
        for step in order:
            role = catalog[step.role]
            profile = assignees.get(step.role) or role.profile
            body = (f"{step.instructions}\n" if step.instructions else "") + f"Role: {role.name}.\n"
            ids[step.key] = kb.create_task(
                conn, title=step.title, body=body + _protocol(root, goal, step), assignee=profile,
                parents=[root, *(ids[n] for n in step.needs)], priority=priority,
                model_override=role.model, provider_override=role.provider, **common,
            )
            steps[step.key] = {"task_id": ids[step.key], "role": step.role, "profile": profile,
                               "title": step.title, "needs": list(step.needs), "final": step.final}
        swarm.post_blackboard_update(conn, root, author=CREATED_BY, key=BLACKBOARD_KEY, value={
            "template": template.id, "template_name": template.name, "goal": goal,
            "order": [s.key for s in order], "steps": steps,
        })
        if not swarm._activate_root_inline(conn, root, summary=summary,
                                           metadata={"kind": "kanban_squad_v1", "template": template.id}):
            raise SquadError("could not activate the squad")
    # After commit: recompute_ready opens its own transaction.
    kb.recompute_ready(conn)
    run = kb.latest_run(conn, root)
    kb._fire_kanban_lifecycle_hook("kanban_task_completed", root, board=kb.get_current_board(),
                                   assignee=None, run_id=run.id if run else None, summary=summary)
    return root


def _plan(conn: sqlite3.Connection, root_id: str) -> dict:
    plan = swarm.latest_blackboard(conn, root_id).get(BLACKBOARD_KEY)
    if not isinstance(plan, dict) or not isinstance(plan.get("steps"), dict):
        raise SquadError(f"'{root_id}' is not a squad")
    return plan


def _lane(conn: sqlite3.Connection, key: str, meta: dict) -> dict:
    lane = {"key": key} | {k: meta.get(k) for k in ("role", "profile", "title", "needs", "final", "task_id")}
    task = kb.get_task(conn, str(meta.get("task_id") or ""))
    if task is None:
        return lane | {"status": "missing"}
    return lane | {
        "status": task.status, "assignee": task.assignee, "started_at": task.started_at,
        "completed_at": task.completed_at, "last_heartbeat_at": task.last_heartbeat_at,
        "worker_pid": task.worker_pid, "last_failure_error": task.last_failure_error,
        "result": task.result[:RESULT_PREVIEW] if task.result else None,
        "comments": len(kb.list_comments(conn, task.id)),
    }


_NEEDS_ATTENTION = frozenset({"blocked", "triage", "missing", "archived"})


def run_state(lanes: list[dict]) -> str:
    """``done`` once the final step is; ``attention`` when a step is stuck; else ``running``/``queued``."""
    if any(lane.get("final") and lane["status"] == "done" for lane in lanes):
        return "done"
    statuses = {lane["status"] for lane in lanes}
    if statuses & _NEEDS_ATTENTION:
        return "attention"
    return "running" if "running" in statuses else "queued"


def run_view(conn: sqlite3.Connection, root_id: str) -> dict:
    root = kb.get_task(conn, root_id)
    if root is None:
        raise SquadError(f"no squad '{root_id}'")
    plan = _plan(conn, root_id)
    order = [k for k in plan.get("order") or plan["steps"] if k in plan["steps"]]
    lanes = [_lane(conn, key, plan["steps"][key]) for key in order]
    notes = [{"id": c.id, "author": c.author, "body": c.body, "created_at": c.created_at}
             for c in kb.list_comments(conn, root_id) if not (c.body or "").startswith(swarm.BLACKBOARD_PREFIX)]
    return {
        "id": root_id, "title": root.title, "created_at": root.created_at,
        "template": plan.get("template"), "template_name": plan.get("template_name"), "goal": plan.get("goal"),
        "state": run_state(lanes), "done": sum(1 for lane in lanes if lane["status"] == "done"),
        "total": len(lanes), "lanes": lanes, "notes": notes,
    }


_SUMMARY_KEYS = ("id", "title", "created_at", "template", "template_name", "goal", "state", "done", "total")


def list_runs(conn: sqlite3.Connection, *, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        "SELECT id FROM tasks WHERE created_by = ? AND status != 'archived' AND title LIKE ? "
        "ORDER BY created_at DESC, id DESC LIMIT ?",
        (CREATED_BY, f"{ROOT_TITLE_PREFIX}%", max(1, min(int(limit), 200))),
    ).fetchall()
    out = []
    for (root_id,) in rows:
        try:
            view = run_view(conn, root_id)
        except SquadError:
            continue
        out.append({k: view[k] for k in _SUMMARY_KEYS})
    return out


def post_message(conn: sqlite3.Connection, root_id: str, *, body: str, author: str,
                 step: Optional[str] = None) -> int:
    """A note on the squad root, or on one step's task, whose worker reads it in its Kanban context."""
    body = (body or "").strip()
    if not body:
        raise SquadError("message body is required")
    plan = _plan(conn, root_id)
    if step is None:
        return kb.add_comment(conn, root_id, author=author, body=body)
    meta = plan["steps"].get(step)
    if not isinstance(meta, dict):
        raise SquadError(f"no step '{step}' in this squad")
    return kb.add_comment(conn, str(meta["task_id"]), author=author, body=body)
