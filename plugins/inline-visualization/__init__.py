"""Inline Visualization — a `create_visualization` tool plus the frame directive.

Two tiers, mirroring how Hermes already ships inline frames:

    create_visualization(html, title)   the agent asks for a card
    transform_llm_output                the card is appended to THAT turn's reply

The renderer is not ours: the desktop already renders `::preview{file="…"}` as a
sandboxed iframe with an opaque origin (`sandbox="allow-scripts"`, deliberately no
`allow-same-origin`), the app's theme tokens injected as CSS variables, live
content-driven sizing, and `window.hermes.send` / `data-hermes-send` talk-back.
We only produce a file and the directive, so this plugin needs ZERO Desktop code
and ZERO core changes and works on a stock install.

Nothing here rewrites the agent's text: `transform_llm_output` returns ``None``
unless this turn actually created a frame, and otherwise returns the original
reply with one directive appended.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

from . import viz_frames

logger = logging.getLogger(__name__)

HOOK_NAME = "transform_llm_output"

# --- settings -----------------------------------------------------------------

_DEFAULTS: Dict[str, Any] = {
    "enabled": True,
    "max_chars": 200_000,
    "keep_frames": 40,
    "state_dir": "",
    "allow_remote_scripts": True,
}

_ctx = None
_cache: Dict[str, Any] = {"at": 0.0, "values": None}


def set_context(ctx: Any) -> None:
    global _ctx
    _ctx = ctx


def settings() -> Dict[str, Any]:
    """Defaults overlaid with this profile's config (short cache: hot path)."""
    import time

    now = time.monotonic()
    if _cache["values"] is not None and now - _cache["at"] < 3.0:
        return _cache["values"]
    values = dict(_DEFAULTS)
    if _ctx is not None:
        for key in _DEFAULTS:
            try:
                got = _ctx.get_config(key, None)
            except Exception:
                continue
            if got is not None:
                values[key] = got
    _cache["values"] = values
    _cache["at"] = now
    return values


# --- HTML validation ----------------------------------------------------------

_CDN = r"(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)"
_SRC_ATTR = re.compile(r"<\s*script[^>]*\bsrc\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)
_BLOCKED = (
    (re.compile(r"\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|EventSource\s*\(", re.I),
     "no network requests at render time — inline all data in the HTML"),
    (re.compile(r"\btop\s*\.\s*location|parent\s*\.\s*location|window\s*\.\s*top", re.I),
     "frame-busting is not allowed"),
    (re.compile(r"\bdocument\s*\.\s*cookie|localStorage|sessionStorage|indexedDB", re.I),
     "the card runs in an opaque origin — storage and cookies are unavailable"),
)


def validate_html(html: str, cfg: Dict[str, Any]) -> Optional[str]:
    """Return an error string, or ``None`` when the HTML is acceptable."""
    if not isinstance(html, str) or not html.strip():
        return "html is empty — generate the full self-contained document"
    limit = int(cfg.get("max_chars") or 200_000)
    if len(html) > limit:
        return f"html is {len(html)} chars, over the {limit} char limit — simplify the visualization"
    for pattern, reason in _BLOCKED:
        match = pattern.search(html)
        if match:
            return f"{reason} (found {match.group(0)!r})"
    if cfg.get("allow_remote_scripts", True):
        for tag in _SRC_ATTR.findall(html):
            if not re.search(_CDN, tag, re.I):
                return ("external scripts are only allowed from cdn.jsdelivr.net, "
                        "unpkg.com or cdnjs.cloudflare.com")
    return None


# --- pending frames -----------------------------------------------------------
# A tool call and the hook for the same turn run in one process. Key by session
# when the host gives us one, with a global bucket as the fallback.

_pending: Dict[str, list] = {}
_GLOBAL = ""


def _key(**kw: Any) -> str:
    for name in ("session_id", "task_id", "sid"):
        value = kw.get(name)
        if value:
            return str(value)
    return _GLOBAL


# --- the tool -----------------------------------------------------------------

SCHEMA = {
    "name": "create_visualization",
    "description": (
        "Render a rich interactive visualization INLINE in the chat thread — a chart, "
        "stats dashboard, heatmap, timeline or diagram. Pass one self-contained HTML "
        "document (inline CSS/JS, all data inlined). Use it when a visual communicates "
        "better than prose; prefer it over a long markdown table. The card renders in a "
        "sandboxed frame in the desktop app; other surfaces just see the text reply."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "html": {
                "type": "string",
                "description": "Complete self-contained HTML document for the visualization.",
            },
            "title": {
                "type": "string",
                "description": "Short label shown in the frame header.",
            },
        },
        "required": ["html"],
    },
}


def create_visualization(html: str, title: str = "", **kw: Any) -> str:
    import json

    cfg = settings()
    if not cfg.get("enabled", True):
        return json.dumps({"success": False, "error": "inline visualizations are disabled in settings"})
    problem = validate_html(html, cfg)
    if problem:
        return json.dumps({"success": False, "error": f"Invalid visualization: {problem}"})

    path = viz_frames.write_frame(html, title=title or "Visualization",
                                  key=_key(**kw), configured=str(cfg.get("state_dir") or ""))
    if path is None:
        return json.dumps({"success": False, "error": "could not write the frame to disk"})
    viz_frames.prune(int(cfg.get("keep_frames") or 40), str(cfg.get("state_dir") or ""))

    key = _key(**kw)
    _pending.setdefault(key, []).append(str(path))
    viz_frames.append({"event": "created", "file": str(path), "title": title or "",
                       "bytes": len(html), "key": key}, str(cfg.get("state_dir") or ""))

    return json.dumps({
        "success": True,
        "rendered": True,
        "file": str(path),
        "note": "The card is attached to this reply automatically — do not repeat the HTML in prose.",
    })


def check_visualization_requirements() -> tuple:
    return True, ""


# --- the hook -----------------------------------------------------------------

_DIRECTIVE = re.compile(r"::\s*preview\s*\{\s*file\s*=\s*\"([^\"]+)\"", re.I)


def on_transform_llm_output(*, response_text: str = "", session_id: str = "",
                            platform: str = "", turn_id: Any = None, **kwargs: Any) -> Optional[str]:
    """Append one directive per frame created during this turn. Untouched otherwise."""
    text = response_text or ""
    key = session_id or ""
    frames = _pending.pop(key, []) if key else []
    if not frames:
        frames = _pending.pop(_GLOBAL, [])
    if not frames:
        return None

    cfg = settings()
    if not cfg.get("enabled", True):
        return None

    already = set(_DIRECTIVE.findall(text))
    add = [f for f in frames if f not in already]
    if not add:
        return None
    lines = "".join(f'\n::preview{{file="{f}"}}' for f in add)
    return f"{text.rstrip()}\n{lines}\n"


# --- registration -------------------------------------------------------------

def register(ctx: Any) -> None:
    """PluginManager entry point."""
    set_context(ctx)
    ctx.register_tool(
        name="create_visualization",
        toolset="inline_visualization",
        schema=SCHEMA,
        handler=lambda args, **kw: create_visualization(
            html=args.get("html", ""), title=args.get("title", ""), **kw),
        check_fn=check_visualization_requirements,
        requires_env=[],
    )
    ctx.register_hook(HOOK_NAME, on_transform_llm_output)
    logger.debug("inline-visualization: registered tool + %s", HOOK_NAME)
