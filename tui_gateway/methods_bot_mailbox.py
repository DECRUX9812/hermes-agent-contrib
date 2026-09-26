"""Agent-mailbox JSON-RPC handlers — the Desktop's door to the structured-note store
(#48). ``bots_mailbox.list`` reads the install-wide mailbox; ``bots_mailbox.send`` files
a note AND pushes its human-readable text through the same delivery path a relayed DM
takes (``bot_relay.deliver`` — live-owner admit, prompt.submit, or the one-turn Bot Chat
subprocess); ``bots_mailbox.update`` flips a note's status and, when the sender is a live
local bot, drops a status line into its Bot Chat. Plumbing: ``tools/bot_mailbox.py``;
handlers are rebound onto server.py's globals (method_ctx.py) and reference ``_ok``/``_err``
bare."""

from pathlib import Path

from .method_ctx import HandlerRegistry

_registry = HandlerRegistry()
method = _registry.method


def _mailbox_root() -> Path:
    """Install root shared by every profile — same formula as methods_bot_relay._relay_root."""
    from tools.bot_mode_probe import _default_home, _hermes_root

    return _hermes_root(Path(_default_home()))


def _local_roster(root: Path) -> dict:
    """profile folder id → its home dir, for the local teammate set."""
    from tools.bot_mode_probe import _roster

    return dict(_roster(root))


@method("bots_mailbox.list")
def _(rid, params: dict, _root=_mailbox_root) -> dict:
    """List mailbox notes on this install, newest first → ``{notes}``. ``handle`` narrows
    to notes a bot sends or receives."""
    try:
        from tools.bot_mailbox import list_notes

        handle = str(params.get("handle") or "").strip() or None
        return _ok(rid, {"notes": list_notes(_root(), handle)})
    except Exception as e:
        return _err(rid, 5100, str(e))


@method("bots_mailbox.send")
def _(rid, params: dict, _root=_mailbox_root) -> dict:
    """File a user-authored note and deliver its text into the target's Bot Chat →
    ``{note, reply?}`` for a local bot or ``{note, queued: true}`` when the target lives
    on another connected gateway (the Desktop relay carries it — same drain as DMs)."""
    import time

    target = str(params.get("to") or "").strip().lstrip("@")
    title = str(params.get("title") or "").strip()
    body = str(params.get("body") or "").strip()
    if not target or not title:
        return _err(rid, 4100, "to and title required")
    try:
        from tools.bot_mailbox import append_note, new_note_id
        from tools.bot_mode_dm import _resolve_local_name
        from tools.bot_mode_probe import _handle

        root = _root()
        roster_homes = _local_roster(root)
        resolved = _resolve_local_name(target, list(roster_homes), root)
        sender = {"kind": "user", "name": "You", "profile": str(params.get("profile") or "")}
        payload = params.get("payload")

        if resolved is not None and resolved in roster_homes:
            note = append_note(
                root,
                to={"kind": "bot", "profile": resolved, "handle": _handle(resolved)},
                sender=sender,
                title=title,
                body=body,
                payload=payload,
            )
            # The text carries the id so the recipient can update_task it; deliver through
            # the relay path on THIS gateway (it resolves a local profile by name too).
            text = (
                f"Task hand-off from the user (via Desktop): {title}"
                + (f"\n\n{body}" if body else "")
                + f"\n\n[task {note['id']} — call update_task(note=…, status=…) to accept/decline/finish it]"
            )
            delivered = _methods["bot_relay.deliver"](rid, {
                "profile": resolved,
                "message": text,
                "from_handle": "you",
            })
            if "error" in delivered:
                # The note is still filed — report delivery's failure beside it rather than
                # failing the whole call.
                return _ok(rid, {"note": note, "delivery_error": delivered["error"].get("message", "delivery failed")})
            return _ok(rid, {"note": note, "reply": delivered.get("result", {}).get("reply", "")})

        # Remote target — queue a relay envelope carrying the note; the Desktop's drain
        # delivers it to the target install, whose mailbox takes the canonical copy.
        from tools.bot_relay import enqueue_envelope, read_remote_roster, resolve_remote_target

        remote = resolve_remote_target(target, read_remote_roster(root))
        if remote is None or remote == "ambiguous":
            return _err(rid, 4101, f"no bot named '{target}' on this install or a connected gateway")
        note_id = new_note_id()
        note = {
            "id": note_id,
            "kind": "task",
            "to": {"kind": "bot", "profile": remote["profile"], "handle": remote["handle"],
                   "connection": remote["connection_id"]},
            "sender": sender,
            "title": title[:200],
            "body": body[:16000],
            "payload": payload,
            "status": "open",
            "reply": "",
            "created_at": int(time.time()),
            "updated_at": int(time.time()),
        }
        text = (
            f"Task hand-off from the user (via Desktop): {title}"
            + (f"\n\n{body}" if body else "")
            + f"\n\n[task {note_id} — call update_task(note=…, status=…) to accept/decline/finish it]"
        )
        try:
            enqueue_envelope(
                root,
                target=remote,
                message=text,
                sender_profile=str(params.get("profile") or "") or "default",
                sender_handle="you",
                note=note,
            )
        except Exception as e:
            return _err(rid, 5101, str(e))
        return _ok(rid, {"note": note, "queued": True})
    except Exception as e:
        return _err(rid, 5102, str(e))


@method("bots_mailbox.update")
def _(rid, params: dict, _root=_mailbox_root) -> dict:
    """Flip a note's status (``{id, status, reply?}``) → ``{note}``. When the sender is a
    local bot with a LIVE Bot Chat, a one-line status note is admitted to it best-effort —
    no live owner means the mailbox itself is the record and nothing is spawned."""
    note_id = str(params.get("id") or "").strip()
    status = str(params.get("status") or "").strip().lower()
    if not note_id or not status:
        return _err(rid, 4102, "id and status required")
    try:
        from tools.bot_mailbox import update_note

        root = _root()
        note = update_note(root, note_id, status=status, reply=str(params.get("reply") or ""))
    except KeyError:
        return _err(rid, 4103, f"no mailbox note '{note_id}'")
    except ValueError as e:
        return _err(rid, 4104, str(e))
    except Exception as e:
        return _err(rid, 5103, str(e))

    try:
        _notify_sender_status(root, note)
    except Exception:
        logger.debug("bots_mailbox.update status notify failed", exc_info=True)
    return _ok(rid, {"note": note})


def _notify_sender_status(root: Path, note: dict) -> None:
    """Best-effort: when the note's sender is a local bot whose Bot Chat is live, admit a
    one-line status DM (its poller picks it up at the next idle boundary). Anything else —
    a user sender, a dead/cold bot — is left on the mailbox where the status already shows."""
    sender = note.get("sender") or {}
    if str(sender.get("kind") or "") != "bot":
        return
    from_profile = str(sender.get("profile") or "").strip()
    if not from_profile or from_profile not in _local_roster(root):
        return
    home = _local_roster(root)[from_profile]
    from tools.bot_live_delivery import deliver_to_live_owner, find_canonical_live_owner
    from tools.bot_relay import delivery_turn_author

    owner = find_canonical_live_owner(home)
    if owner is None:
        return
    reply = str(note.get("reply") or "").strip()
    text = (f"Task {note['id']} ({str(note.get('title') or '')[:120]}) → {note['status']}"
            + (f": {reply[:500]}" if reply else ""))
    deliver_to_live_owner(home, owner, text,
                          author=delivery_turn_author(from_profile, sender.get("handle")))


def register(server) -> None:
    _registry.install(server)
    # send rides bot_relay.deliver — a full one-turn conversation when the target's Bot
    # Chat isn't live (see _LONG_HANDLERS' bot_relay.* comment).
    server._LONG_HANDLERS = server._LONG_HANDLERS | {"bots_mailbox.send"}
