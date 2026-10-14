import threading
from pathlib import Path

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method

# Fork-only setup-profile lifecycle, namespaced under fork.onboarding.* so it never collides with
# upstream's onboarding.* (state/start/skip/set_run) RPCs. Runs on the RPC pool: two overlapping
# kickoffs must not both find no setup profile and create a second one.
_setup_profile_lock = threading.Lock()


@method("fork.onboarding.ensure_setup_profile")
def _(rid, params: dict) -> dict:
    from hermes_cli.setup_profile import ensure_setup_profile
    from tui_gateway.methods_profiles import _mirror_launch_credentials
    try:
        with _setup_profile_lock:
            setup = ensure_setup_profile()
            if setup.created:
                _mirror_launch_credentials(setup.path, {"share_auth": True})
    except Exception as e:
        return _err(rid, 5073, str(e))
    return _ok(rid, {"name": setup.name, "path": str(setup.path), "created": setup.created})


@method("fork.onboarding.ensure_setup_session")
def _(rid, params: dict) -> dict:
    from hermes_cli.setup_profile import SETUP_CHAT_TITLE, ensure_setup_profile
    from hermes_state_registry import acquire, release_or_close
    from tui_gateway.methods_profiles import _mirror_launch_credentials
    from tui_gateway.session_history import _coerce_seed_history
    try:
        with _setup_profile_lock:
            setup = ensure_setup_profile()
            if setup.created:
                _mirror_launch_credentials(setup.path, {"share_auth": True})
            db = acquire(setup.path / "state.db")
            try:
                row = db.get_session_by_title(SETUP_CHAT_TITLE)
                if row is None:
                    row = {"id": db.create_session(new_session_id(), "desktop"), "message_count": 0}
                    db.set_session_title(row["id"], SETUP_CHAT_TITLE)
                if not row["message_count"]:
                    row["message_count"] = db.append_messages_batch(row["id"], _coerce_seed_history(params.get("messages")))
            finally:
                release_or_close(db)
    except Exception as e:
        logger.exception("fork.onboarding.ensure_setup_session failed")
        return _err(rid, 5075, str(e))
    return _ok(rid, {"profile": setup.name, "session_id": row["id"], "empty": not row["message_count"]})


@method("fork.onboarding.state")
def _(rid, params: dict) -> dict:
    from hermes_cli.setup_profile import read_state, settle_returning_user

    def settle_then_read() -> dict:
        settle_returning_user()
        return read_state()
    return _onboarding_state_result(rid, settle_then_read)


@method("fork.onboarding.record_failed_start")
def _(rid, params: dict) -> dict:
    from hermes_cli.setup_profile import record_failed_start
    return _onboarding_state_result(rid, record_failed_start)


@method("fork.onboarding.mark_seen")
def _(rid, params: dict) -> dict:
    from hermes_cli.setup_profile import mark_intro_seen
    return _onboarding_state_result(rid, mark_intro_seen)


@method("fork.onboarding.reset_setup_profile")
def _(rid, params: dict) -> dict:
    from hermes_cli.setup_profile import find_setup_profile, reset_setup_profile
    with _setup_profile_lock:
        found = find_setup_profile()
        if found is None:
            return _err(rid, 4072, "no setup profile to reset")
        _clear_setup_sessions(found[1])
        try:
            setup = reset_setup_profile(_launch_home())
        except Exception as e:
            return _err(rid, 5074, str(e))
    return _ok(rid, {"name": setup.name, "path": str(setup.path), "reset": True})


def _onboarding_state_result(rid, change) -> dict:
    from hermes_cli.setup_profile import find_setup_profile, onboarding_eligible
    try:
        state = change()
        found = find_setup_profile()
    except Exception as e:
        logger.exception("fork.onboarding state update failed")
        return _err(rid, 5076, str(e))
    return _ok(rid, {"eligible": onboarding_eligible(), "profile": found[0] if found else None, **state})


def _clear_setup_sessions(profile_dir) -> None:
    from hermes_state_registry import acquire, release_or_close
    from tui_gateway.session_lifecycle import _close_session_by_id
    target = Path(profile_dir).resolve()
    with _sessions_lock:
        live = [sid for sid, sess in _sessions.items()
                if Path(sess.get("profile_home") or _hermes_home).resolve() == target]
    for sid in live:
        _close_session_by_id(sid, end_reason="setup_reset")
    db = acquire(target / "state.db")
    try:
        ids = [row[0] for row in db._read_all("SELECT id FROM sessions")]
        db.delete_sessions(ids, sessions_dir=target / "sessions")
    finally:
        release_or_close(db)


def register(server) -> None:
    bind_module(globals(), server, skip=("_",))
