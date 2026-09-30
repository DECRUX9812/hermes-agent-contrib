"""``profile.yaml`` ``ui_meta`` writes — shared by the gateway's ``profiles.configure`` and the
``hermes bots`` CLI, so every writer bumps the same per-key revisions the Desktop's
compare-and-swap reads (a CLI-created bot then looks like any other bot to the roster)."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Optional

UI_META_MAX_BYTES = 65536

# In-process writers serialize here; the write itself is atomic, so a cross-process race loses
# at most one side's keys and the revision bump tells the Desktop to re-read.
_lock = threading.Lock()


def read_profile_yaml(profile_dir: Path) -> dict:
    """profile.yaml as a mapping; ``{}`` when missing, unreadable, unparseable, or not a mapping."""
    try:
        import hermes_yaml as yaml
        path = Path(profile_dir) / "profile.yaml"
        loaded = (yaml.safe_load(path.read_text(encoding="utf-8-sig")) or {}) if path.is_file() else {}
    except Exception:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def clean_revisions(raw: dict) -> dict:
    """Normalise a ``_ui_meta_revisions`` map: str keys, non-bool ints clamped at 0."""
    return {str(k): max(0, int(v)) for k, v in raw.items() if isinstance(v, int) and not isinstance(v, bool)}


def merge_ui_meta(profile_dir: Path, incoming: dict, expected: Optional[dict] = None) -> dict:
    """Merge ``incoming`` key-wise into ``ui_meta`` (``None`` deletes a key) and bump each key's
    revision. ``expected`` is per-key CAS: any mismatch rejects the whole write. Returns
    ``{"applied": bool, "revisions": {...}, "conflicts"?: {...}}``; raises ``ValueError`` on bad
    input. Revisions survive deletion so a stale client cannot recreate a removed key."""
    if not isinstance(incoming, dict):
        raise ValueError("ui_meta must be an object")
    if len(json.dumps(incoming, default=str)) > UI_META_MAX_BYTES:
        return {"applied": False, "revisions": {}}
    if expected is not None and not isinstance(expected, dict):
        raise ValueError("ui_meta_expected_revisions must be an object")
    with _lock:
        existing = read_profile_yaml(profile_dir)
        raw_revisions = existing.get("_ui_meta_revisions")
        revisions = clean_revisions(raw_revisions if isinstance(raw_revisions, dict) else {})
        conflicts: dict[str, Any] = {}
        for key in incoming if isinstance(expected, dict) else ():
            wanted, actual = expected.get(key), revisions.get(key, 0)
            if not isinstance(wanted, int) or isinstance(wanted, bool) or wanted < 0 or wanted != actual:
                conflicts[key] = {"expected": wanted, "actual": actual}
        if conflicts:
            return {"applied": False, "conflicts": conflicts,
                    "revisions": {key: revisions.get(key, 0) for key in incoming}}
        current = existing.get("ui_meta")
        current = current if isinstance(current, dict) else {}
        for key, value in incoming.items():
            if value is None:
                current.pop(key, None)
            else:
                current[key] = value
            revisions[key] = revisions.get(key, 0) + 1
        if current:
            existing["ui_meta"] = current
        else:
            existing.pop("ui_meta", None)
        existing["_ui_meta_revisions"] = revisions
        from utils import atomic_yaml_write
        atomic_yaml_write(Path(profile_dir) / "profile.yaml", existing, sort_keys=False)
    return {"applied": True, "revisions": {key: revisions[key] for key in incoming}}
