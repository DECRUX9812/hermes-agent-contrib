"""Frames on disk + a small ledger.

Frames are content, not code, so they live outside the plugin tree
(``$HERMES_HOME/visualizations/frames/``): inspectable, prunable, and they survive
plugin edits. The ledger beside them records every card and every refusal, so
"no card because the agent did not ask for one" and "no card because the tool
crashed" do not look identical.

Every function fails soft — the presentation path must never break a turn.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

_SLUG = re.compile(r"[^a-z0-9]+")


def state_dir(configured: str = "") -> Path:
    """``$HERMES_HOME/visualizations`` unless config names another directory."""
    if configured:
        return Path(os.path.expanduser(str(configured)))
    try:
        from hermes_constants import get_hermes_home

        home = Path(get_hermes_home())
    except Exception:
        home = Path(os.path.expanduser("~/.hermes"))
    return home / "visualizations"


def frames_dir(configured: str = "") -> Path:
    return state_dir(configured) / "frames"


def ledger_path(configured: str = "") -> Path:
    return state_dir(configured) / "ledger.jsonl"


def _slug(value: Any, fallback: str = "viz") -> str:
    text = _SLUG.sub("-", str(value or "").lower()).strip("-")
    return text[:40] or fallback


def write_frame(html: str, *, title: str = "Visualization", key: str = "",
                configured: str = "", stamp: Optional[str] = None) -> Optional[Path]:
    """Write one frame. Returns the path or ``None`` on any failure."""
    try:
        directory = frames_dir(configured)
        directory.mkdir(parents=True, exist_ok=True)
        stamp = stamp or time.strftime("%Y%m%d-%H%M%S")
        digest = hashlib.sha1(f"{key}{time.time()}".encode("utf-8")).hexdigest()[:6]
        name = f"viz-{stamp}-{digest}-{_slug(title)}.html"
        path = directory / name
        path.write_text(html, encoding="utf-8")
        return path
    except Exception:
        return None


def prune(keep: int = 40, configured: str = "") -> int:
    """Keep the newest ``keep`` frames. Returns how many were removed."""
    if keep <= 0:
        return 0
    try:
        files = sorted(frames_dir(configured).glob("viz-*.html"),
                       key=lambda p: p.stat().st_mtime, reverse=True)
    except Exception:
        return 0
    removed = 0
    for stale in files[max(1, int(keep)):]:
        try:
            stale.unlink()
            removed += 1
        except OSError:
            continue
    return removed


def append(record: Dict[str, Any], configured: str = "") -> Optional[str]:
    """Append one ledger line. Never raises."""
    try:
        path = ledger_path(configured)
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **record},
                          ensure_ascii=False, default=str)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        return str(path)
    except Exception:
        return None


def tail(limit: int = 20, configured: str = "") -> List[Dict[str, Any]]:
    """The last ``limit`` ledger records, oldest first. Malformed lines skipped."""
    try:
        lines = ledger_path(configured).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    out: List[Dict[str, Any]] = []
    for line in lines[-max(1, limit):]:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if isinstance(record, dict):
            out.append(record)
    return out
