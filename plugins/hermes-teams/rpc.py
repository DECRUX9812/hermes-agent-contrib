"""``teams.*`` JSON-RPC handlers: roles, team templates and team runs.

Install-wide like the Kanban board (a team spans profiles), so the handlers take no profile scope.
Domain refusals are 41xx errors the client can show verbatim; anything unexpected is 51xx.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from tui_gateway.method_ctx import HandlerRegistry

from . import catalog, team_run
from .catalog import TeamsError

logger = logging.getLogger(__name__)

_registry = HandlerRegistry()
method = _registry.method

# Creating a role's profile copies a profile tree: off the reader thread.
_LONG = {"teams.roles.ensure", "teams.run.start"}


def _server():
    return sys.modules["tui_gateway.server"]


def _run(rid, fn):
    try:
        return _server()._ok(rid, fn())
    except TeamsError as e:
        return _server()._err(rid, 4130, str(e))
    except ValueError as e:
        # kanban_db refuses bad input (workspace kind, model override) with ValueError.
        return _server()._err(rid, 4131, str(e))
    except Exception as e:
        logger.exception("hermes-teams: handler failed")
        return _server()._err(rid, 5130, str(e))


def _need(params: dict, *keys: str) -> None:
    missing = [k for k in keys if params.get(k) in (None, "")]
    if missing:
        raise TeamsError(f"{', '.join(missing)} required")


def _board(params: dict):
    from hermes_cli import kanban_db_connect as kbc

    return kbc.connect_closing(board=params.get("board") or None)


def _profiles_present(names: set[str]) -> set[str]:
    from hermes_cli.profiles import profile_exists

    return {n for n in names if profile_exists(n)}


@method("teams.roles.list")
def _(rid, params: dict) -> dict:
    def go():
        roles = catalog.roles()
        present = _profiles_present({r.profile for r in roles.values()})
        return {"roles": [r.view() | {"bot_exists": r.profile in present} for r in roles.values()]}

    return _run(rid, go)


@method("teams.roles.ensure")
def _(rid, params: dict) -> dict:
    def go():
        _need(params, "role")
        profile, created = catalog.ensure_role_bot(catalog.get_role(str(params["role"])),
                                                   clone_from=params.get("clone_from") or None)
        return {"profile": profile, "created": created}

    return _run(rid, go)


@method("teams.templates.list")
def _(rid, params: dict) -> dict:
    return _run(rid, lambda: {"templates": [t.view() for t in catalog.templates().values()]})


def _assignees(template: catalog.Template, roles: dict, params: dict) -> dict[str, str]:
    """Role -> profile for every role the template uses; creates role bots when asked."""
    chosen = params.get("assignees") or {}
    if not isinstance(chosen, dict):
        raise TeamsError("assignees must map role ids to profile names")
    wanted = {s.role for s in template.steps}
    out = {r: str(chosen.get(r) or roles[r].profile) for r in wanted if r in roles}
    missing = sorted(set(out.values()) - _profiles_present(set(out.values())))
    if missing and params.get("create_missing"):
        for role_id, profile in out.items():
            if profile in missing and profile == roles[role_id].profile:
                catalog.ensure_role_bot(roles[role_id])
        missing = sorted(set(out.values()) - _profiles_present(set(out.values())))
    if missing:
        raise TeamsError(f"these teammates have no profile yet: {', '.join(missing)}")
    return out


@method("teams.run.start")
def _(rid, params: dict) -> dict:
    def go():
        _need(params, "template", "goal")
        template = catalog.get_template(str(params["template"]))
        roles = catalog.roles()
        assignees = _assignees(template, roles, params)
        with _board(params) as conn:
            root = team_run.start_run(
                conn, template=template, goal=str(params["goal"]), roles=roles, assignees=assignees,
                workspace_kind=params.get("workspace_kind") or None,
                workspace_path=params.get("workspace_path") or None,
                idempotency_key=params.get("idempotency_key") or None,
            )
            return {"run": team_run.run_view(conn, root)}

    return _run(rid, go)


@method("teams.run.list")
def _(rid, params: dict) -> dict:
    def go():
        with _board(params) as conn:
            return {"runs": team_run.list_runs(conn, limit=int(params.get("limit") or 20))}

    return _run(rid, go)


@method("teams.run.get")
def _(rid, params: dict) -> dict:
    def go():
        _need(params, "run_id")
        with _board(params) as conn:
            return {"run": team_run.run_view(conn, str(params["run_id"]))}

    return _run(rid, go)


@method("teams.run.message")
def _(rid, params: dict) -> dict:
    def go():
        _need(params, "run_id", "body")
        with _board(params) as conn:
            comment_id = team_run.post_message(conn, str(params["run_id"]), body=str(params["body"]),
                                               author=str(params.get("author") or "you"),
                                               step=params.get("step") or None)
            return {"comment_id": comment_id, "run": team_run.run_view(conn, str(params["run_id"]))}

    return _run(rid, go)


def install(server: Any) -> list[str]:
    for name, fn in _registry._pending:
        server.register_method(name, fn)
    server._LONG_HANDLERS = server._LONG_HANDLERS | _LONG
    return sorted(_registry.names())
