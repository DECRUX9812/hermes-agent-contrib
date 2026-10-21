"""``hermes bots`` — create and organize Bot Mode bots from the command line.

A bot is a profile whose ``profile.yaml`` carries ``ui_meta['hermes-bots']``; a team is the
install-wide org chart in ``tools/bot_team.py``. The Desktop's "New bot" dialog and Team pane
drive the same two stores over the gateway. This door exists so an AGENT can do it too: the
main bot runs these commands (guided by the ``bot-team-builder`` skill) when a user asks it to
"set up a team for me". No new model tool — terminal + skill, per the footprint ladder.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

BOTS_META_KEY = "hermes-bots"


def _out(args, payload, text: str) -> None:
    print(json.dumps(payload, ensure_ascii=False) if getattr(args, "json", False) else text)


def _die(args, message: str, code: int = 1) -> None:
    if getattr(args, "json", False):
        print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    else:
        print(f"Error: {message}", file=sys.stderr)
    sys.exit(code)


def _team_root() -> Path:
    from tools.bot_mode_probe import _default_home, _hermes_root
    return _hermes_root(Path(_default_home()))


def _bot_rows() -> list[dict]:
    """Every profile with a Bot Mode marker: name, title, description, model."""
    from hermes_cli.profile_ui_meta import read_profile_yaml
    from hermes_cli.profiles import get_profile_dir, list_profiles

    rows = []
    for info in list_profiles():
        name = getattr(info, "name", None) or (info.get("name") if isinstance(info, dict) else None)
        if not name:
            continue
        profile_dir = get_profile_dir(name)
        meta = (read_profile_yaml(profile_dir).get("ui_meta") or {}).get(BOTS_META_KEY)
        if not isinstance(meta, dict):
            continue
        model = getattr(info, "model", None) or (info.get("model") if isinstance(info, dict) else None)
        rows.append({"name": name, "title": str(meta.get("title") or ""),
                     "description": str(meta.get("description") or ""), "model": model or ""})
    return rows


def _cmd_list(args) -> None:
    rows = _bot_rows()
    text = "\n".join(
        f"- {r['name']}" + (f" — {r['title']}" if r["title"] else "") + (f" ({r['model']})" if r["model"] else "")
        for r in rows) or "No bots yet. Create one: hermes bots create <name> --title <role>"
    _out(args, {"ok": True, "bots": rows}, text)


def _persona_soul(existing: str, persona: str) -> str:
    """Append the persona as the SOUL's ``## Style`` section (the Desktop starter convention)."""
    persona = persona.strip()
    if not persona:
        return existing
    return f"{existing.rstrip()}\n\n## Style\n\n{persona}\n" if existing.strip() else f"## Style\n\n{persona}\n"


_HEX_COLOR = re.compile(r"#[0-9a-fA-F]{6}")


def _cmd_create(args) -> None:
    from hermes_cli.profile_ui_meta import merge_ui_meta
    from hermes_cli.profiles import create_profile, get_active_profile_name

    if args.color and not _HEX_COLOR.fullmatch(args.color):
        _die(args, f"--color must be a hex color like #7c5cff, not '{args.color}'")
    source = args.clone_from or get_active_profile_name()
    try:
        # Clone the source's config/.env/SOUL/skills: the new bot answers on the same model and
        # keys from its first message — "create bot and it just works".
        profile_dir = create_profile(name=args.name, clone_from=source, clone_config=True,
                                     description=args.role or args.title or None, no_alias=True)
    except (ValueError, FileExistsError, FileNotFoundError) as e:
        _die(args, str(e))
    if args.persona:
        soul = profile_dir / "SOUL.md"
        current = soul.read_text(encoding="utf-8-sig") if soul.is_file() else ""
        soul.write_text(_persona_soul(current, args.persona), encoding="utf-8")
    meta = {"title": (args.title or args.name).strip()}
    if args.role:
        meta["description"] = args.role.strip()
    if args.color:
        meta["color"] = args.color
    merge_ui_meta(profile_dir, {BOTS_META_KEY: meta})
    _out(args, {"ok": True, "name": args.name, "path": str(profile_dir), "cloned_from": source, **meta},
         f"Bot '{args.name}' created (cloned from {source}). It appears in the Desktop Bots pane; "
         f"its Bot Chat opens on first use.")


def _team_ref(root: Path, ref: str) -> dict:
    """A team by id or (case-insensitive) name."""
    from tools import bot_team as bt
    for summary in bt.list_teams(root):
        if summary["id"] == ref or str(summary.get("name") or "").lower() == ref.lower():
            return bt.get_team(root, summary["id"])
    raise bt.TeamError(f"no team named '{ref}' (see: hermes bots team list)")


def _cmd_team(args) -> None:
    from tools import bot_team as bt

    root = _team_root()
    action = args.team_action
    try:
        if action in ("list", "ls", None):
            teams = bt.list_teams(root)
            text = "\n".join(f"- {t['name']} ({t['member_count']} seats) [{t['id']}]" for t in teams) or "No teams yet."
            return _out(args, {"ok": True, "teams": teams}, text)
        if action == "create":
            team = bt.create_team(root, name=args.name, mission=args.mission or "", actor="cli")
            return _out(args, {"ok": True, "team": team}, f"Team '{team['name']}' created [{team['id']}].")
        if action == "add":
            team = _team_ref(root, args.team)
            known = {r["name"] for r in _bot_rows()}
            if args.profile not in known:
                raise bt.TeamError(f"'{args.profile}' is not a bot (see: hermes bots list)")
            fields = {"profile": args.profile, "title": args.title or "", "role": args.role or ""}
            if args.reports_to:
                fields["reports_to"] = args.reports_to
            if args.lead:
                fields["lead"] = True
            member = bt.upsert_member(root, team["id"], actor="cli", **fields)
            return _out(args, {"ok": True, "member": member},
                        f"'{args.profile}' seated on '{team['name']}'" + (" as lead." if args.lead else "."))
        if action == "show":
            team = _team_ref(root, args.team)
            lead = bt.lead_member(team)
            lines = [f"{team['name']}: {team.get('mission') or '(no mission)'}"]
            lines += [f"- {m.get('profile') or '(open seat)'}" + (f" — {m['title']}" if m.get("title") else "")
                      + (" [lead]" if lead is m else "") for m in team["members"]]
            return _out(args, {"ok": True, "team": team}, "\n".join(lines))
    except bt.TeamError as e:
        _die(args, str(e))
    _die(args, f"unknown action '{action}'")


# A lesson is a line in the bot's own MEMORY.md, so it rides the frozen memory snapshot into the
# bot's NEXT session (never a live prompt rebuild). The prefix marks it as the user's call: the
# retro skill proposes, the user approves, and `lesson list/remove` keeps every one vetoable.
LESSON_PREFIX = "Team lesson (approved by the user):"


def _lesson_targets(args) -> list[str]:
    """The bots a lesson command addresses: one bot, or every seated bot on ``--team``."""
    if args.team:
        from tools import bot_team as bt
        try:
            team = _team_ref(_team_root(), args.who)
        except bt.TeamError as e:
            _die(args, str(e))
        names = [m["profile"] for m in team["members"] if m.get("profile")]
        if not names:
            _die(args, f"team '{team['name']}' has no bots seated yet")
        return names
    if args.who not in {r["name"] for r in _bot_rows()}:
        _die(args, f"'{args.who}' is not a bot (see: hermes bots list)")
    return [args.who]


def _with_bot_memory(name: str, fn):
    """Run ``fn(store)`` against BOT's own MEMORY.md, not the caller's profile."""
    from hermes_cli.profiles import get_profile_dir
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    from tools.memory_tool import load_on_disk_store

    token = set_hermes_home_override(get_profile_dir(name))
    try:
        return fn(load_on_disk_store())
    finally:
        reset_hermes_home_override(token)


def _lessons(store) -> list[str]:
    return [e for e in store.memory_entries if e.startswith(LESSON_PREFIX)]


def _lesson_add(args) -> None:
    text = " ".join(args.text.split())
    if not text:
        _die(args, "a lesson needs text")
    results = {name: _with_bot_memory(name, lambda store: store.add("memory", f"{LESSON_PREFIX} {text}"))
               for name in _lesson_targets(args)}
    failed = {name: r.get("error", "") for name, r in results.items() if not r.get("success")}
    lines = [f"- {name}: " + ("added" if name not in failed else f"not added — {failed[name]}") for name in results]
    payload = {"ok": not failed, "lesson": text, "added": [n for n in results if n not in failed], "failed": failed}
    _out(args, payload, "\n".join(lines) + "\nIt applies from each bot's next chat.")
    if failed:
        sys.exit(1)


def _lesson_list(args) -> None:
    found = {name: _with_bot_memory(name, _lessons) for name in _lesson_targets(args)}
    lines = []
    for name, entries in found.items():
        lines.append(f"{name}:" if entries else f"{name}: no lessons")
        lines += [f"  {i}. {e[len(LESSON_PREFIX):].strip()}" for i, e in enumerate(entries, 1)]
    _out(args, {"ok": True, "lessons": {n: [e[len(LESSON_PREFIX):].strip() for e in v] for n, v in found.items()}},
         "\n".join(lines))


def _lesson_remove(args) -> None:
    if args.team:
        _die(args, "remove works on one bot at a time: hermes bots lesson remove <bot> <number>")
    name = _lesson_targets(args)[0]

    def _remove(store):
        entries = _lessons(store)
        if not 1 <= args.number <= len(entries):
            return None
        entry = entries[args.number - 1]
        return entry, store.remove("memory", entry, matched_entry=entry)

    found = _with_bot_memory(name, _remove)
    if found is None:
        _die(args, f"{name} has no lesson #{args.number} (see: hermes bots lesson list {name})")
    entry, result = found
    if not result.get("success"):
        _die(args, result.get("error") or "could not remove the lesson")
    text = entry[len(LESSON_PREFIX):].strip()
    _out(args, {"ok": True, "bot": name, "removed": text}, f"Removed from {name}: {text}")


def _cmd_lesson(args) -> None:
    handlers = {"add": _lesson_add, "list": _lesson_list, "ls": _lesson_list, "remove": _lesson_remove,
                "rm": _lesson_remove}
    handler = handlers.get(args.lesson_action or "")
    if handler is None:
        _die(args, "usage: hermes bots lesson {add,list,remove} ...")
    handler(args)


def cmd_bots(args) -> None:
    handlers = {"list": _cmd_list, "ls": _cmd_list, "create": _cmd_create, "team": _cmd_team, "lesson": _cmd_lesson}
    handlers.get(args.bots_action or "list", _cmd_list)(args)


def build_bots_parser(subparsers) -> None:
    parser = subparsers.add_parser(
        "bots", help="Create Bot Mode bots and teams",
        description="Create bots (profiles the Desktop Bots pane shows) and organize them into teams.")
    parser.add_argument("--json", action="store_true", help="Machine-readable output")
    sub = parser.add_subparsers(dest="bots_action")

    sub.add_parser("list", aliases=["ls"], help="List bots")

    create = sub.add_parser("create", help="Create a bot (clones the active profile's model and keys)")
    create.add_argument("name", help="Profile name for the bot (lowercase, e.g. scout)")
    create.add_argument("--title", default="", help="Display name, e.g. 'Scout'")
    create.add_argument("--role", default="", help="One-line role, e.g. 'Researcher — finds and cites sources'")
    create.add_argument("--persona", default="", help="How the bot should behave (written to SOUL.md ## Style)")
    create.add_argument("--color", default="", help="Avatar color as hex, e.g. '#35d49a' (default: derived from the name)")
    create.add_argument("--from", dest="clone_from", default=None, metavar="PROFILE",
                        help="Profile to clone config from (default: the active profile)")

    team = sub.add_parser("team", help="Manage bot teams (who leads, who reports to whom)")
    team_sub = team.add_subparsers(dest="team_action")
    team_sub.add_parser("list", aliases=["ls"], help="List teams")
    t_create = team_sub.add_parser("create", help="Create a team")
    t_create.add_argument("name")
    t_create.add_argument("--mission", default="")
    t_add = team_sub.add_parser("add", help="Seat a bot on a team")
    t_add.add_argument("team", help="Team name or id")
    t_add.add_argument("profile", help="Bot profile name")
    t_add.add_argument("--title", default="")
    t_add.add_argument("--role", default="")
    t_add.add_argument("--reports-to", dest="reports_to", default=None, help="Profile or seat it reports to")
    t_add.add_argument("--lead", action="store_true", help="Make this bot the team lead (the one who listens)")
    t_show = team_sub.add_parser("show", help="Show a team's seats")
    t_show.add_argument("team")

    lesson = sub.add_parser("lesson", help="Lessons a bot keeps in its memory (you approve every one)")
    lesson_sub = lesson.add_subparsers(dest="lesson_action")
    l_add = lesson_sub.add_parser("add", help="Add a lesson to a bot (or to every bot on a team with --team)")
    l_add.add_argument("who", help="Bot profile name, or a team name with --team")
    l_add.add_argument("text", help="The lesson, one short instruction")
    l_list = lesson_sub.add_parser("list", aliases=["ls"], help="List a bot's (or a team's) lessons")
    l_list.add_argument("who", help="Bot profile name, or a team name with --team")
    l_remove = lesson_sub.add_parser("remove", aliases=["rm"], help="Remove one of a bot's lessons by number")
    l_remove.add_argument("who", help="Bot profile name")
    l_remove.add_argument("number", type=int, help="Lesson number from `hermes bots lesson list`")
    for p in (l_add, l_list, l_remove):
        p.add_argument("--team", action="store_true", help="WHO names a team: apply to every bot seated on it")

    # `--json` after the action too (`hermes bots create x --json`); aliases share a parser.
    for p in {id(p): p for p in (*sub.choices.values(), *team_sub.choices.values(),
                                 *lesson_sub.choices.values())}.values():
        p.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    parser.set_defaults(func=cmd_bots)
