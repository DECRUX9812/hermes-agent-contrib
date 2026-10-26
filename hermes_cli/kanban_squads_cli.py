"""``hermes kanban squad …``: the CLI face of :mod:`hermes_cli.kanban_squads`."""

from __future__ import annotations

import argparse
from typing import Callable

from hermes_cli import kanban_db_connect as kbc
from hermes_cli import kanban_squads as sq

_STATE_GLYPH = {"done": "✓", "running": "▶", "attention": "!", "queued": "·"}


def _out(args: argparse.Namespace, payload, lines: Callable[[], list[str]]) -> int:
    from hermes_cli.kanban import _print_json

    if getattr(args, "json", False):
        _print_json(payload)
    else:
        print("\n".join(lines()))
    return 0


def _roles(args: argparse.Namespace) -> int:
    roles = sq.roles_view()
    return _out(args, {"roles": roles}, lambda: [
        f"{r['emoji']} {r['id']:<12} {r['profile']:<20} {'bot ready' if r['bot_exists'] else 'no bot yet'}  {r['summary']}"
        for r in roles])


def _templates(args: argparse.Namespace) -> int:
    found = [t.as_dict() for t in sq.templates().values()]

    def lines() -> list[str]:
        out = []
        for t in found:
            out.append(f"{t['id']}: {t['name']} — {t['summary']}")
            out.extend(f"    {s['key']} ({s['role']})" + (f" after {', '.join(s['needs'])}" if s["needs"] else "")
                       + (" [final]" if s["final"] else "") for s in t["steps"])
        return out

    return _out(args, {"templates": found}, lines)


def _parse_assign(raw: list[str]) -> dict[str, str]:
    out = {}
    for item in raw:
        role, sep, profile = item.partition("=")
        if not sep or not role.strip() or not profile.strip():
            raise sq.SquadError(f"--assign wants ROLE=PROFILE, got {item!r}")
        out[role.strip()] = profile.strip()
    return out


def _run_lines(run: dict) -> list[str]:
    lines = [f"{_STATE_GLYPH.get(run['state'], '?')} {run['id']}  {run['title']}  ({run['done']}/{run['total']} done)"]
    for lane in run.get("lanes", ()):
        tail = " [final]" if lane.get("final") else ""
        lines.append(f"    {lane['key']:<10} {lane['status']:<8} {lane['profile']:<20} {lane['task_id']}{tail}")
    return lines


def _start(args: argparse.Namespace) -> int:
    template = sq.get_template(args.template)
    catalog = sq.roles()
    assignees = sq.resolve_assignees(template, catalog, _parse_assign(args.assign or []),
                                     create_missing=args.create_missing)
    with kbc.connect_closing() as conn:
        root = sq.start_run(conn, template=template, goal=args.goal, catalog=catalog, assignees=assignees,
                            workspace_kind=args.workspace_kind, workspace_path=args.workspace,
                            idempotency_key=args.idempotency_key)
        run = sq.run_view(conn, root)
    return _out(args, run, lambda: _run_lines(run))


def _list(args: argparse.Namespace) -> int:
    with kbc.connect_closing() as conn:
        runs = sq.list_runs(conn, limit=args.limit)
    return _out(args, {"runs": runs}, lambda: [line for r in runs for line in _run_lines(r)] or ["No squads yet."])


def _show(args: argparse.Namespace) -> int:
    with kbc.connect_closing() as conn:
        run = sq.run_view(conn, args.run_id)
    return _out(args, run, lambda: _run_lines(run) + [f"  note from {n['author']}: {n['body']}" for n in run["notes"]])


def _message(args: argparse.Namespace) -> int:
    from hermes_cli.kanban import _profile_author

    with kbc.connect_closing() as conn:
        comment_id = sq.post_message(conn, args.run_id, body=" ".join(args.text), step=args.step,
                                     author=args.author or _profile_author())
    print(f"Posted comment {comment_id}")
    return 0


def _bot(args: argparse.Namespace) -> int:
    profile, created = sq.ensure_role_bot(sq.get_role(args.role))
    print(f"{'Created' if created else 'Already have'} {profile}")
    return 0


_ACTIONS: dict[str, Callable[[argparse.Namespace], int]] = {
    "roles": _roles, "templates": _templates, "start": _start, "list": _list,
    "show": _show, "message": _message, "bot": _bot,
}

# Actions a fenced delegated child may not run (they write the board or create profiles).
MUTATING_ACTIONS = frozenset({"start", "message", "bot"})


def cmd_squad(args: argparse.Namespace) -> int:
    from hermes_cli.kanban import _err

    try:
        return _ACTIONS[getattr(args, "squad_action", None) or "list"](args)
    except (sq.SquadError, FileExistsError) as exc:
        return _err(f"kanban squad: {exc}", 2)
