"""Team goal boards over the existing Team Bots and Kanban stores."""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import sqlite3
import time
from collections import deque
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from utils import atomic_json_write


COLUMN_KEYS = ("queued", "in_progress", "needs_approval", "done")

# Kanban's default workflow is authoritative; these aliases cover older and in-flight records.
COLUMN_BY_STATUS = {
    "triage": "queued",
    "todo": "queued",
    "ready": "queued",
    "scheduled": "queued",
    "claimed": "in_progress",
    "running": "in_progress",
    "blocked": "needs_approval",
    "review": "needs_approval",
    "done": "done",
    "archived": "done",
}

TEMPLATES = (
    {
        "id": "full-stack-swarm",
        "name": "Full-Stack Swarm",
        "description": "A lead coordinates frontend, backend, and QA work.",
        "profile_prefix": "fs",
        "mission": "Deliver the goal through coordinated frontend, backend, and QA work.",
        "seats": (
            {
                "role": "lead",
                "title": "Team lead",
                "job": "lead",
                "reports_to": None,
                "lead": True,
                "instruction": "Break goals into clear, independently verifiable teammate tasks. "
                "Track dependencies, review each result, and report the integrated outcome.",
            },
            {
                "role": "frontend",
                "title": "Frontend engineer",
                "job": "frontend",
                "reports_to": "lead",
                "lead": False,
                "instruction": "Implement the user-interface portion of assigned work and report "
                "changed files, validation, and remaining risks.",
            },
            {
                "role": "backend",
                "title": "Backend engineer",
                "job": "backend",
                "reports_to": "lead",
                "lead": False,
                "instruction": "Implement the service and data portion of assigned work and report "
                "changed files, validation, and remaining risks.",
            },
            {
                "role": "qa",
                "title": "QA engineer",
                "job": "quality assurance",
                "reports_to": "lead",
                "lead": False,
                "instruction": "Verify assigned behavior with focused tests, record reproducible "
                "failures, and report coverage gaps.",
            },
        ),
    },
    {
        "id": "research-report",
        "name": "Research & Report",
        "description": "A lead coordinates research, writing, and fact-checking.",
        "profile_prefix": "rr",
        "mission": "Produce a well-supported report through research, writing, and fact-checking.",
        "seats": (
            {
                "role": "lead",
                "title": "Research lead",
                "job": "lead",
                "reports_to": None,
                "lead": True,
                "instruction": "Turn the goal into research, writing, and verification tasks. "
                "Review evidence and reconcile the final report.",
            },
            {
                "role": "researcher",
                "title": "Researcher",
                "job": "research",
                "reports_to": "lead",
                "lead": False,
                "instruction": "Gather primary sources and concise evidence relevant to the assigned "
                "question. Distinguish facts from inference.",
            },
            {
                "role": "writer",
                "title": "Writer",
                "job": "writing",
                "reports_to": "lead",
                "lead": False,
                "instruction": "Write a clear, structured report from supplied evidence, marking "
                "uncertainty rather than inventing details.",
            },
            {
                "role": "fact-checker",
                "title": "Fact-checker",
                "job": "fact-checking",
                "reports_to": "lead",
                "lead": False,
                "instruction": "Verify report claims against reliable sources and return corrections "
                "with citations or evidence.",
            },
        ),
    },
)
_TEMPLATE_BY_ID = {template["id"]: template for template in TEMPLATES}


class TeamBoardError(ValueError):
    """A board operation refusal with its JSON-RPC error code."""

    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def list_templates() -> list[dict]:
    """Return the built-in team templates as JSON-ready data."""
    return [
        {
            "template_id": template["id"],
            "name": template["name"],
            "description": template["description"],
            "seats": [
                {
                    key: seat[key]
                    for key in ("role", "title", "reports_to", "instruction", "lead")
                }
                for seat in template["seats"]
            ],
        }
        for template in TEMPLATES
    ]


@contextmanager
def _profile_scope(profile: str | None):
    """Bind the target profile's home, secret and terminal scopes together."""
    from hermes_cli.profiles import get_profile_dir
    from tui_gateway.server import (
        _launch_home,
        _profile_runtime_scope_tokens,
        _release_profile_runtime_scope_tokens,
    )

    try:
        target_home = Path(get_profile_dir(profile or "default"))
    except (ValueError, FileNotFoundError) as exc:
        raise TeamBoardError(4140, f"invalid profile {profile!r}") from exc
    launch_home = Path(_launch_home())
    scopes = _profile_runtime_scope_tokens(
        None if target_home.resolve() == launch_home.resolve() else str(target_home)
    )
    try:
        yield target_home
    finally:
        _release_profile_runtime_scope_tokens(scopes)


@contextmanager
def _board_connection(db_path: str | Path, profile: str | None):
    from hermes_cli import kanban_db_connect as kbc

    path = Path(db_path)
    if not path.is_file():
        yield None
        return
    with _profile_scope(profile):
        with kbc.connect_closing(db_path=path) as conn:
            yield conn


def _root_board_path(profile: str | None) -> str:
    from hermes_cli import kanban_db as kb

    with _profile_scope(profile):
        return str(kb.kanban_db_path())


def _task_profile(task, latest_run, fallback: str | None) -> str | None:
    return task.assignee or (latest_run.profile if latest_run else None) or fallback


def _load_task_context(task_id: str, db_path: str, fallback_profile: str | None) -> dict | None:
    """Read task ownership first, then re-read its board under that member's scope."""
    from hermes_cli import kanban_db as kb

    with _board_connection(db_path, fallback_profile) as conn:
        if conn is None:
            return None
        first_task = kb.get_task(conn, task_id)
        if first_task is None:
            return None
        first_run = kb.latest_run(conn, task_id)
        profile = _task_profile(first_task, first_run, fallback_profile)

    with _board_connection(db_path, profile) as conn:
        if conn is None:
            return None
        task = kb.get_task(conn, task_id)
        if task is None:
            return None
        runs = kb.list_runs(conn, task_id)
        latest_run = runs[-1] if runs else None
        events = kb.list_events(conn, task_id)
        children = kb.child_ids(conn, task_id)
    return {
        "task": task,
        "runs": runs,
        "latest_run": latest_run,
        "events": events,
        "children": children,
        "profile": _task_profile(task, latest_run, fallback_profile),
    }


def _session_usage(profile: str, session_id: str) -> tuple[int | None, float | None] | None:
    try:
        with _profile_scope(profile) as profile_home:
            state_path = profile_home / "state.db"
            if not state_path.is_file():
                return None
            conn = sqlite3.connect(state_path.resolve().as_uri() + "?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            try:
                row = conn.execute(
                    "SELECT input_tokens, output_tokens, actual_cost_usd, estimated_cost_usd "
                    "FROM sessions WHERE id = ?",
                    (session_id,),
                ).fetchone()
            finally:
                conn.close()
    except (sqlite3.Error, TeamBoardError):
        return None
    if row is None:
        return None
    token_count = None
    if row["input_tokens"] is not None and row["output_tokens"] is not None:
        token_count = int(row["input_tokens"]) + int(row["output_tokens"])
    cost = row["actual_cost_usd"]
    if cost is None:
        cost = row["estimated_cost_usd"]
    return token_count, float(cost) if cost is not None else None


def _run_session_id(run) -> str | None:
    metadata = run.metadata if isinstance(run.metadata, dict) else {}
    value = metadata.get("worker_session_id")
    return str(value) if value else None


def _card_usage(runs) -> tuple[int | None, float | None]:
    if not runs:
        return 0, 0.0
    refs: list[tuple[str, str]] = []
    unknown_session = False
    for run in runs:
        session_id = _run_session_id(run)
        if not session_id or not run.profile:
            unknown_session = True
            continue
        ref = (str(run.profile), session_id)
        if ref not in refs:
            refs.append(ref)
    if unknown_session or not refs:
        return None, None
    usage = [_session_usage(profile, session_id) for profile, session_id in refs]
    if any(row is None for row in usage):
        return None, None
    tokens = [row[0] for row in usage if row is not None]
    costs = [row[1] for row in usage if row is not None]
    token_total = sum(tokens) if all(value is not None for value in tokens) else None
    cost_total = sum(costs) if all(value is not None for value in costs) else None
    return token_total, cost_total


def _last_tool(run) -> dict | None:
    metadata = run.metadata if isinstance(run.metadata, dict) else {}
    value = metadata.get("last_tool")
    if isinstance(value, dict) and value.get("name"):
        return {"name": str(value["name"]), "status": str(value.get("status") or "")}
    name = metadata.get("last_tool_name")
    if name:
        return {"name": str(name), "status": str(metadata.get("last_tool_status") or "")}
    return None


def _team_approval_pending(team: dict, task) -> bool:
    for approval in team.get("approvals", []):
        if approval.get("status") != "pending":
            continue
        payload = approval.get("payload")
        payload = payload if isinstance(payload, dict) else {}
        if payload.get("task_id") == task.id or approval.get("subject") in (task.id, task.title):
            return True
    return False


def _tool_approval_pending(runs) -> bool:
    try:
        from tools.approval import list_gateway_approvals
    except ImportError:
        return False
    for run in runs:
        session_id = _run_session_id(run)
        if session_id and list_gateway_approvals(session_id):
            return True
    return False


def _needs_you(team: dict, task, runs, events) -> str | None:
    if _team_approval_pending(team, task) or _tool_approval_pending(runs):
        return "approval"
    if task.status == "review":
        return "review"
    if task.status == "blocked":
        if task.block_kind == "needs_input":
            return "question"
        for event in reversed(events):
            if event.kind == "blocked":
                payload = event.payload if isinstance(event.payload, dict) else {}
                if payload.get("kind") == "needs_input":
                    return "question"
                break
        return "blocked"
    if task.status == "triage":
        return "question"
    return None


def _card(team: dict, seat_by_profile: dict, db_path: str, info: dict, now: int) -> dict:
    task = info["task"]
    runs = info["runs"]
    latest_run = info["latest_run"]
    events = info["events"]
    mapped = COLUMN_BY_STATUS.get(task.status, "queued")
    needs_you = _needs_you(team, task, runs, events)
    if needs_you == "approval" and task.status not in {"done", "archived"}:
        mapped = "needs_approval"

    assignee = None
    if task.assignee:
        seat = seat_by_profile.get(task.assignee, {})
        assignee = {
            "profile": task.assignee,
            "title": str(seat.get("title") or ""),
            "role": str(seat.get("role") or ""),
        }
    usage_tokens, usage_cost = _card_usage(runs)
    session_id = _run_session_id(latest_run) if latest_run else None
    times = [value for value in (task.created_at, task.started_at, task.completed_at) if value is not None]
    times.extend(event.created_at for event in events if event.created_at is not None)
    updated_at = max(times) if times else None
    elapsed_end = task.completed_at if task.status in {"done", "archived"} else now
    elapsed = max(0, int(elapsed_end - task.started_at)) if task.started_at else None
    stoppable = task.status == "running"
    takeable = task.status not in {"done", "archived"}
    return {
        "task_id": task.id,
        "title": task.title,
        "assignee": assignee,
        "column": mapped,
        "status": task.status,
        "started_at": task.started_at,
        "updated_at": updated_at,
        "elapsed_s": elapsed,
        "tokens": usage_tokens,
        "cost_usd": usage_cost,
        "last_tool": _last_tool(latest_run) if latest_run else None,
        "session_id": session_id,
        "needs_you": needs_you,
        "stoppable": stoppable,
        "takeable": takeable,
    }


def _goal_cards(team: dict, goal: dict, now: int) -> list[dict]:
    seat_by_profile = {
        str(member.get("profile")): member
        for member in team.get("members", [])
        if member.get("profile")
    }
    roots = list(dict.fromkeys(str(task_id) for task_id in goal.get("task_ids", []) if task_id))
    owner = next((m for m in team.get("members", []) if m.get("slot") == goal.get("owner")), None)
    fallback_profile = (owner or {}).get("profile")
    task_boards = goal.get("task_boards")
    task_boards = task_boards if isinstance(task_boards, dict) else {}
    default_path = None
    pending = deque()
    for task_id in roots:
        path = task_boards.get(task_id)
        if not path:
            if default_path is None:
                default_path = _root_board_path(fallback_profile)
            path = default_path
        pending.append((task_id, str(path), fallback_profile))
    visited: set[str] = set()
    cards = []
    while pending:
        task_id, db_path, parent_profile = pending.popleft()
        if task_id in visited:
            continue
        visited.add(task_id)
        info = _load_task_context(task_id, db_path, parent_profile)
        if info is None:
            continue
        cards.append(_card(team, seat_by_profile, db_path, info, now))
        pending.extend((child_id, db_path, info["profile"]) for child_id in info["children"])
    return cards


def _totals(cards: list[dict]) -> dict:
    counts = {key: 0 for key in COLUMN_KEYS}
    for card in cards:
        counts[card["column"]] += 1
    complete_tokens = all(card["tokens"] is not None for card in cards)
    complete_cost = all(card["cost_usd"] is not None for card in cards)
    return {
        **counts,
        "needs_you": sum(card["needs_you"] is not None for card in cards),
        "tokens": sum(card["tokens"] for card in cards) if complete_tokens else None,
        "cost_usd": sum(card["cost_usd"] for card in cards) if complete_cost else None,
    }


def board(root: str | Path, team_id: str, goal_id: str | None = None) -> dict:
    from tools import bot_team as bt

    team = bt.get_team(root, team_id)
    goals = team.get("goals", [])
    if goal_id:
        goal = next((item for item in goals if item.get("id") == goal_id), None)
        if goal is None:
            raise bt.TeamError(f"no goal '{goal_id}'")
    else:
        active = [goal for goal in goals if goal.get("status") not in {"done", "cancelled"}]
        goal = max(active, key=lambda item: (item.get("updated_at") or item.get("created_at") or 0,
                                             item.get("created_at") or 0), default=None)
    cards = _goal_cards(team, goal, int(time.time())) if goal else []
    return {"goal": goal, "cards": cards, "totals": _totals(cards)}


def _goal_start_body(title: str, detail: str, teammates: list[dict]) -> str:
    roster = "\n".join(
        f"- {member.get('title') or member.get('role') or member['profile']} "
        f"({member.get('role') or 'teammate'}): profile `{member['profile']}`"
        for member in teammates
    )
    detail_text = f"\n\nAdditional detail:\n{detail}" if detail else ""
    return (
        f"Lead the team goal: {title}.{detail_text}\n\n"
        "Break this goal into focused Kanban cards for the named teammates below. For each card, "
        "use `kanban_create` with `assignee` set to that teammate's profile and `parents` containing "
        "this lead card's task id. Make each task independently verifiable and "
        "include its acceptance checks. Then wait for the teammate cards, inspect their results, "
        "review them, request changes where needed, and report the integrated result. Do not mark "
        "the lead card complete before the teammate work has been reviewed.\n\n"
        f"Teammates:\n{roster}"
    )


def start_goal(root: str | Path, team_id: str, title: str, detail: str | None = None) -> dict:
    from tools import bot_team as bt

    title = str(title or "").strip()
    if not title:
        raise bt.TeamError("goal title required")
    with bt._lock_for(team_id):
        team = bt.get_team(root, team_id)
        lead = bt.lead_member(team)
        if lead is None or not lead.get("profile"):
            raise TeamBoardError(4131, "team has no lead seat with a profile")
        teammates = [
            member for member in team.get("members", [])
            if member.get("profile") and member.get("slot") != lead.get("slot")
        ]
        if not teammates:
            raise TeamBoardError(4132, "team has no other seated teammate")

        goal = next(
            (item for item in team.get("goals", [])
             if str(item.get("title") or "").strip().casefold() == title.casefold()),
            None,
        )
        fields: dict[str, Any] = {"owner": lead["slot"], "status": "open"}
        if detail is not None:
            fields["detail"] = detail
        if goal:
            goal = bt.upsert_goal(root, team_id, goal_id=goal["id"], title=title, **fields)
        else:
            goal = bt.upsert_goal(root, team_id, title=title, **fields)

        body = _goal_start_body(title, str(detail or "").strip(), teammates)
        with _profile_scope(lead["profile"]):
            spawned = bt.spawn_goal_task(
                root, team_id, goal["id"], title=f"Lead: {title}", body=body,
                assignee=lead["slot"], actor="you",
            )
        fresh = bt.get_team(root, team_id)
        goal = next(item for item in fresh["goals"] if item["id"] == goal["id"])
        return {"goal": goal, "lead_task_id": spawned["task_id"]}


def _template_lock(root: str | Path, request_key: str):
    @contextmanager
    def hold():
        from tools import bot_team as bt

        directory = bt.teams_root(root) / "template-requests"
        directory.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(request_key.encode("utf-8")).hexdigest()
        lock_path = directory / f"{digest}.lock"
        handle = lock_path.open("a+b")
        if os.name == "nt":
            import msvcrt

            if handle.seek(0, os.SEEK_END) == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield directory / f"{digest}.json"
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            handle.close()

    return hold()


def _profile_name_available(name: str, reserved: set[str]) -> bool:
    from hermes_cli.profiles import list_profile_names

    return name not in set(list_profile_names()) and name not in reserved


def _next_profile_name(prefix: str, role: str, reserved: set[str]) -> str:
    stem = f"{prefix}-{role}"
    candidate = stem
    suffix = 2
    while not _profile_name_available(candidate, reserved):
        candidate = f"{stem}-{suffix}"
        suffix += 1
    reserved.add(candidate)
    return candidate


def _create_profile(profile: str, seat: dict) -> None:
    from hermes_cli.profiles import profile_exists
    from tui_gateway import server

    if profile_exists(profile):
        return
    handler = server._methods.get("profiles.create")
    if handler is None:
        raise TeamBoardError(4133, "profile creation is unavailable on this gateway")
    response = handler(
        f"fork-team-profile-{profile}",
        {
            "name": profile,
            "description": f"{seat['title']} team profile",
            "clone_from": "default",
            "no_skills": False,
            "share_auth": True,
            "soul": f"# {seat['title']}\n\n{seat['instruction']}\n",
        },
    )
    if "error" in response:
        error = response["error"]
        raise TeamBoardError(4133, str(error.get("message") or "could not create team profile"))


def apply_template(
    root: str | Path,
    template_id: str,
    request_id: str,
    *,
    name: str | None = None,
    assign: dict[str, str] | None = None,
) -> dict:
    from hermes_cli.profiles import profile_exists
    from tools import bot_team as bt

    template = _TEMPLATE_BY_ID.get(template_id)
    if template is None:
        raise TeamBoardError(4133, f"unknown team template '{template_id}'")
    request_id = str(request_id or "").strip()
    if not request_id:
        raise TeamBoardError(4133, "request id required")
    assign = {str(role): str(profile).strip() for role, profile in (assign or {}).items()}
    roles = {seat["role"] for seat in template["seats"]}
    if set(assign) - roles or any(not profile for profile in assign.values()):
        raise TeamBoardError(4133, "assign must map template seat roles to profile names")
    if len(set(assign.values())) != len(assign):
        raise TeamBoardError(4133, "one profile cannot fill multiple seats")
    for profile in assign.values():
        if not profile_exists(profile):
            raise TeamBoardError(4133, f"profile '{profile}' does not exist")

    request_key = f"{request_id}"
    fingerprint = hashlib.sha256(json.dumps(
        {"template_id": template_id, "name": name, "assign": assign},
        sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    with _template_lock(root, request_key) as receipt_path:
        try:
            receipt = json.loads(receipt_path.read_text(encoding="utf-8-sig"))
        except FileNotFoundError:
            receipt = None
        except (OSError, ValueError) as exc:
            raise TeamBoardError(4133, "template request receipt is unreadable") from exc
        if receipt and receipt.get("fingerprint") != fingerprint:
            raise TeamBoardError(4133, "request id was already used for a different template")
        created = receipt is None
        if receipt is None:
            from tools.bot_team import _new_id

            receipt = {
                "fingerprint": fingerprint,
                "template_id": template_id,
                "team_id": _new_id(bt.TEAM_ID_PREFIX),
                "profiles": {},
            }
            atomic_json_write(receipt_path, receipt)

        team_created = False
        try:
            team = bt.get_team(root, receipt["team_id"])
        except bt.TeamNotFound:
            team = bt.create_team(
                root,
                team_id=receipt["team_id"],
                name=str(name or template["name"]).strip() or template["name"],
                mission=template["mission"],
                actor="you",
            )
            team_created = True

        reserved = set(receipt["profiles"].values())
        role_slots = {
            member.get("role"): member["slot"]
            for member in team.get("members", [])
            if member.get("role")
        }
        for seat in template["seats"]:
            role = seat["role"]
            profile = assign.get(role) or receipt["profiles"].get(role)
            if profile is None:
                profile = _next_profile_name(template["profile_prefix"], role, reserved)
                receipt["profiles"][role] = profile
                atomic_json_write(receipt_path, receipt)
            if role not in assign:
                _create_profile(profile, seat)
            elif not profile_exists(profile):
                raise TeamBoardError(4133, f"profile '{profile}' does not exist")

            existing = next(
                (member for member in team.get("members", []) if member.get("profile") == profile),
                None,
            )
            if existing:
                role_slots[role] = existing["slot"]
                continue
            report_role = seat["reports_to"]
            member = bt.upsert_member(
                root,
                team["id"],
                profile=profile,
                role=seat["job"],
                title=seat["title"],
                reports_to=role_slots.get(report_role) if report_role else None,
                lead=bool(seat["lead"]),
                actor="you",
            )
            role_slots[role] = member["slot"]
            team = bt.get_team(root, team["id"])
        team = bt.get_team(root, receipt["team_id"])
        return {"team": team, "created": created and team_created}


def _goal_roots(team: dict):
    for goal in team.get("goals", []):
        owner = next((member for member in team.get("members", [])
                      if member.get("slot") == goal.get("owner")), None)
        fallback = (owner or bt_lead(team) or {}).get("profile")
        boards = goal.get("task_boards")
        boards = boards if isinstance(boards, dict) else {}
        for task_id in goal.get("task_ids", []):
            yield str(task_id), str(boards.get(task_id) or _root_board_path(fallback)), fallback


def bt_lead(team: dict) -> dict | None:
    from tools import bot_team as bt

    return bt.lead_member(team)


def _locate_card(root: str | Path, task_id: str) -> tuple[str, str | None, set[str]]:
    from tools import bot_team as bt

    matches: set[tuple[str, str | None]] = set()
    member_profiles: set[str] = set()
    for summary in bt.list_teams(root):
        team = bt.get_team(root, summary["id"])
        for root_id, db_path, fallback in _goal_roots(team):
            queue = deque([(root_id, fallback)])
            visited: set[str] = set()
            while queue:
                current_id, parent_profile = queue.popleft()
                if current_id in visited:
                    continue
                visited.add(current_id)
                info = _load_task_context(current_id, db_path, parent_profile)
                if info is None:
                    continue
                if current_id == task_id:
                    matches.add((db_path, info["profile"]))
                    member_profiles.update(
                        str(member["profile"])
                        for member in team.get("members", [])
                        if member.get("profile")
                    )
                queue.extend((child_id, info["profile"]) for child_id in info["children"])
    if not matches:
        raise TeamBoardError(4141, f"team card '{task_id}' was not found")
    paths = {path for path, _profile in matches}
    if len(paths) != 1:
        raise TeamBoardError(4141, f"team card '{task_id}' is linked on more than one Kanban board")
    path = next(iter(paths))
    profile = next((profile for found_path, profile in matches if found_path == path and profile), None)
    return path, profile, member_profiles


def _terminate_and_block(conn, task_id: str, reason: str) -> bool:
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_dispatch as kbd

    row = conn.execute(
        "SELECT status, claim_lock, worker_pid, worker_started_at, current_run_id "
        "FROM tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    if row is None:
        raise TeamBoardError(4141, f"team card '{task_id}' was not found")
    if row["status"] != "running":
        return row["status"] == "blocked"
    pid = row["worker_pid"]
    fingerprint = row["worker_started_at"]
    if not pid:
        raise TeamBoardError(4142, "the running worker has not registered a process yet; retry stop")
    if not isinstance(fingerprint, str) or "|" not in fingerprint:
        raise TeamBoardError(4142, "the worker has no verified process fingerprint; refusing to signal it")

    termination = kbd._terminate_reclaimed_worker(
        pid, row["claim_lock"], started_at=fingerprint,
    )
    if not termination.get("terminated") or kbd._worker_survived_termination(termination):
        raise TeamBoardError(4142, "the worker could not be safely stopped; the claim remains active")

    run_id = int(row["current_run_id"]) if row["current_run_id"] is not None else None
    previous_metadata = {}
    if run_id is not None:
        run_row = conn.execute("SELECT metadata FROM task_runs WHERE id = ?", (run_id,)).fetchone()
        previous_metadata = kb._json_dict(run_row["metadata"]) if run_row else {}
    with kb.write_txn(conn):
        changed = conn.execute(
            "UPDATE tasks SET status = 'blocked', claim_lock = NULL, claim_expires = NULL, "
            "worker_pid = NULL, worker_started_at = NULL, block_kind = NULL "
            "WHERE id = ? AND status = 'running' AND claim_lock IS ? AND worker_pid = ? "
            "AND worker_started_at = ? AND current_run_id IS ?",
            (task_id, row["claim_lock"], pid, fingerprint, row["current_run_id"]),
        ).rowcount
        if changed != 1:
            current = kb.get_task(conn, task_id)
            return bool(current and current.status == "blocked")
        ended_run_id = kb._end_run(
            conn,
            task_id,
            outcome="reclaimed",
            status="reclaimed",
            summary=reason,
            error=reason,
            metadata={**previous_metadata, "termination": termination},
        )
        event_run_id = ended_run_id if ended_run_id is not None else run_id
        kb._append_event(
            conn,
            task_id,
            "reclaimed",
            {"manual": True, "reason": reason, "termination": termination},
            run_id=event_run_id,
        )
        kb._append_event(
            conn,
            task_id,
            "blocked",
            {"reason": reason, "kind": None, "source_status": "running"},
            run_id=event_run_id,
        )
    kb._clear_failure_counter(conn, task_id)
    task = kb.get_task(conn, task_id)
    kb._fire_task_hook("kanban_task_blocked", task, task_id, event_run_id, reason=reason)
    kb.notify_task_updated(conn, task_id, ("status", "claim_lock"))
    return True


def stop_card(root: str | Path, task_id: str) -> dict:
    from hermes_cli import kanban_db as kb

    db_path, profile, _member_profiles = _locate_card(root, task_id)
    with _board_connection(db_path, profile) as conn:
        if conn is None:
            raise TeamBoardError(4141, f"Kanban board for card '{task_id}' is unavailable")
        stopped = _terminate_and_block(conn, task_id, "stopped by user")
        task = kb.get_task(conn, task_id)
    return {"task_id": task_id, "stopped": stopped, "status": task.status if task else ""}


def takeover_card(root: str | Path, task_id: str) -> dict:
    from hermes_cli import kanban_db as kb

    db_path, profile, _member_profiles = _locate_card(root, task_id)
    with _board_connection(db_path, profile) as conn:
        if conn is None:
            raise TeamBoardError(4141, f"Kanban board for card '{task_id}' is unavailable")
        task = kb.get_task(conn, task_id)
        if task is None or task.status in {"done", "archived"}:
            raise TeamBoardError(4141, "completed team cards cannot be taken over")
        if task.status == "running":
            if not _terminate_and_block(conn, task_id, "taken over by user"):
                raise TeamBoardError(4142, "the running card could not be stopped")
        task = kb.get_task(conn, task_id)
        if task.assignee is not None:
            kb.assign_task(conn, task_id, None)
        comment = conn.execute(
            "SELECT 1 FROM task_comments WHERE task_id = ? AND author = 'you' "
            "AND body = 'taken over by user' LIMIT 1",
            (task_id,),
        ).fetchone()
        if comment is None:
            kb.add_comment(conn, task_id, "you", "taken over by user")
        latest_run = kb.latest_run(conn, task_id)
        metadata = latest_run.metadata if latest_run and isinstance(latest_run.metadata, dict) else {}
        session_id = metadata.get("worker_session_id")
        return {
            "session_id": str(session_id) if session_id else None,
            "profile": latest_run.profile if latest_run else None,
        }


def resume_card(root: str | Path, task_id: str, assignee: str | None = None) -> dict:
    from hermes_cli import kanban_db as kb

    db_path, profile, member_profiles = _locate_card(root, task_id)
    if assignee and assignee not in member_profiles:
        raise TeamBoardError(4143, "assignee must be a seated teammate")
    with _board_connection(db_path, profile) as conn:
        if conn is None:
            raise TeamBoardError(4141, f"Kanban board for card '{task_id}' is unavailable")
        task = kb.get_task(conn, task_id)
        if task is None or task.status in {"done", "archived"}:
            raise TeamBoardError(4141, "completed team cards cannot be resumed")
        if task.status == "running":
            if not _terminate_and_block(conn, task_id, "stopped by user"):
                raise TeamBoardError(4142, "the running card could not be stopped")
            task = kb.get_task(conn, task_id)
        if task.status == "review":
            kb.reopen_review_task(conn, task_id)
            task = kb.get_task(conn, task_id)
        if assignee:
            kb.assign_task(conn, task_id, assignee)
        if task.status in {"blocked", "scheduled"}:
            kb.unblock_task(conn, task_id)
            task = kb.get_task(conn, task_id)
            if task and task.status == "review":
                kb.reopen_review_task(conn, task_id)
        task = kb.get_task(conn, task_id)
        return {
            "task_id": task_id,
            "status": task.status if task else "",
            "assignee": task.assignee if task else None,
        }
