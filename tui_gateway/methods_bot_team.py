"""Team Bots JSON-RPC handlers (``bots_team.*``) — the Desktop's (and web client's) door to
``tools/bot_team.py``: org chart, goals with Kanban links and roll-up, per-teammate budgets,
board approvals, shared learnings, session briefs and data-only Team Packs.

The store is install-wide (one team can span profiles), so like the mailbox these handlers
take no profile scope. Domain refusals are 41xx errors the client can show verbatim; anything
unexpected is 51xx. Handlers are rebound onto server.py's globals (method_ctx.py); module
helpers (``_root``, ``_run``) reach them through ``bind_module``.
"""

from pathlib import Path

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method


def _root() -> Path:
    from tools.bot_mode_probe import _default_home, _hermes_root

    return _hermes_root(Path(_default_home()))


def _run(rid, fn):
    """Call ``fn(root, bt)`` and wrap the outcome: TeamNotFound → 4111, TeamError → 4110."""
    from tools import bot_team as bt

    try:
        return _ok(rid, fn(_root(), bt))
    except bt.TeamNotFound as e:
        return _err(rid, 4111, f"no team '{e.args[0]}'")
    except bt.TeamError as e:
        return _err(rid, 4110, str(e))
    except Exception as e:
        return _err(rid, 5110, str(e))


def _need(params: dict, *keys: str):
    missing = [k for k in keys if params.get(k) in (None, "")]
    if missing:
        from tools.bot_team import TeamError

        raise TeamError(f"{', '.join(missing)} required")


def _view(root, bt, team_id: str) -> dict:
    team = bt.get_team(root, team_id)
    return {"team": team, "tree": bt.org_tree(team), "rollup": bt.rollup(team)}


@method("bots_team.list")
def _(rid, params: dict) -> dict:
    return _run(rid, lambda root, bt: {"teams": bt.list_teams(root)})


@method("bots_team.get")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id")
        return _view(root, bt, params["team_id"])

    return _run(rid, go)


@method("bots_team.room_lead")
def _(rid, params: dict) -> dict:
    """The org-tree lead for a group-chat room of local member profiles — ``lead`` null keeps
    the room on fan-out listening (no covering team, no seated/paused lead, or ambiguity)."""
    def go(root, bt):
        members = params.get("members")
        resolved = bt.room_lead(root, members if isinstance(members, list) else [])
        return resolved or {
            "lead": None, "lead_slot": "", "lead_title": "", "team_id": None, "team_name": ""}

    return _run(rid, go)


@method("bots_team.create")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        team = bt.create_team(root, name=params.get("name"), mission=params.get("mission") or "",
                              actor=str(params.get("actor") or "you"),
                              lead_decides=bool(params.get("lead_decides")), channels=params.get("channels"))
        return _view(root, bt, team["id"])

    return _run(rid, go)


@method("bots_team.update")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id")
        fields = {k: params[k] for k in ("name", "mission", "lead_decides", "channels") if k in params}
        bt.update_team(root, params["team_id"], actor=str(params.get("actor") or "you"), **fields)
        return _view(root, bt, params["team_id"])

    return _run(rid, go)


@method("bots_team.delete")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id")
        bt.delete_team(root, params["team_id"], actor=str(params.get("actor") or "you"))
        return {"ok": True}

    return _run(rid, go)


@method("bots_team.member.upsert")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id")
        keys = ("profile", "role", "title", "skills", "plugins", "credentials", "status",
                "monthly_usd", "hard_stop", "reports_to", "lead")
        member = bt.upsert_member(root, params["team_id"], slot=params.get("slot") or None,
                                  actor=str(params.get("actor") or "you"),
                                  **{k: params[k] for k in keys if k in params})
        return {"member": member, **_view(root, bt, params["team_id"])}

    return _run(rid, go)


@method("bots_team.member.remove")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id", "member")
        bt.remove_member(root, params["team_id"], params["member"], actor=str(params.get("actor") or "you"))
        return _view(root, bt, params["team_id"])

    return _run(rid, go)


@method("bots_team.goal.upsert")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id")
        keys = ("title", "detail", "parent_id", "owner", "status")
        goal = bt.upsert_goal(root, params["team_id"], goal_id=params.get("goal_id") or None,
                              actor=str(params.get("actor") or "you"),
                              **{k: params[k] for k in keys if k in params})
        return {"goal": goal, **_view(root, bt, params["team_id"])}

    return _run(rid, go)


@method("bots_team.goal.link_task")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id", "goal_id", "task_id")
        goal = bt.link_task(root, params["team_id"], params["goal_id"], params["task_id"],
                            unlink=bool(params.get("unlink")), actor=str(params.get("actor") or "you"))
        return {"goal": goal, **_view(root, bt, params["team_id"])}

    return _run(rid, go)


@method("bots_team.goal.spawn_task")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id", "goal_id", "title")
        made = bt.spawn_goal_task(root, params["team_id"], params["goal_id"], title=params["title"],
                                  body=params.get("body") or "", assignee=params.get("assignee") or None,
                                  actor=str(params.get("actor") or "you"))
        return {**made, **_view(root, bt, params["team_id"])}

    return _run(rid, go)


@method("bots_team.approval.request")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id", "kind", "subject", "requested_by")
        approval = bt.request_approval(root, params["team_id"], kind=params["kind"], subject=params["subject"],
                                       requested_by=params["requested_by"], detail=params.get("detail") or "",
                                       payload=params.get("payload"))
        return {"approval": approval}

    return _run(rid, go)


@method("bots_team.approval.decide")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id", "approval_id")
        approval = bt.decide_approval(root, params["team_id"], params["approval_id"],
                                      approve=bool(params.get("approve")),
                                      actor=str(params.get("actor") or "you"), note=params.get("note") or "")
        return {"approval": approval, **_view(root, bt, params["team_id"])}

    return _run(rid, go)


@method("bots_team.budget.check")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id", "member")
        return bt.check_budget(root, params["team_id"], params["member"])

    return _run(rid, go)


@method("bots_team.budget.record")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id", "member", "usd")
        return bt.record_spend(root, params["team_id"], params["member"], params["usd"],
                               actor=str(params.get("actor") or "system"))

    return _run(rid, go)


@method("bots_team.learning.add")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id", "text", "by")
        return {"learning": bt.add_learning(root, params["team_id"], text=params["text"], by=params["by"],
                                            source=params.get("source") or "")}

    return _run(rid, go)


@method("bots_team.learning.remove")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id", "learning_id")
        bt.remove_learning(root, params["team_id"], params["learning_id"], actor=str(params.get("actor") or "you"))
        return _view(root, bt, params["team_id"])

    return _run(rid, go)


@method("bots_team.brief")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id", "member")
        team = bt.get_team(root, params["team_id"])
        return {"brief": bt.build_brief(team, params["member"], goal_id=params.get("goal_id") or None)}

    return _run(rid, go)


@method("bots_team.pack.export")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id")
        return {"pack": bt.export_pack(bt.get_team(root, params["team_id"]))}

    return _run(rid, go)


@method("bots_team.pack.import")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        team = bt.import_pack(root, params.get("pack"), name=params.get("name") or None,
                              actor=str(params.get("actor") or "you"))
        return _view(root, bt, team["id"])

    return _run(rid, go)


@method("bots_team.audit.list")
def _(rid, params: dict) -> dict:
    def go(root, bt):
        _need(params, "team_id")
        return {"entries": bt.list_audit(root, params["team_id"], int(params.get("limit") or 200))}

    return _run(rid, go)


def register(server) -> None:
    bind_module(globals(), server, skip=("_",))
