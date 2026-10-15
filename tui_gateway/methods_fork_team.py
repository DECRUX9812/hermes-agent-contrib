"""Goal-first team board RPC handlers."""

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method


def _root():
    from tools.bot_mode_probe import _default_home, _hermes_root

    from pathlib import Path

    return _hermes_root(Path(_default_home()))


def _call(rid, operation):
    from tools import bot_team as bt
    from tools.team_board import TeamBoardError

    try:
        return _ok(rid, operation())
    except TeamBoardError as exc:
        return _err(rid, exc.code, str(exc))
    except bt.TeamNotFound as exc:
        return _err(rid, 4111, f"no team '{exc.args[0]}'")
    except bt.TeamError as exc:
        return _err(rid, 4110, str(exc))
    except Exception as exc:
        logger.exception("fork.team request failed")
        return _err(rid, 5114, str(exc))


@method("fork.team.board")
def _(rid, params: dict) -> dict:
    from tools.team_board import board

    return _call(rid, lambda: board(_root(), params["team_id"], params.get("goal_id")))


@method("fork.team.goal.start")
def _(rid, params: dict) -> dict:
    from tools.team_board import start_goal

    return _call(
        rid,
        lambda: start_goal(
            _root(), params["team_id"], params["title"], params.get("detail"),
        ),
    )


@method("fork.team.card.stop")
def _(rid, params: dict) -> dict:
    from tools.team_board import stop_card

    return _call(rid, lambda: stop_card(_root(), params["task_id"]))


@method("fork.team.card.takeover")
def _(rid, params: dict) -> dict:
    from tools.team_board import takeover_card

    return _call(rid, lambda: takeover_card(_root(), params["task_id"]))


@method("fork.team.card.resume")
def _(rid, params: dict) -> dict:
    from tools.team_board import resume_card

    return _call(
        rid,
        lambda: resume_card(_root(), params["task_id"], params.get("assignee")),
    )


@method("fork.team.templates.list")
def _(rid, params: dict) -> dict:
    from tools.team_board import list_templates

    return _call(rid, lambda: {"templates": list_templates()})


@method("fork.team.templates.apply")
def _(rid, params: dict) -> dict:
    from tools.team_board import apply_template

    return _call(
        rid,
        lambda: apply_template(
            _root(),
            params["template_id"],
            params["request_id"],
            name=params.get("name"),
            assign=params.get("assign"),
        ),
    )


def register(server) -> None:
    bind_module(globals(), server, skip=("_",))
