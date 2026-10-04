#!/usr/bin/env python3
"""Verify the page open in the desktop preview pane — console errors in, pass/fail out.

The "verify" step of a build-fix-verify loop: the renderer resolves the preview the user is
looking at, reads its console log (``preview-console-store.ts`` — level >= 3 is an error), and
answers a JSON pass/fail card the user also sees in the status stack. Round-trips through the
gateway's blocking-prompt bridge (``preview.verify``); this module is schema + a thin dispatcher
over the platform-injected callback. ``desktop_ui`` toolset: desktop-sourced sessions only.
"""

from typing import Callable, Optional

from tools.desktop_ui import passthrough_json
from tools.registry import registry, tool_error

DEFAULT_SETTLE_MS = 1200
MAX_SETTLE_MS = 10_000


def verify_preview_tool(settle_ms: Optional[int] = None, callback: Optional[Callable] = None) -> str:
    """Ask the renderer for the preview's console pass/fail and return its verdict."""
    if callback is None:
        return tool_error("verify_preview is only available in the Hermes desktop app.")
    try:
        settle = DEFAULT_SETTLE_MS if settle_ms is None else max(0, min(int(settle_ms), MAX_SETTLE_MS))
    except (TypeError, ValueError):
        return tool_error("settle_ms must be an integer.")
    try:
        raw = callback({"settle_ms": settle})
    except Exception as exc:
        return tool_error(f"Failed to verify the preview: {exc}")
    if not raw:
        return tool_error("The check timed out, or no GUI window answered. Open a page with open_preview first.")
    return passthrough_json(raw)


VERIFY_PREVIEW_SCHEMA = {
    "name": "verify_preview",
    "description": (
        "Check the page open in the desktop preview pane (the one `desktop_preview` "
        "opens) for console errors and answer pass/fail with the error list. Run it "
        "AFTER opening or reloading the page — it waits `settle_ms` for pending logs "
        "first. Failing: fix the reported errors, reload (drive_preview "
        "action='reload'), then verify again. The user sees the verdict as a card."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "settle_ms": {
                "type": "integer",
                "description": "Ms to let the page finish logging before reading "
                "the console (default 1200, max 10000).",
            },
        },
    },
}


registry.register(
    name="verify_preview",
    toolset="desktop_ui",
    schema=VERIFY_PREVIEW_SCHEMA,
    handler=lambda args, **kw: verify_preview_tool(settle_ms=args.get("settle_ms"), callback=kw.get("callback")),
    emoji="✅")
