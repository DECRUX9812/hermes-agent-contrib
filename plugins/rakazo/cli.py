"""CLI for the rakazo plugin.

Wires ``hermes bots <verb>``:
  create      — create a new bot
  list        — list all bots
  show        — show bot details
  delete      — delete a bot
  send        — send a message to a bot
  routines    — list bot cron routines
  audit       — show audit log
  memory      — read bot memory files
  run         — start an interactive session as a bot
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from plugins.rakazo.bot_db import (
    create_bot,
    delete_bot,
    get_audit_log,
    get_bot,
    get_bot_by_name,
    list_bots,
    list_routines,
    update_bot,
)


def _ts(seconds: float | int | None = None) -> str:
    if seconds is None:
        return "—"
    try:
        dt = datetime.fromtimestamp(float(seconds), tz=timezone.utc)
        return dt.strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return "—"


def register_cli(subparser) -> None:
    subs = subparser.add_subparsers(dest="bots_command")

    # create
    p_create = subs.add_parser("create", help="Create a new bot")
    p_create.add_argument("name", help="Unique bot name")
    p_create.add_argument("--description", "-d", default="", help="Short description")
    p_create.add_argument("--instructions", "-i", default="", help="System prompt / personality")
    p_create.add_argument("--color", default="#7c3aed", help="Avatar color hex")
    p_create.add_argument(
        "--approval-mode", choices=["auto", "strict"], default="auto",
        help="auto=unattended, strict=require approval for dangerous tools",
    )
    p_create.add_argument("--model", default="", help="Model override")
    p_create.add_argument("--no-notify", action="store_true", help="Don't notify on finish")

    # list
    subs.add_parser("list", help="List all bots")

    # show
    p_show = subs.add_parser("show", help="Show bot details")
    p_show.add_argument("bot", help="Bot name or ID")

    # delete
    p_delete = subs.add_parser("delete", help="Delete a bot")
    p_delete.add_argument("bot", help="Bot name or ID")
    p_delete.add_argument("--force", action="store_true", help="Skip confirmation")

    # send
    p_send = subs.add_parser("send", help="Send a message to a bot")
    p_send.add_argument("bot", help="Bot name or ID")
    p_send.add_argument("message", help="Message to send")
    p_send.add_argument("--block", action="store_true", help="Wait for completion")

    # routines
    p_routines = subs.add_parser("routines", help="List cron routines for a bot")
    p_routines.add_argument("bot", help="Bot name or ID")

    # audit
    p_audit = subs.add_parser("audit", help="Show audit log for a bot")
    p_audit.add_argument("bot", help="Bot name or ID")
    p_audit.add_argument("--limit", type=int, default=50)
    p_audit.add_argument("--offset", type=int, default=0)

    # memory
    p_memory = subs.add_parser("memory", help="Read bot memory files")
    p_memory.add_argument("bot", help="Bot name or ID")
    p_memory.add_argument("path", nargs="?", default=".", help="Path in bot memory dir")

    # run
    p_run = subs.add_parser("run", help="Start an interactive session as a bot")
    p_run.add_argument("bot", help="Bot name or ID")
    p_run.add_argument("--message", "-m", default="", help="Initial message (skip interactive)")

    # approve (for strict mode)
    p_approve = subs.add_parser("approve", help="Approve a tool for a strict bot")
    p_approve.add_argument("bot", help="Bot name")
    p_approve.add_argument("tool", help="Tool name to approve")


def _resolve_bot(name_or_id: str) -> dict | None:
    return get_bot_by_name(name_or_id) or get_bot(name_or_id)


def bots_command(args: argparse.Namespace) -> int:
    cmd = getattr(args, "bots_command", None)
    if cmd is None:
        print("Usage: hermes bots <create|list|show|delete|send|routines|audit|memory|run|approve>")
        return 1

    if cmd == "create":
        bot = create_bot(
            name=args.name,
            description=args.description,
            instructions=args.instructions,
            color=args.color,
            approval_mode=args.approval_mode,
            model=args.model,
            notify_on_finish=not args.no_notify,
        )
        print(f"✅ Bot '{bot['name']}' created (ID: {bot['id']})")
        if args.instructions:
            print(f"   Instructions: {args.instructions[:100]}")
        print(f"   Approval mode: {bot['approval_mode']}")
        return 0

    if cmd == "list":
        bots = list_bots()
        if not bots:
            print("No bots yet. Create one with: hermes bots create <name>")
            return 0
        print(f"{'NAME':<20} {'STATUS':<10} {'RUNS':<6} {'APPROVAL':<10} {'CREATED'}")
        print("─" * 70)
        for b in bots:
            print(
                f"{b['name']:<20} {b['status']:<10} {b.get('run_count', 0):<6} "
                f"{b.get('approval_mode', 'auto'):<10} {_ts(b['created_at'])}"
            )
        print(f"\n{len(bots)} bot(s)")
        return 0

    if cmd == "show":
        bot = _resolve_bot(args.bot)
        if not bot:
            print(f"❌ Bot '{args.bot}' not found.")
            return 1
        print(f"  Name:       {bot['name']}")
        print(f"  ID:         {bot['id']}")
        print(f"  Status:     {bot['status']}")
        print(f"  Approval:   {bot.get('approval_mode', 'auto')}")
        if bot.get("description"):
            print(f"  Desc:       {bot['description']}")
        if bot.get("model"):
            print(f"  Model:      {bot['model']}")
        print(f"  Runs:       {bot.get('run_count', 0)}")
        print(f"  Created:    {_ts(bot['created_at'])}")
        print(f"  Last run:   {_ts(bot.get('last_run_at'))}")
        # Show recent audit
        audit = get_audit_log(bot["id"], limit=5)
        if audit:
            print(f"\n  Recent activity:")
            for a in audit:
                print(f"    {_ts(a['timestamp'])}  {a['tool_name']}")
        return 0

    if cmd == "delete":
        bot = _resolve_bot(args.bot)
        if not bot:
            print(f"❌ Bot '{args.bot}' not found.")
            return 1
        if not args.force:
            resp = input(f"Delete bot '{bot['name']}' and all its data? [y/N] ")
            if resp.lower() != "y":
                print("Cancelled.")
                return 0
        delete_bot(bot["id"])
        print(f"🗑️  Bot '{bot['name']}' deleted.")
        return 0

    if cmd == "send":
        bot = _resolve_bot(args.bot)
        if not bot:
            print(f"❌ Bot '{args.bot}' not found.")
            return 1
        from plugins.rakazo.tools import _launch_bot_turn, _queue_message
        if args.block:
            _queue_message(bot["id"], args.message)
            print(f"📨 Message queued for bot '{bot['name']}' (will be picked up on next run).")
        else:
            _launch_bot_turn(bot["id"], args.message)
            update_bot(bot["id"], status="running")
            print(f"🚀 Bot '{bot['name']}' launched with your message.")
        return 0

    if cmd == "routines":
        bot = _resolve_bot(args.bot)
        if not bot:
            print(f"❌ Bot '{args.bot}' not found.")
            return 1
        routines = list_routines(bot["id"])
        if not routines:
            print(f"No routines for bot '{bot['name']}'.")
            print("Attach one with: hermes cron add --tag rakazo:<bot-id> <schedule> <prompt>")
            return 0
        print(f"Routines for '{bot['name']}':")
        for r in routines:
            print(f"  • {r['schedule']}  —  {r.get('prompt', '')[:80]}")
            print(f"    Status: {r.get('status', 'active')}  |  Last run: {_ts(r.get('last_run_at'))}")
        return 0

    if cmd == "audit":
        bot = _resolve_bot(args.bot)
        if not bot:
            print(f"❌ Bot '{args.bot}' not found.")
            return 1
        entries = get_audit_log(bot["id"], limit=args.limit, offset=args.offset)
        if not entries:
            print(f"No audit log for bot '{bot['name']}'.")
            return 0
        print(f"Audit log for '{bot['name']}' ({len(entries)} entries):\n")
        for a in entries:
            print(f"  [{_ts(a['timestamp'])}] {a['tool_name']}")
            if a.get("tool_args"):
                args_str = json.dumps(a["tool_args"])
                print(f"    args: {args_str[:120]}")
            if a.get("result_summary"):
                print(f"    result: {a['result_summary'][:120]}")
            print()
        return 0

    if cmd == "memory":
        bot = _resolve_bot(args.bot)
        if not bot:
            print(f"❌ Bot '{args.bot}' not found.")
            return 1
        from pathlib import Path
        from hermes_constants import get_hermes_home
        base = Path(get_hermes_home()) / "rakazo" / "bots" / bot["id"] / "memory"
        base.mkdir(parents=True, exist_ok=True)
        target = (base / args.path).resolve()
        if not str(target).startswith(str(base)):
            print("❌ Path escapes bot memory directory.")
            return 1
        if target.is_dir():
            items = sorted(target.iterdir())
            if not items:
                print(f"Empty directory: {args.path}")
                return 0
            print(f"Contents of {args.path}/")
            for p in items:
                rel = p.relative_to(base)
                if p.is_dir():
                    print(f"  📁 {rel}/")
                else:
                    size = p.stat().st_size
                    print(f"  📄 {rel}  ({size} bytes)")
            return 0
        if target.is_file():
            print(target.read_text())
            return 0
        print(f"❌ Not found: {args.path}")
        return 1

    if cmd == "run":
        bot = _resolve_bot(args.bot)
        if not bot:
            print(f"❌ Bot '{args.bot}' not found.")
            return 1
        # Import the integration that sets up a live bot session
        from plugins.rakazo.bot_runner import run_bot_session_interactive
        run_bot_session_interactive(bot, initial_message=args.message)
        return 0

    if cmd == "approve":
        bot = _resolve_bot(args.bot)
        if not bot:
            print(f"❌ Bot '{args.bot}' not found.")
            return 1
        # For now, switch from strict to auto after approval
        update_bot(bot["id"], approval_mode="auto")
        print(f"✅ Bot '{bot['name']}' switched to auto-approve mode.")
        return 0

    print(f"Unknown command: {cmd}")
    return 1
