"""Team Bots — the coordination layer above Bot Mode profiles.

A *team* is a small org of Hermes profiles that share a mission: who reports to whom, what
goals hang under the mission (each goal linking to Kanban tasks that do the work), what each
teammate may spend, what needs a human's sign-off, and what the team has learned. Profiles
stay islands — the team file stores *references* to them, never their config or secrets —
so like the mailbox (``tools/bot_mailbox.py``) it lives at the install root, where every
profile can reach it.

The execution engine is not here. Tasks, atomic claims, runs and dispatch already live in
the Kanban tables; a goal only stores task ids and reads their status back through an
injected lookup for roll-up. What this module adds is the part a ticket board lacks:

* **org chart** — one lead, ``reports_to`` edges, no cycles; open seats (``profile=None``)
  so a pack can describe a team before anyone is hired;
* **goal ancestry** — every goal knows its parents up to the mission, so a worker's brief
  says *why* the work matters, not just *what* it is;
* **budgets** — per-teammate monthly limit with an optional hard stop the dispatcher can
  ask before it claims work (``check_budget``);
* **governance** — hires, spend above a limit, credential grants and risky actions become
  approvals that only the human board (or the lead, when the team says so) can decide, and
  never the requester;
* **role kit** — the skills/plugins/credential *names* a seat is given; the values stay in
  the profile's own secret store;
* **shared learning** — short, deduplicated lessons the team accumulates, folded into each
  member's brief at session start (never mid-conversation: the prompt cache is sacred);
* **audit** — an append-only JSONL trail of every mutation, with the actor.

Store: ``<install root>/bot-teams/teams/<team_id>.json`` (+ ``audit/<team_id>.jsonl``).
Nothing here imports the gateway, the agent or Kanban at module scope.
"""

from __future__ import annotations

import contextlib
import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from utils import atomic_json_write

TEAMS_DIR_NAME = "bot-teams"
TEAM_ID_PREFIX = "team_"
GOAL_ID_PREFIX = "goal_"
APPROVAL_ID_PREFIX = "apr_"
LEARNING_ID_PREFIX = "lrn_"

NAME_MAX = 80
TEXT_MAX = 2000
MISSION_MAX = 4000
LIST_MAX = 64            # skills / plugins / credential names per seat
LEARNINGS_MAX = 200      # oldest are dropped past this
AUDIT_TAIL_DEFAULT = 200

GOAL_STATUSES = ("open", "active", "blocked", "done", "cancelled")
_GOAL_SETTLED = frozenset({"done", "cancelled"})
APPROVAL_KINDS = ("hire", "spend", "credential", "action")
APPROVAL_STATUSES = ("pending", "approved", "rejected")
MEMBER_STATUSES = ("active", "paused")

# The human board is a principal too: ``you`` may decide anything.
BOARD_ACTOR = "you"

# Fields a Team Pack may carry. Anything else (profile names, budgets spent, credential
# values, ids, audit) never leaves the install — a pack is a shareable org design.
_PACK_MEMBER_KEYS = ("slot", "role", "title", "reports_to_slot", "lead", "skills", "plugins",
                     "credentials", "monthly_usd", "hard_stop")
PACK_VERSION = 1


class TeamError(ValueError):
    """A domain refusal (bad input, cycle, governance). Handlers map it to a 41xx code."""


class TeamNotFound(KeyError):
    pass


_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def _lock_for(team_id: str) -> threading.RLock:
    with _locks_guard:
        return _locks.setdefault(team_id, threading.RLock())


# ── storage ───────────────────────────────────────────────────────────────────────────────


def teams_root(root: Path | str) -> Path:
    """Install-wide dir — same root as the relay/mailbox, for the same reason: a team spans
    profiles, so per-profile storage would split it exactly where it must be shared."""
    return Path(root) / TEAMS_DIR_NAME


def _teams_dir(root: Path | str) -> Path:
    d = teams_root(root) / "teams"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _audit_path(root: Path | str, team_id: str) -> Path:
    d = teams_root(root) / "audit"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{team_id}.jsonl"


_ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")


def _team_path(root: Path | str, team_id: str) -> Path:
    if not _ID_RE.match(team_id or ""):
        raise TeamNotFound(team_id)
    return _teams_dir(root) / f"{team_id}.json"


def _now() -> int:
    return int(time.time())


def _new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def _load(root: Path | str, team_id: str) -> dict:
    path = _team_path(root, team_id)
    try:
        team = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise TeamNotFound(team_id) from None
    if not isinstance(team, dict):
        raise TeamNotFound(team_id)
    return team


def _save(root: Path | str, team: dict) -> dict:
    team["updated_at"] = _now()
    atomic_json_write(_team_path(root, team["id"]), team)
    return team


def audit(root: Path | str, team_id: str, actor: str, action: str, detail: Optional[dict] = None) -> None:
    """Append one trail line. Append-only by construction: there is no rewrite path."""
    line = json.dumps({"at": _now(), "actor": actor or "unknown", "action": action,
                       "detail": detail or {}}, ensure_ascii=False, default=str)
    with _lock_for(team_id), open(_audit_path(root, team_id), "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def list_audit(root: Path | str, team_id: str, limit: int = AUDIT_TAIL_DEFAULT) -> list[dict]:
    """Newest first."""
    _load(root, team_id)
    path = _audit_path(root, team_id)
    if not path.exists():
        return []
    rows: list[dict] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        with contextlib.suppress(ValueError):
            rows.append(json.loads(raw))
    return rows[::-1][: max(1, min(int(limit or AUDIT_TAIL_DEFAULT), 1000))]


# ── normalizers ───────────────────────────────────────────────────────────────────────────


def _text(raw: Any, cap: int) -> str:
    return str(raw or "").strip()[:cap]


def _names(raw: Any) -> list[str]:
    """A bounded, deduplicated list of short names (skills, plugins, credential refs)."""
    if not isinstance(raw, (list, tuple)):
        return []
    out: list[str] = []
    for item in raw:
        name = _text(item, 80)
        if name and name not in out:
            out.append(name)
        if len(out) >= LIST_MAX:
            break
    return out


def _budget(raw: Any, prev: Optional[dict] = None) -> dict:
    prev = prev or {}
    raw = raw if isinstance(raw, dict) else {}
    limit = raw.get("monthly_usd", prev.get("monthly_usd"))
    try:
        limit = None if limit in (None, "") else max(0.0, float(limit))
    except (TypeError, ValueError):
        raise TeamError("monthly_usd must be a number or null") from None
    return {
        "monthly_usd": limit,
        "hard_stop": bool(raw.get("hard_stop", prev.get("hard_stop", True))),
        # spent_usd is what the gate reads: hand-recorded spend + spend measured from the
        # profile's own session ledger (see sync_measured_spend).
        "spent_usd": float(prev.get("spent_usd", 0.0)),
        "recorded_usd": float(prev.get("recorded_usd", prev.get("spent_usd", 0.0))),
        "measured_usd": float(prev.get("measured_usd", 0.0)),
        "synced_at": int(prev.get("synced_at", 0)),
        "period": prev.get("period") or time.strftime("%Y-%m", time.gmtime()),
    }


def _roll_period(budget: dict) -> dict:
    """Spend is per calendar month (UTC): a new month zeroes the counter."""
    period = time.strftime("%Y-%m", time.gmtime())
    if budget.get("period") != period:
        budget.update(period=period, spent_usd=0.0, recorded_usd=0.0, measured_usd=0.0, synced_at=0)
    return budget


# ── teams ─────────────────────────────────────────────────────────────────────────────────


def create_team(root: Path | str, *, name: str, mission: str = "", actor: str = BOARD_ACTOR,
                lead_decides: bool = False, channels: Optional[dict] = None) -> dict:
    name = _text(name, NAME_MAX)
    if not name:
        raise TeamError("team name required")
    team = {
        "id": _new_id(TEAM_ID_PREFIX),
        "name": name,
        "mission": _text(mission, MISSION_MAX),
        # governance: does the lead count as a decider, or only the human board?
        "policy": {"lead_decides": bool(lead_decides)},
        # where the team's bots are reachable beyond the app (names only, e.g. a Slack
        # channel id) — routing itself belongs to the messaging gateway.
        "channels": _channels(channels),
        "members": [],
        "goals": [],
        "approvals": [],
        "learnings": [],
        "created_at": _now(),
        "updated_at": _now(),
    }
    with _lock_for(team["id"]):
        _save(root, team)
        audit(root, team["id"], actor, "team.create", {"name": name})
    return team


def _channels(raw: Any) -> dict:
    if not isinstance(raw, dict):
        return {}
    return {_text(k, 32): _text(v, 120) for k, v in raw.items() if _text(k, 32) and _text(v, 120)}


def get_team(root: Path | str, team_id: str) -> dict:
    return _load(root, team_id)


def list_teams(root: Path | str) -> list[dict]:
    """Summaries, newest first (full docs are one ``get_team`` away)."""
    out = []
    for path in _teams_dir(root).glob("*.json"):
        with contextlib.suppress(Exception):
            t = json.loads(path.read_text(encoding="utf-8"))
            out.append({
                "id": t["id"], "name": t.get("name", ""), "mission": t.get("mission", ""),
                "member_count": len(t.get("members", [])),
                "open_seats": sum(1 for m in t.get("members", []) if not m.get("profile")),
                "goal_count": len(t.get("goals", [])),
                "pending_approvals": sum(1 for a in t.get("approvals", []) if a.get("status") == "pending"),
                "created_at": t.get("created_at", 0), "updated_at": t.get("updated_at", 0),
            })
    return sorted(out, key=lambda t: t["updated_at"], reverse=True)


def update_team(root: Path | str, team_id: str, *, actor: str = BOARD_ACTOR, **fields: Any) -> dict:
    with _lock_for(team_id):
        team = _load(root, team_id)
        changed = {}
        if "name" in fields:
            name = _text(fields["name"], NAME_MAX)
            if not name:
                raise TeamError("team name required")
            team["name"], changed["name"] = name, name
        if "mission" in fields:
            team["mission"] = changed["mission"] = _text(fields["mission"], MISSION_MAX)
        if "lead_decides" in fields:
            team["policy"]["lead_decides"] = changed["lead_decides"] = bool(fields["lead_decides"])
        if "channels" in fields:
            team["channels"] = _channels(fields["channels"])
            changed["channels"] = team["channels"]
        _save(root, team)
        audit(root, team_id, actor, "team.update", changed)
        return team


def delete_team(root: Path | str, team_id: str, *, actor: str = BOARD_ACTOR) -> None:
    """Removes the team doc; the audit trail is kept (it is the record that it existed)."""
    with _lock_for(team_id):
        _load(root, team_id)
        audit(root, team_id, actor, "team.delete")
        _team_path(root, team_id).unlink()


# ── members / org chart ───────────────────────────────────────────────────────────────────


def _member_key(m: dict) -> str:
    return m["slot"]


def _find_member(team: dict, ref: str) -> Optional[dict]:
    """A member is addressed by slot id or by profile name."""
    for m in team["members"]:
        if ref and (m["slot"] == ref or m.get("profile") == ref):
            return m
    return None


def _would_cycle(team: dict, slot: str, reports_to: Optional[str]) -> bool:
    seen = {slot}
    cur = reports_to
    while cur:
        if cur in seen:
            return True
        seen.add(cur)
        boss = next((m for m in team["members"] if m["slot"] == cur), None)
        cur = boss.get("reports_to") if boss else None
    return False


def upsert_member(root: Path | str, team_id: str, *, slot: Optional[str] = None,
                  actor: str = BOARD_ACTOR, **fields: Any) -> dict:
    """Add a seat, or change one (``slot`` names an existing seat). ``profile=None`` is an
    open seat. Setting ``lead=True`` moves the lead badge — a team has at most one."""
    with _lock_for(team_id):
        team = _load(root, team_id)
        # Upsert: a seat is found by slot, else by the profile it names, so callers can
        # re-send "profile X is now paused" without tracking slot ids.
        existing = _find_member(team, slot or "") or (
            _find_member(team, str(fields.get("profile") or "")) if not slot else None)
        profile = fields.get("profile", existing.get("profile") if existing else None)
        profile = _text(profile, 80) or None
        if profile and any(m.get("profile") == profile and m is not existing for m in team["members"]):
            raise TeamError(f"'{profile}' already holds a seat on this team")

        member = existing or {"slot": _new_id("seat_"), "joined_at": _now(), "status": "active",
                              "budget": _budget({}), "reports_to": None, "lead": False}
        member["profile"] = profile
        if "role" in fields or not existing:
            member["role"] = _text(fields.get("role"), NAME_MAX)
        if "title" in fields or not existing:
            member["title"] = _text(fields.get("title"), NAME_MAX)
        for key in ("skills", "plugins", "credentials"):
            if key in fields or not existing:
                member[key] = _names(fields.get(key))
        if "status" in fields:
            status = str(fields["status"]).lower()
            if status not in MEMBER_STATUSES:
                raise TeamError(f"status must be one of {MEMBER_STATUSES}")
            member["status"] = status
        if "monthly_usd" in fields or "hard_stop" in fields:
            member["budget"] = _budget(
                {k: fields[k] for k in ("monthly_usd", "hard_stop") if k in fields}, member["budget"])
        if "reports_to" in fields:
            boss_ref = fields["reports_to"]
            boss = _find_member(team, boss_ref) if boss_ref else None
            if boss_ref and boss is None:
                raise TeamError(f"reports_to '{boss_ref}' is not on this team")
            boss_slot = boss["slot"] if boss else None
            if boss_slot == member["slot"] or _would_cycle(team, member["slot"], boss_slot):
                raise TeamError("reporting line would create a cycle")
            member["reports_to"] = boss_slot
        if fields.get("lead"):
            for other in team["members"]:
                other["lead"] = False
            member["lead"] = True
        elif "lead" in fields:
            member["lead"] = False
        if not existing:
            team["members"].append(member)
        _save(root, team)
        audit(root, team_id, actor, "member.update" if existing else "member.add",
              {"slot": member["slot"], "profile": profile, "role": member["role"]})
        return member


def remove_member(root: Path | str, team_id: str, ref: str, *, actor: str = BOARD_ACTOR) -> None:
    """Remove a seat. Its reports re-attach to its own boss, and goals it owned go unowned —
    nothing is orphaned and no work is deleted."""
    with _lock_for(team_id):
        team = _load(root, team_id)
        member = _find_member(team, ref)
        if member is None:
            raise TeamError(f"no member '{ref}'")
        for other in team["members"]:
            if other.get("reports_to") == member["slot"]:
                other["reports_to"] = member.get("reports_to")
        for goal in team["goals"]:
            if goal.get("owner") == member["slot"]:
                goal["owner"] = None
        team["members"].remove(member)
        _save(root, team)
        audit(root, team_id, actor, "member.remove", {"slot": member["slot"], "profile": member.get("profile")})


def org_tree(team: dict) -> list[dict]:
    """Members nested under their boss. Roots are the lead (or any member with no boss)."""
    by_boss: dict[Optional[str], list[dict]] = {}
    for m in team["members"]:
        by_boss.setdefault(m.get("reports_to"), []).append(m)

    def build(m: dict) -> dict:
        return {**m, "reports": [build(c) for c in by_boss.get(m["slot"], [])]}

    return [build(m) for m in by_boss.get(None, [])]


# ── goals ─────────────────────────────────────────────────────────────────────────────────


def _goal(team: dict, goal_id: str) -> dict:
    for g in team["goals"]:
        if g["id"] == goal_id:
            return g
    raise TeamError(f"no goal '{goal_id}'")


def upsert_goal(root: Path | str, team_id: str, *, goal_id: Optional[str] = None,
                actor: str = BOARD_ACTOR, **fields: Any) -> dict:
    """Create (``goal_id`` omitted) or edit a goal. ``parent_id=None`` hangs it directly
    under the team mission."""
    with _lock_for(team_id):
        team = _load(root, team_id)
        goal = _goal(team, goal_id) if goal_id else None
        if goal is None:
            title = _text(fields.get("title"), NAME_MAX * 2)
            if not title:
                raise TeamError("goal title required")
            goal = {"id": _new_id(GOAL_ID_PREFIX), "title": title, "detail": "", "parent_id": None,
                    "owner": None, "status": "open", "task_ids": [], "created_at": _now()}
            team["goals"].append(goal)
        if "title" in fields and goal_id:
            title = _text(fields["title"], NAME_MAX * 2)
            if not title:
                raise TeamError("goal title required")
            goal["title"] = title
        if "detail" in fields:
            goal["detail"] = _text(fields["detail"], TEXT_MAX)
        if "parent_id" in fields:
            parent = fields["parent_id"] or None
            if parent:
                _goal(team, parent)
                cur = parent
                while cur:
                    if cur == goal["id"]:
                        raise TeamError("goal hierarchy would create a cycle")
                    cur = _goal(team, cur).get("parent_id")
            goal["parent_id"] = parent
        if "owner" in fields:
            ref = fields["owner"]
            owner = _find_member(team, ref) if ref else None
            if ref and owner is None:
                raise TeamError(f"owner '{ref}' is not on this team")
            goal["owner"] = owner["slot"] if owner else None
        if "status" in fields:
            status = str(fields["status"]).lower()
            if status not in GOAL_STATUSES:
                raise TeamError(f"status must be one of {GOAL_STATUSES}")
            goal["status"] = status
        goal["updated_at"] = _now()
        _save(root, team)
        audit(root, team_id, actor, "goal.update" if goal_id else "goal.add",
              {"goal": goal["id"], "title": goal["title"], "status": goal["status"]})
        return goal


def link_task(root: Path | str, team_id: str, goal_id: str, task_id: str, *,
              unlink: bool = False, actor: str = BOARD_ACTOR) -> dict:
    """Attach (or detach) a Kanban task id to a goal. The task itself is untouched."""
    task_id = _text(task_id, 80)
    if not task_id:
        raise TeamError("task_id required")
    with _lock_for(team_id):
        team = _load(root, team_id)
        goal = _goal(team, goal_id)
        if unlink:
            goal["task_ids"] = [t for t in goal["task_ids"] if t != task_id]
        elif task_id not in goal["task_ids"]:
            goal["task_ids"].append(task_id)
        _save(root, team)
        audit(root, team_id, actor, "goal.unlink_task" if unlink else "goal.link_task",
              {"goal": goal_id, "task": task_id})
        return goal


def goal_ancestry(team: dict, goal_id: str) -> list[dict]:
    """The mission-first chain down to this goal: ``[mission, …, goal]``. This is what a
    worker's brief quotes so the *why* travels with the task."""
    chain: list[dict] = []
    cur: Optional[str] = goal_id
    guard = 0
    while cur and guard < 64:
        g = _goal(team, cur)
        chain.append({"id": g["id"], "title": g["title"]})
        cur = g.get("parent_id")
        guard += 1
    chain.append({"id": None, "title": team.get("mission") or team["name"]})
    return chain[::-1]


TaskStatusLookup = Callable[[list[str]], dict[str, Optional[str]]]


def default_task_status_lookup(task_ids: list[str]) -> dict[str, Optional[str]]:
    """Best-effort Kanban read. Unknown ids (or no Kanban) map to ``None`` — a roll-up must
    never fail because the ticket engine is unavailable."""
    out: dict[str, Optional[str]] = {t: None for t in task_ids}
    try:
        from hermes_cli import kanban_db
        from hermes_cli import kanban_db_connect as kbc

        with kbc.connect() as conn:
            for t in task_ids:
                task = kanban_db.get_task(conn, t)
                if task is not None:
                    out[t] = getattr(task, "status", None)
    except Exception:
        return out
    return out
    return out


def rollup(team: dict, lookup: Optional[TaskStatusLookup] = None) -> dict:
    """Progress per goal, folding children into parents.

    A goal's ``done``/``total`` counts its own linked tasks plus every descendant goal's;
    a goal explicitly marked done/cancelled counts as complete regardless of tasks.
    Returns ``{goals: {id: {done, total, percent, blocked, status}}, overall}``.
    """
    lookup = lookup or default_task_status_lookup
    all_ids = sorted({t for g in team["goals"] for t in g["task_ids"]})
    statuses = lookup(all_ids) if all_ids else {}
    children: dict[Optional[str], list[dict]] = {}
    for g in team["goals"]:
        children.setdefault(g.get("parent_id"), []).append(g)

    result: dict[str, dict] = {}

    def walk(g: dict) -> tuple[int, int, bool]:
        done = total = 0
        blocked = g["status"] == "blocked"
        for t in g["task_ids"]:
            s = (statuses.get(t) or "").lower()
            if s == "archived":
                continue
            total += 1
            done += s == "done"
            blocked = blocked or s == "blocked"
        for c in children.get(g["id"], []):
            cd, ct, cb = walk(c)
            done, total, blocked = done + cd, total + ct, blocked or cb
        if g["status"] in _GOAL_SETTLED and total == 0:
            done = total = 1
        result[g["id"]] = {"done": done, "total": total, "blocked": blocked, "status": g["status"],
                           "percent": int(100 * done / total) if total else (100 if g["status"] == "done" else 0)}
        return done, total, blocked

    od = ot = 0
    for root_goal in children.get(None, []):
        d, t, _ = walk(root_goal)
        od, ot = od + d, ot + t
    return {"goals": result, "overall": {"done": od, "total": ot, "percent": int(100 * od / ot) if ot else 0}}


# ── budgets ───────────────────────────────────────────────────────────────────────────────


def check_budget(root: Path | str, team_id: str, ref: str) -> dict:
    """May this teammate take on more work right now? The dispatcher asks before claiming.

    ``allowed`` is False when the seat is paused, or the limit is spent and ``hard_stop``
    is on. A soft limit only reports ``over_budget``.
    """
    team = _load(root, team_id)
    m = _find_member(team, ref)
    if m is None:
        return {"allowed": True, "reason": "not a team member", "remaining_usd": None, "over_budget": False}
    b = _roll_period(dict(m["budget"]))
    limit, spent = b["monthly_usd"], b["spent_usd"]
    remaining = None if limit is None else round(limit - spent, 6)
    over = limit is not None and spent >= limit
    if m["status"] == "paused":
        return {"allowed": False, "reason": "paused", "remaining_usd": remaining, "over_budget": over}
    if over and b["hard_stop"]:
        return {"allowed": False, "reason": "budget exhausted", "remaining_usd": remaining, "over_budget": True}
    return {"allowed": True, "reason": "", "remaining_usd": remaining, "over_budget": over}


def record_spend(root: Path | str, team_id: str, ref: str, usd: float, *, actor: str = "system") -> dict:
    try:
        usd = float(usd)
    except (TypeError, ValueError):
        raise TeamError("usd must be a number") from None
    if usd < 0:
        raise TeamError("spend cannot be negative")
    with _lock_for(team_id):
        team = _load(root, team_id)
        m = _find_member(team, ref)
        if m is None:
            raise TeamError(f"no member '{ref}'")
        m["budget"] = _roll_period(m["budget"])
        b = m["budget"]
        b["recorded_usd"] = round(b.get("recorded_usd", 0.0) + usd, 6)
        b["spent_usd"] = round(b["recorded_usd"] + b.get("measured_usd", 0.0), 6)
        _save(root, team)
        audit(root, team_id, actor, "budget.spend", {"slot": m["slot"], "usd": usd})
    return check_budget(root, team_id, ref)


# ── governance ────────────────────────────────────────────────────────────────────────────


def request_approval(root: Path | str, team_id: str, *, kind: str, subject: str, requested_by: str,
                     detail: str = "", payload: Optional[dict] = None) -> dict:
    kind = str(kind or "").lower()
    if kind not in APPROVAL_KINDS:
        raise TeamError(f"kind must be one of {APPROVAL_KINDS}")
    subject = _text(subject, 200)
    if not subject:
        raise TeamError("subject required")
    with _lock_for(team_id):
        team = _load(root, team_id)
        req = {"id": _new_id(APPROVAL_ID_PREFIX), "kind": kind, "subject": subject,
               "detail": _text(detail, TEXT_MAX), "payload": payload if isinstance(payload, dict) else None,
               "requested_by": _text(requested_by, 80) or "unknown", "status": "pending",
               "decided_by": None, "decided_at": None, "note": "", "created_at": _now()}
        team["approvals"].append(req)
        _save(root, team)
        audit(root, team_id, req["requested_by"], "approval.request", {"id": req["id"], "kind": kind, "subject": subject})
        return req


def _can_decide(team: dict, actor: str) -> bool:
    if actor == BOARD_ACTOR:
        return True
    if not team["policy"].get("lead_decides"):
        return False
    m = _find_member(team, actor)
    return bool(m and m.get("lead"))


def decide_approval(root: Path | str, team_id: str, approval_id: str, *, approve: bool,
                    actor: str = BOARD_ACTOR, note: str = "") -> dict:
    """Only the human board — or the lead, when the team's policy lets it — may decide, and
    never on a request it made itself: a bot cannot approve its own spend or hire."""
    with _lock_for(team_id):
        team = _load(root, team_id)
        req = next((a for a in team["approvals"] if a["id"] == approval_id), None)
        if req is None:
            raise TeamError(f"no approval '{approval_id}'")
        if req["status"] != "pending":
            raise TeamError(f"approval already {req['status']}")
        if not _can_decide(team, actor):
            raise TeamError("only the board (or the lead, if the team allows it) can decide approvals")
        requester = _find_member(team, req["requested_by"])
        actor_member = _find_member(team, actor)
        if actor != BOARD_ACTOR and (actor == req["requested_by"] or (
                requester and actor_member and requester["slot"] == actor_member["slot"])):
            raise TeamError("a requester cannot decide its own approval")
        req.update(status="approved" if approve else "rejected", decided_by=actor,
                   decided_at=_now(), note=_text(note, 500))
        _save(root, team)
        audit(root, team_id, actor, "approval.decide", {"id": approval_id, "status": req["status"]})
        return req


# ── shared learning ───────────────────────────────────────────────────────────────────────


def _norm(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


def add_learning(root: Path | str, team_id: str, *, text: str, by: str, source: str = "") -> dict:
    """One short lesson the team should keep (a preference, a gotcha, a house rule).
    Near-duplicates are folded (same normalized text bumps ``count``) so the list stays a
    signal, and the oldest fall off past ``LEARNINGS_MAX``."""
    text = _text(text, 400)
    if not text:
        raise TeamError("learning text required")
    with _lock_for(team_id):
        team = _load(root, team_id)
        key = _norm(text)
        for item in team["learnings"]:
            if _norm(item["text"]) == key:
                item["count"] = item.get("count", 1) + 1
                item["last_at"] = _now()
                _save(root, team)
                return item
        item = {"id": _new_id(LEARNING_ID_PREFIX), "text": text, "by": _text(by, 80) or "unknown",
                "source": _text(source, 120), "count": 1, "at": _now(), "last_at": _now()}
        team["learnings"].append(item)
        team["learnings"] = team["learnings"][-LEARNINGS_MAX:]
        _save(root, team)
        audit(root, team_id, item["by"], "learning.add", {"id": item["id"]})
        return item


def remove_learning(root: Path | str, team_id: str, learning_id: str, *, actor: str = BOARD_ACTOR) -> None:
    with _lock_for(team_id):
        team = _load(root, team_id)
        before = len(team["learnings"])
        team["learnings"] = [x for x in team["learnings"] if x["id"] != learning_id]
        if len(team["learnings"]) == before:
            raise TeamError(f"no learning '{learning_id}'")
        _save(root, team)
        audit(root, team_id, actor, "learning.remove", {"id": learning_id})


# ── briefing ──────────────────────────────────────────────────────────────────────────────


def build_brief(team: dict, ref: str, *, goal_id: Optional[str] = None, max_learnings: int = 12,
                include_goals: bool = True) -> str:
    """The context a teammate starts a session with: who they are on this team, who they
    report to, the mission→goal chain for their work, and the team's most-confirmed lessons.

    Built for session *start*. It is text the caller injects into a fresh conversation —
    never rewritten into a running one, so the prompt cache stays intact.
    """
    m = _find_member(team, ref)
    if m is None:
        raise TeamError(f"no member '{ref}'")
    lines = [f"You are {m.get('title') or m.get('role') or 'a teammate'} on the team “{team['name']}”."]
    if team.get("mission"):
        lines.append(f"Team mission: {team['mission']}")
    boss = next((x for x in team["members"] if x["slot"] == m.get("reports_to")), None)
    if boss:
        who = boss.get("profile") or boss.get("title") or boss.get("role")
        lines.append(f"You report to {who}" + (f" ({boss['title']})." if boss.get("title") and boss.get("profile") else "."))
    if m.get("role"):
        lines.append(f"Your role: {m['role']}.")
    mates = [x for x in team["members"] if x is not m and x.get("profile")]
    if mates:
        lines.append("Teammates: " + ", ".join(
            f"{x['profile']} ({x.get('role') or x.get('title') or 'member'})" for x in mates[:16]))
    if goal_id:
        chain = goal_ancestry(team, goal_id)
        lines.append("Why this work matters: " + " → ".join(c["title"] for c in chain))
    elif include_goals:
        mine = [g for g in team["goals"] if g.get("owner") == m["slot"] and g["status"] not in _GOAL_SETTLED]
        if mine:
            lines.append("Your open goals: " + "; ".join(g["title"] for g in mine[:8]))
    learned = sorted(team["learnings"], key=lambda x: (x.get("count", 1), x.get("last_at", 0)), reverse=True)
    if learned:
        lines.append("What this team has learned:")
        lines.extend(f"- {x['text']}" for x in learned[:max_learnings])
    return "\n".join(lines)


# ── team packs (data-only) ────────────────────────────────────────────────────────────────


def export_pack(team: dict) -> dict:
    """A shareable org design: seats, roles, reporting lines and role kits — no profile
    names, ids, spend, credential values, learnings or audit. Open seats on import."""
    slot_of = {m["slot"]: f"s{i + 1}" for i, m in enumerate(team["members"])}
    seats = []
    for m in team["members"]:
        seats.append({
            "slot": slot_of[m["slot"]], "role": m.get("role", ""), "title": m.get("title", ""),
            "reports_to_slot": slot_of.get(m.get("reports_to")), "lead": bool(m.get("lead")),
            "skills": list(m.get("skills", [])), "plugins": list(m.get("plugins", [])),
            "credentials": list(m.get("credentials", [])),
            "monthly_usd": m["budget"].get("monthly_usd"), "hard_stop": m["budget"].get("hard_stop", True),
        })
    return {"pack_version": PACK_VERSION, "name": team["name"], "mission": team.get("mission", ""),
            "policy": {"lead_decides": bool(team["policy"].get("lead_decides"))}, "seats": seats}


def import_pack(root: Path | str, pack: Any, *, name: Optional[str] = None, actor: str = BOARD_ACTOR) -> dict:
    """Create a team from a pack. Strictly allow-listed: unknown keys are ignored, so a
    pack can never smuggle profile names, secrets or code in. Every seat starts open."""
    if not isinstance(pack, dict) or pack.get("pack_version") != PACK_VERSION:
        raise TeamError("unsupported team pack")
    seats = pack.get("seats")
    if not isinstance(seats, list) or len(seats) > 64:
        raise TeamError("team pack needs 1–64 seats")
    team = create_team(root, name=name or pack.get("name") or "", mission=pack.get("mission", ""), actor=actor,
                       lead_decides=bool((pack.get("policy") or {}).get("lead_decides")))
    created: dict[str, str] = {}
    for raw in seats:
        if not isinstance(raw, dict):
            continue
        seat = {k: raw.get(k) for k in _PACK_MEMBER_KEYS if k in raw}
        fields = {"role": seat.get("role"), "title": seat.get("title"), "skills": seat.get("skills"),
                  "plugins": seat.get("plugins"), "credentials": seat.get("credentials"),
                  "hard_stop": seat.get("hard_stop", True)}
        if seat.get("monthly_usd") is not None:
            fields["monthly_usd"] = seat["monthly_usd"]
        member = upsert_member(root, team["id"], actor=actor, **fields)
        created[str(seat.get("slot"))] = member["slot"]
    for raw in seats:
        if not isinstance(raw, dict):
            continue
        me, boss = created.get(str(raw.get("slot"))), created.get(str(raw.get("reports_to_slot")))
        if me and boss:
            upsert_member(root, team["id"], slot=me, reports_to=boss, actor=actor)
        if me and raw.get("lead"):
            upsert_member(root, team["id"], slot=me, lead=True, actor=actor)
    return get_team(root, team["id"])


# ── measured spend + dispatch gate ────────────────────────────────────────────────────────


def _profile_home(root: Path | str, profile: str) -> Path:
    return Path(root) if profile in ("default", "hermes") else Path(root) / "profiles" / profile


def _month_start_epoch() -> float:
    now = time.gmtime()
    return float(time.mktime((now.tm_year, now.tm_mon, 1, 0, 0, 0, 0, 0, 0)) - time.timezone)


def month_spend_from_sessions(root: Path | str, profile: str) -> Optional[float]:
    """This calendar month's spend for one profile, read from ITS OWN session ledger
    (``state.db``). Actual cost wins over the estimate. ``None`` when the profile has no ledger
    or it cannot be read — unknown is not zero, and the caller keeps its last value.
    Read-only: the ledger is the agent's, a team never writes to it."""
    import sqlite3

    db = _profile_home(root, profile) / "state.db"
    if not db.is_file():
        return None
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        try:
            row = conn.execute(
                "SELECT COALESCE(SUM(CASE WHEN COALESCE(actual_cost_usd, 0) > 0 THEN actual_cost_usd "
                "ELSE COALESCE(estimated_cost_usd, 0) END), 0) FROM sessions WHERE started_at >= ?",
                (_month_start_epoch(),),
            ).fetchone()
        finally:
            conn.close()
        return float(row[0] or 0.0)
    except Exception:
        return None


SYNC_MIN_INTERVAL = 60  # seconds — the dispatcher asks every tick; the ledger need not be re-read


def sync_measured_spend(root: Path | str, team_id: str, *, reader: Optional[Callable[[Any, str], Optional[float]]] = None,
                        force: bool = False) -> bool:
    """Refresh each hired seat's ``measured_usd`` from its profile's ledger. Throttled per seat
    to ``SYNC_MIN_INTERVAL``; returns whether anything changed."""
    reader = reader or month_spend_from_sessions
    changed = False
    with _lock_for(team_id):
        team = _load(root, team_id)
        now = _now()
        for m in team["members"]:
            if not m.get("profile"):
                continue
            b = m["budget"] = _roll_period(m["budget"])
            if not force and now - b.get("synced_at", 0) < SYNC_MIN_INTERVAL:
                continue
            value = reader(root, m["profile"])
            b["synced_at"] = now
            if value is None:
                continue
            measured = round(float(value), 6)
            if measured != b.get("measured_usd", 0.0):
                b["measured_usd"] = measured
                b["spent_usd"] = round(b.get("recorded_usd", 0.0) + measured, 6)
                changed = True
        _save(root, team)
    return changed


def held_profiles(root: Path | str, *, reader: Optional[Callable[[Any, str], Optional[float]]] = None) -> dict[str, str]:
    """``{profile: reason}`` for every profile a team currently holds back from NEW work.

    The Kanban dispatcher consults this before it claims a card for an assignee, so a paused
    or budget-exhausted teammate simply stops picking up tasks (they stay ready, nothing is
    failed or lost) until the month rolls over, the limit is raised or the seat is resumed.
    A profile on several teams is held when any of them holds it. Never raises: a broken team
    store must not stop the board.
    """
    held: dict[str, str] = {}
    try:
        for path in _teams_dir(root).glob("*.json"):
            team_id = path.stem
            with contextlib.suppress(Exception):
                sync_measured_spend(root, team_id, reader=reader)
            with contextlib.suppress(Exception):
                for m in _load(root, team_id)["members"]:
                    profile = m.get("profile")
                    if not profile or profile in held:
                        continue
                    verdict = check_budget(root, team_id, profile)
                    if not verdict["allowed"]:
                        held[profile] = f"team {team_id}: {verdict['reason']}"
    except Exception:
        return held
    return held


# ── system-prompt surface ─────────────────────────────────────────────────────────────────

PROMPT_MAX_TEAMS = 2
PROMPT_LEARNINGS = 8


def teams_for_profile(root: Path | str, profile: str) -> list[dict]:
    """Teams on which ``profile`` holds a seat, oldest first (stable order)."""
    out = []
    for path in sorted(_teams_dir(root).glob("*.json")):
        with contextlib.suppress(Exception):
            team = json.loads(path.read_text(encoding="utf-8"))
            if any(m.get("profile") == profile for m in team.get("members", [])):
                out.append(team)
    return sorted(out, key=lambda t: (t.get("created_at", 0), t.get("id", "")))


def prompt_section(root: Path | str, profile: str) -> str:
    """The team context a profile carries into a NEW session's system prompt — empty when the
    profile sits on no team.

    Deliberately the *stable* part of the brief: role, boss, mission, teammates and the top
    lessons. Goals are left out (they change daily and reach a worker through its Kanban task),
    so the text — and the Bot Chat capability fingerprint that hashes it — moves only when the
    team's shape or its top lessons do. Built once per session; never patched into a live one.
    """
    blocks = [
        build_brief(team, profile, max_learnings=PROMPT_LEARNINGS, include_goals=False)
        for team in teams_for_profile(root, profile)[:PROMPT_MAX_TEAMS]
    ]
    return ("## Team\n" + "\n\n".join(blocks)) if blocks else ""


# ── goal → task delegation ────────────────────────────────────────────────────────────────

TaskCreator = Callable[..., str]


def default_task_creator(*, title: str, body: str, assignee: str, created_by: str, idempotency_key: str) -> str:
    """Create the card on this home's default Kanban board (the engine that already does claims,
    runs and dispatch). Raises if Kanban is unavailable — delegating work is not best-effort."""
    from hermes_cli import kanban_db_connect as kbc
    from hermes_cli import kanban_db as kb

    with kbc.connect() as conn:
        return kb.create_task(conn, title=title, body=body, assignee=assignee, created_by=created_by,
                              idempotency_key=idempotency_key)


def spawn_goal_task(root: Path | str, team_id: str, goal_id: str, *, title: str, body: str = "",
                    assignee: Optional[str] = None, actor: str = BOARD_ACTOR,
                    creator: Optional[TaskCreator] = None) -> dict:
    """Delegate a piece of a goal: create a Kanban card for a teammate and link it to the goal.

    The card's body opens with that teammate's brief — role, boss, and the mission→goal chain
    that says WHY the work exists — so a worker that has never seen the team still knows what it
    is for. ``assignee`` defaults to the goal's owner; it must be a hired seat. A paused or
    over-budget seat still receives the card; the dispatcher holds it until the seat may work.
    Idempotent per (team, goal, title): re-delegating the same title returns the same card.
    """
    title = _text(title, 200)
    if not title:
        raise TeamError("task title required")
    with _lock_for(team_id):
        team = _load(root, team_id)
        goal = _goal(team, goal_id)
        ref = assignee or goal.get("owner")
        member = _find_member(team, ref) if ref else None
        if member is None:
            raise TeamError("pick a teammate to assign this to (the goal has no owner yet)")
        if not member.get("profile"):
            raise TeamError("that seat is open — hire a bot into it first")
        text = build_brief(team, member["slot"], goal_id=goal_id, include_goals=False)
        text += f"\n\n## Task\n{title}" + (f"\n\n{_text(body, TEXT_MAX)}" if body.strip() else "")
        slug = re.sub(r"\W+", "-", title.lower())[:80]
        key = f"{team_id}:{goal_id}:{slug}"
    task_id = (creator or default_task_creator)(
        title=title, body=text, assignee=member["profile"], created_by=f"team:{team_id}", idempotency_key=key)
    link_task(root, team_id, goal_id, task_id, actor=actor)
    audit(root, team_id, actor, "goal.delegate", {"goal": goal_id, "task": task_id, "assignee": member["profile"]})
    return {"task_id": task_id, "assignee": member["profile"]}
