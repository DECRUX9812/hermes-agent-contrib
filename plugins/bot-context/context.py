"""Bot context: who is asking, in which bot, in which room, and what is missing.

The Bot Mode *context panel* (desktop `hermes-bots/bot-context-panel.tsx`) reads
this information off per-session `/session.resume` snapshots: profile, bot title,
room binding, pending prompt. That shape only exists for a client that is already
attached to the member session, so an approval raised by a bot in a background
profile has no addressable context outside that one pane.

This module builds the same context from the *host* side, where an approval
actually happens: hook kwargs (session key, session id, turn id), the live
session registry's profile home for that key, the profile's own ``profile.yaml``
metadata, and the room binding encoded in the session key.

Rules that keep this honest:

* Resolution never raises. Every failed step lands in ``missing`` (a required
  fact we do not have) or ``degraded`` (an optional resolver that failed, with
  the reason), so callers can say exactly what they could not find instead of
  guessing a profile or inventing a bot name.
* ``complete`` means a caller can act on this context: a profile *and* a session
  key. Missing bot titles and rooms are presentation gaps, not action gaps.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

logger = logging.getLogger("plugins.bot-context")

# Profile-name fallbacks. ``get_hermes_home()`` may point at the launch
# profile, at a ``profiles/<name>`` dir, or at nothing recognizable.
_LAUNCH_PROFILE = "default"

# ``room:<task_id>:<execution_generation>`` — the key the room driver mints for
# one dispatched room task (gateway/platforms/api_server_room_dispatch.py).
_ROOM_KEY_PREFIX = "room:"


@dataclass(frozen=True)
class BotContext:
    """The addressable context of one bot session, as far as the host can prove it."""

    profile: str = ""
    profile_home: str = ""
    bot_title: str = ""
    session_key: str = ""
    session_id: str = ""
    turn_id: str = ""
    tool_call_id: str = ""
    platform: str = ""
    surface: str = ""
    room: str | None = None
    room_generation: str | None = None
    missing: tuple[str, ...] = ()
    degraded: tuple[str, ...] = ()
    # Which step produced ``profile``: explicit arg, live session record, env, or home.
    profile_source: str = ""

    @property
    def complete(self) -> bool:
        """True when a caller can act on this context (profile + session key)."""
        return bool(self.profile and self.session_key)

    @property
    def is_room_session(self) -> bool:
        return bool(self.room)

    @property
    def label(self) -> str:
        """Human label for messages: the bot's title, else its profile name, else a placeholder."""
        return self.bot_title or self.profile or "unknown bot"

    def to_dict(self) -> dict[str, Any]:
        return {
            "profile": self.profile,
            "profile_home": self.profile_home,
            "bot_title": self.bot_title,
            "label": self.label,
            "session_key": self.session_key,
            "session_id": self.session_id,
            "turn_id": self.turn_id,
            "tool_call_id": self.tool_call_id,
            "platform": self.platform,
            "surface": self.surface,
            "room": self.room,
            "room_generation": self.room_generation,
            "is_room_session": self.is_room_session,
            "complete": self.complete,
            "profile_source": self.profile_source,
            "missing": list(self.missing),
            "degraded": list(self.degraded),
        }


def _clean(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _profile_from_home(home: str | os.PathLike[str] | None) -> tuple[str, str]:
    """``(profile_name, reason)`` for a hermes home path; name is "" when unknown.

    Only a home that IS the process's own launch home resolves to the unnamed
    ``default`` profile here. Any other unnameable directory returns ``""`` so
    the caller keeps looking (``HERMES_PROFILE``, then the launch home) instead
    of silently labelling a stranger's home "default".
    """
    if not home:
        return "", "no profile home"
    path = Path(home)
    try:
        from hermes_constants import profile_name_for_home
        name = _clean(profile_name_for_home(path))
    except Exception as exc:  # pragma: no cover - hermes_constants is a hard dependency
        return "", f"profile_name_for_home failed: {exc}"
    if name:
        return name, ""
    launch = _launch_profile_home()
    if launch:
        try:
            if os.path.realpath(str(path)) == os.path.realpath(str(launch)):
                return _LAUNCH_PROFILE, ""
        except OSError:  # pragma: no cover - defensive
            pass
    return "", "home is not a named profile"


def _launch_profile_home() -> Path | None:
    try:
        from hermes_constants import get_process_hermes_home
        return Path(get_process_hermes_home())
    except Exception:  # pragma: no cover - defensive
        return None


def _env_profile_name() -> str:
    for name in ("HERMES_PROFILE_NAME", "HERMES_PROFILE"):
        value = _clean(os.environ.get(name, ""))
        if value:
            return value
    return ""


def _live_session(session_key: str) -> tuple[str, str, str]:
    """``(profile_home, session_id, reason)`` for a live gateway session.

    ``tui_gateway`` is a gateway package: absent in CLI-only installs and in unit
    tests, so this is optional-by-design and reports why it could not answer.
    The runtime id matters for session-scoped views: the hook payload carries a
    session *key*, while the Desktop selects rows by the registry's session id.
    """
    if not session_key:
        return "", "", "no session key to look up"
    try:
        from tui_gateway.session_registry import _find_live_session_by_key
    except Exception as exc:
        return "", "", f"session registry unavailable: {exc.__class__.__name__}"
    try:
        found = _find_live_session_by_key(session_key)
    except Exception as exc:
        return "", "", f"session registry lookup failed: {exc.__class__.__name__}"
    if not found:
        return "", "", "no live session for this key"
    sid, session = found
    home = _clean((session or {}).get("profile_home"))
    if not home:
        # A record without a profile home IS the launch profile (registry contract).
        launch = _launch_profile_home()
        return ((str(launch) if launch else ""), _clean(sid), "") if launch \
            else ("", _clean(sid), "live session has no profile home")
    return home, _clean(sid), ""


def _bot_title(home: str) -> tuple[str, str]:
    """Bot Mode title for a profile home, read from ``profile.yaml`` ``ui_meta``.

    Deliberately re-read here instead of importing ``hermes_cli.profiles``: that
    helper is a core internal (not on the plugin public-surface allowlist), and
    the value is presentation-only — a miss must never block an approval.
    """
    if not home:
        return "", "no profile home"
    path = Path(home) / "profile.yaml"
    if not path.is_file():
        return "", "profile.yaml missing"
    try:
        import hermes_yaml as yaml
        data = yaml.safe_load(path.read_text(encoding="utf-8-sig")) or {}
    except Exception as exc:
        return "", f"profile.yaml unreadable: {exc.__class__.__name__}"
    if not isinstance(data, Mapping):
        return "", "profile.yaml is not a mapping"
    ui_meta = data.get("ui_meta")
    if isinstance(ui_meta, Mapping):
        bots = ui_meta.get("hermes-bots")
        if isinstance(bots, Mapping):
            title = _clean(bots.get("title"))
            if title:
                return title, ""
    return _clean(data.get("display_name")), ""


def _split_room(session_key: str) -> tuple[str | None, str | None]:
    if not session_key.startswith(_ROOM_KEY_PREFIX):
        return None, None
    parts = session_key[len(_ROOM_KEY_PREFIX):].split(":")
    room = _clean(parts[0]) if parts else ""
    generation = _clean(parts[1]) if len(parts) > 1 else ""
    return (room or None), (generation or None)


def resolve_bot_context(
    *,
    session_key: Any = "",
    session_id: Any = "",
    turn_id: Any = "",
    tool_call_id: Any = "",
    surface: Any = "",
    profile: Any = "",
    profile_home: Any = "",
    platform: Any = "",
) -> BotContext:
    """Resolve the bot context for an approval or an activity record.

    Precedence for the profile: explicit ``profile``/``profile_home`` argument →
    the live session record for ``session_key`` → ``HERMES_PROFILE``/``HERMES_PROFILE_NAME``
    → the current (launch) hermes home. Every miss is reported, never guessed
    past the last step: an unresolvable profile yields ``profile == ""``.
    """
    missing: list[str] = []
    degraded: list[str] = []
    key = _clean(session_key)
    sid = _clean(session_id)

    if not key and not sid:
        missing.append("session_key")
        missing.append("session_id")

    resolved_profile = _clean(profile)
    resolved_home = _clean(profile_home)
    source = "explicit" if (resolved_profile or resolved_home) else ""

    if key:
        home, live_sid, why = _live_session(key)
        if live_sid and not sid:
            # The registry's runtime id is what live UI events are tagged with;
            # carrying it here keeps session-scoped listings addressable.
            sid = live_sid
        if home and not resolved_home:
            resolved_home, source = home, source or "live_session"
            if not resolved_profile:
                # The session record is authoritative for which profile this
                # session belongs to; a process-wide HERMES_PROFILE cannot be.
                name, _why = _profile_from_home(home)
                if name:
                    resolved_profile = name
                    source = "live_session"
        elif why and not home:
            degraded.append(f"live_session: {why}")

    if not resolved_home:
        env_home = _clean(os.environ.get("HERMES_HOME", ""))
        if env_home:
            resolved_home = env_home
            source = source or "env"
        else:
            launch = _launch_profile_home()
            if launch:
                resolved_home = str(launch)
                source = source or "launch_home"

    if not resolved_profile:
        # An explicit process identity outranks a guess made from a directory name:
        # ``hermes -p atlas`` sets both, and a shared home makes the name the only
        # truthful signal.
        env_name = _env_profile_name()
        if env_name:
            resolved_profile = env_name
            source = source or "env"
            if not resolved_home:
                try:
                    from hermes_constants import named_profile_home
                    named = named_profile_home(env_name)
                    if named:
                        resolved_home = str(named)
                except Exception as exc:  # pragma: no cover - defensive
                    degraded.append(f"named_profile_home: {exc.__class__.__name__}")

    if not resolved_profile and resolved_home:
        name, why = _profile_from_home(resolved_home)
        if name:
            resolved_profile = name
            source = source or "home"
        elif why:
            degraded.append(f"profile: {why}")

    if not resolved_profile:
        launch = _launch_profile_home()
        if launch:
            resolved_profile = _LAUNCH_PROFILE
            resolved_home = resolved_home or str(launch)
            source = source or "launch_home"

    if not resolved_profile:
        missing.append("profile")

    title = ""
    if resolved_home:
        title, why = _bot_title(resolved_home)
        if why and why not in ("profile.yaml missing", "no profile home"):
            degraded.append(f"bot_title: {why}")
    else:
        degraded.append("bot_title: no profile home")

    room, generation = _split_room(key)

    if not key:
        degraded.append("room: no session key to classify")

    platform_name = _clean(platform)
    if not platform_name:
        try:
            from gateway.session_context import get_session_env
            platform_name = _clean(get_session_env("HERMES_SESSION_PLATFORM", ""))
        except Exception:
            platform_name = _clean(os.environ.get("HERMES_SESSION_PLATFORM", ""))

    return BotContext(
        profile=resolved_profile,
        profile_home=resolved_home,
        bot_title=title,
        session_key=key,
        session_id=sid,
        turn_id=_clean(turn_id),
        tool_call_id=_clean(tool_call_id),
        platform=platform_name,
        surface=_clean(surface),
        room=room,
        room_generation=generation,
        missing=tuple(missing),
        degraded=tuple(degraded),
        profile_source=source,
    )


def context_from_hook(payload: Mapping[str, Any]) -> BotContext:
    """Resolve context from a ``pre_approval_request`` / ``post_approval_response`` payload."""
    return resolve_bot_context(
        session_key=payload.get("session_key"),
        session_id=payload.get("session_id"),
        turn_id=payload.get("turn_id"),
        tool_call_id=payload.get("tool_call_id"),
        surface=payload.get("surface"),
        platform=payload.get("platform"),
    )


def is_launch_profile(home: str | None) -> bool:
    """True when ``home`` is this process's launch profile (the operator's own)."""
    launch = _launch_profile_home()
    if not launch or not home:
        return False
    try:
        return os.path.realpath(str(home)) == os.path.realpath(str(launch))
    except OSError:  # pragma: no cover - defensive
        return False
