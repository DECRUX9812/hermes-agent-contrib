"""Fork bot identity and memory RPC handlers.

Methods:
  - fork.bot.identity.get
  - fork.bot.identity.set
  - fork.memory.list
  - fork.memory.add
  - fork.memory.update
  - fork.memory.remove
"""

from __future__ import annotations

import contextlib
import hashlib
from pathlib import Path

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method


def _resolve_bot_profile(rid, params: dict):
    profile = str(params.get("profile") or params.get("name") or "").strip()
    if not profile:
        return None, None, _err(rid, 4063, "profile required")
    from tui_gateway.server import _resolve_profile
    return _resolve_profile(rid, {"name": profile})


@contextlib.contextmanager
def _profile_scope(profile_dir: Path):
    from tui_gateway.server import (
        _launch_home,
        _profile_runtime_scope_tokens,
        _release_profile_runtime_scope_tokens,
    )
    is_launch = profile_dir.resolve() == _launch_home().resolve()
    scopes = _profile_runtime_scope_tokens(None if is_launch else str(profile_dir))
    try:
        yield
    finally:
        _release_profile_runtime_scope_tokens(scopes)


def _read_bot_identity(profile_name: str, profile_dir: Path) -> dict:
    from hermes_cli.config import load_config
    from hermes_cli.profile_ui_meta import clean_revisions, read_profile_yaml

    raw_yaml = read_profile_yaml(profile_dir)
    ui_meta = raw_yaml.get("ui_meta") if isinstance(raw_yaml.get("ui_meta"), dict) else {}
    bots_meta = ui_meta.get("hermes-bots") if isinstance(ui_meta.get("hermes-bots"), dict) else {}
    raw_revs = raw_yaml.get("_ui_meta_revisions") if isinstance(raw_yaml.get("_ui_meta_revisions"), dict) else {}
    cleaned_revs = clean_revisions(raw_revs)
    revision = cleaned_revs.get("hermes-bots", 0)

    display_name = str(bots_meta.get("title") or "")
    if not display_name:
        from hermes_cli.profiles import read_profile_meta
        try:
            meta = read_profile_meta(profile_dir)
            display_name = str(meta.get("display_name") or "")
        except (OSError, ValueError):
            display_name = ""

    role = str(bots_meta.get("role") or "")

    soul_path = profile_dir / "SOUL.md"
    try:
        instructions = soul_path.read_text(encoding="utf-8", errors="replace") if soul_path.is_file() else ""
    except OSError:
        instructions = ""

    try:
        cfg = load_config() or {}
    except (OSError, ValueError):
        cfg = {}
    model_cfg = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}
    model_pin = {
        "provider": str(model_cfg.get("provider") or ""),
        "default": str(model_cfg.get("default") or ""),
    }

    return {
        "profile": profile_name,
        "display_name": display_name,
        "role": role,
        "instructions": instructions,
        "model": model_pin,
        "revision": revision,
    }


def _apply_bot_model(profile_dir: Path, params: dict, applied: dict[str, bool | None]) -> str | None:
    if params.get("model") is None and params.get("provider") is None:
        return None
    from hermes_cli.config import load_config
    from tui_gateway.server import _configure_model
    model_params = dict(params)
    if model_params.get("model") and not model_params.get("provider"):
        cfg = load_config() or {}
        cur_p = (cfg.get("model") or {}).get("provider")
        if cur_p:
            model_params["provider"] = cur_p
        elif "/" in str(model_params["model"]):
            p, m = str(model_params["model"]).split("/", 1)
            model_params["provider"] = p
            model_params["model"] = m
    model_applied: dict[str, bool] = {}
    confirm_message = _configure_model(profile_dir, model_params, model_applied)
    if model_applied.get("model"):
        applied["model"] = True
    elif params.get("model") is not None:
        applied["model"] = False
    return confirm_message


def _apply_bot_ui_meta(
    profile_dir: Path,
    raw_yaml: dict,
    display_name: str | None,
    role: str | None,
    expected_revision: int | None,
    applied: dict[str, bool | None],
) -> bool:
    if display_name is None and role is None:
        return True
    from hermes_cli.profile_ui_meta import merge_ui_meta
    ui_meta = raw_yaml.get("ui_meta") if isinstance(raw_yaml.get("ui_meta"), dict) else {}
    current_bots = dict(ui_meta.get("hermes-bots")) if isinstance(ui_meta.get("hermes-bots"), dict) else {}
    next_bots = dict(current_bots)
    if display_name is not None:
        next_bots["title"] = display_name
    if role is not None:
        next_bots["role"] = role

    expected = {"hermes-bots": expected_revision} if expected_revision is not None else None
    outcome = merge_ui_meta(profile_dir, {"hermes-bots": next_bots}, expected)
    if "conflicts" in outcome:
        return False
    did_apply = bool(outcome.get("applied"))
    if display_name is not None:
        applied["display_name"] = did_apply
    if role is not None:
        applied["role"] = did_apply
    return True


def _apply_bot_instructions(profile_dir: Path, instructions: str | None, applied: dict[str, bool | None]) -> None:
    if instructions is None:
        return
    soul_path = profile_dir / "SOUL.md"
    try:
        soul_path.write_text(str(instructions), encoding="utf-8")
        applied["instructions"] = True
    except OSError:
        applied["instructions"] = False


@method("fork.bot.identity.get")
def _(rid, params: dict) -> dict:
    profile_name, profile_dir, err = _resolve_bot_profile(rid, params)
    if err is not None:
        return err
    with _profile_scope(profile_dir):
        return _ok(rid, _read_bot_identity(profile_name, profile_dir))


@method("fork.bot.identity.set")
def _(rid, params: dict) -> dict:
    profile_name, profile_dir, err = _resolve_bot_profile(rid, params)
    if err is not None:
        return err

    if params.get("display_name") is not None:
        cleaned_display_name = str(params["display_name"]).strip()
        if not cleaned_display_name:
            return _err(rid, 4092, "empty display_name")
    else:
        cleaned_display_name = None

    cleaned_role = str(params["role"]).strip() if params.get("role") is not None else None

    from hermes_cli.profile_incarnation import profile_incarnation_lease
    try:
        with profile_incarnation_lease(profile_dir):
            with _profile_scope(profile_dir):
                from hermes_cli.profile_ui_meta import clean_revisions, read_profile_yaml
                raw_yaml = read_profile_yaml(profile_dir)
                raw_revs = raw_yaml.get("_ui_meta_revisions") if isinstance(raw_yaml.get("_ui_meta_revisions"), dict) else {}
                cleaned_revs = clean_revisions(raw_revs)
                current_rev = cleaned_revs.get("hermes-bots", 0)

                expected_revision = params.get("expected_revision")
                if expected_revision is not None and expected_revision != current_rev:
                    return _err(rid, 4091, "bot identity changed")

                applied: dict[str, bool | None] = {}
                confirm_message = _apply_bot_model(profile_dir, params, applied)

                if not _apply_bot_ui_meta(profile_dir, raw_yaml, cleaned_display_name, cleaned_role, expected_revision, applied):
                    return _err(rid, 4091, "bot identity changed")

                _apply_bot_instructions(profile_dir, params.get("instructions"), applied)

                fresh = _read_bot_identity(profile_name, profile_dir)
                res = {
                    **fresh,
                    "applied": applied,
                }
                if confirm_message is not None:
                    res["confirm_required"] = True
                    res["confirm_message"] = confirm_message
                return _ok(rid, res)
    except (FileNotFoundError, TimeoutError) as e:
        return _err(rid, 4064, str(e))


def _memory_list_dict(store) -> dict:
    entries = []
    for target in ("memory", "user"):
        for text in store._entries_for(target):
            entry_id = hashlib.sha1(f"{target}\0{text}".encode()).hexdigest()[:12]
            entries.append({"id": entry_id, "target": target, "text": text})
    return {
        "entries": entries,
        "usage": {
            "memory": {
                "used": store._char_count("memory"),
                "limit": store._char_limit("memory"),
            },
            "user": {
                "used": store._char_count("user"),
                "limit": store._char_limit("user"),
            },
        },
        "enabled": {
            "memory": store.target_enabled("memory"),
            "user": store.target_enabled("user"),
        },
    }


def _find_memory_entry(store, item_id: str) -> tuple[str | None, str | None]:
    for target in ("memory", "user"):
        for entry in store._entries_for(target):
            eid = hashlib.sha1(f"{target}\0{entry}".encode()).hexdigest()[:12]
            if eid == item_id:
                return target, entry
    return None, None


@method("fork.memory.list")
def _(rid, params: dict) -> dict:
    _profile_name, profile_dir, err = _resolve_bot_profile(rid, params)
    if err is not None:
        return err
    with _profile_scope(profile_dir):
        from tools.memory_tool import load_on_disk_store
        store = load_on_disk_store()
        return _ok(rid, _memory_list_dict(store))


@method("fork.memory.add")
def _(rid, params: dict) -> dict:
    _profile_name, profile_dir, err = _resolve_bot_profile(rid, params)
    if err is not None:
        return err
    target = str(params.get("target") or "").strip()
    if target not in ("memory", "user"):
        return _err(rid, 4094, f"Invalid memory target '{target}'. Use 'memory' or 'user'.")
    text = str(params.get("text") or "")
    from hermes_cli.profile_incarnation import profile_incarnation_lease
    try:
        with profile_incarnation_lease(profile_dir):
            with _profile_scope(profile_dir):
                from tools.memory_tool import load_on_disk_store
                store = load_on_disk_store()
                if not store.target_enabled(target):
                    label = "USER.md" if target == "user" else "MEMORY.md"
                    return _err(rid, 4094, f"Built-in {label} writes are disabled in memory config.")
                res = store.add(target, text)
                if not res.get("success"):
                    return _err(rid, 4094, res.get("error", "store error"))
                return _ok(rid, _memory_list_dict(store))
    except (FileNotFoundError, TimeoutError) as e:
        return _err(rid, 4064, str(e))


@method("fork.memory.update")
def _(rid, params: dict) -> dict:
    _profile_name, profile_dir, err = _resolve_bot_profile(rid, params)
    if err is not None:
        return err
    item_id = str(params.get("id") or "").strip()
    text = str(params.get("text") or "")
    from hermes_cli.profile_incarnation import profile_incarnation_lease
    try:
        with profile_incarnation_lease(profile_dir):
            with _profile_scope(profile_dir):
                from tools.memory_tool import load_on_disk_store
                store = load_on_disk_store()
                target_found, matched_text = _find_memory_entry(store, item_id)
                if target_found is None or matched_text is None:
                    return _err(rid, 4093, "memory item changed")
                if not store.target_enabled(target_found):
                    label = "USER.md" if target_found == "user" else "MEMORY.md"
                    return _err(rid, 4094, f"Built-in {label} writes are disabled in memory config.")
                res = store.replace(target_found, matched_text, text, matched_entry=matched_text)
                if res.get("failure_class") == "stale_entry":
                    return _err(rid, 4093, "memory item changed")
                if not res.get("success"):
                    return _err(rid, 4094, res.get("error", "store error"))
                return _ok(rid, _memory_list_dict(store))
    except (FileNotFoundError, TimeoutError) as e:
        return _err(rid, 4064, str(e))


@method("fork.memory.remove")
def _(rid, params: dict) -> dict:
    _profile_name, profile_dir, err = _resolve_bot_profile(rid, params)
    if err is not None:
        return err
    item_id = str(params.get("id") or "").strip()
    from hermes_cli.profile_incarnation import profile_incarnation_lease
    try:
        with profile_incarnation_lease(profile_dir):
            with _profile_scope(profile_dir):
                from tools.memory_tool import load_on_disk_store
                store = load_on_disk_store()
                target_found, matched_text = _find_memory_entry(store, item_id)
                if target_found is None or matched_text is None:
                    return _err(rid, 4093, "memory item changed")
                if not store.target_enabled(target_found):
                    label = "USER.md" if target_found == "user" else "MEMORY.md"
                    return _err(rid, 4094, f"Built-in {label} writes are disabled in memory config.")
                res = store.remove(target_found, matched_text, matched_entry=matched_text)
                if res.get("failure_class") == "stale_entry":
                    return _err(rid, 4093, "memory item changed")
                if not res.get("success"):
                    return _err(rid, 4094, res.get("error", "store error"))
                return _ok(rid, _memory_list_dict(store))
    except (FileNotFoundError, TimeoutError) as e:
        return _err(rid, 4064, str(e))


def register(server) -> None:
    bind_module(globals(), server, skip=("_",))
