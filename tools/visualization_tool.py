#!/usr/bin/env python3
"""Inline visualizations for the chat thread (T3-Code-style).

``create_visualization`` lets the agent render a rich, interactive visualization
— a chart, stats dashboard, heatmap, timeline — directly inside the conversation
as a sandboxed card. The agent generates self-contained HTML/CSS/JS; the desktop
(and web) client renders it in a sandboxed ``<iframe sandbox="allow-scripts">``
with no parent access.

Security model:
- The HTML is rendered in a sandboxed iframe WITHOUT ``allow-same-origin`` —
  the viz cannot reach the parent page, cookies, or localStorage.
- No external data fetches at render time: all data must be inlined in the HTML.
- CDN scripts for chart libraries (ECharts, Chart.js) are allowed — they run
  inside the sandbox with no access to anything outside it.
"""

import json
import logging
import re
from typing import Any, Dict

logger = logging.getLogger(__name__)

from tools.registry import registry, tool_error

# Hard cap: a visualization is a card, not a web app.
MAX_HTML_CHARS = 200_000

# Block the obvious exfiltration / breakout vectors. The sandbox already neuters
# these, but failing fast gives the agent a clear, actionable error.
_BLOCKED_PATTERNS = [
    (re.compile(r"<\s*script[^>]*\bsrc\s*=\s*[\"'](?!https://cdn\.|https://unpkg\.com/|https://cdnjs\.cloudflare\.com/)", re.I),
     "external scripts are only allowed from cdn.jsdelivr.net, unpkg.com, or cdnjs.cloudflare.com"),
    (re.compile(r"fetch\s*\(|XMLHttpRequest|WebSocket\s*\(|EventSource\s*\(", re.I),
     "no network requests at render time — inline all data in the HTML"),
    (re.compile(r"top\s*\.\s*location|parent\s*\.\s*location|window\s*\.\s*top", re.I),
     "frame-busting is not allowed"),
]


def _validate_html(html: str) -> str | None:
    """Return an error string if the HTML is unacceptable, else None."""
    if not html or not html.strip():
        return "html is empty — generate the full self-contained document"
    if len(html) > MAX_HTML_CHARS:
        return f"html is {len(html)} chars, over the {MAX_HTML_CHARS} char limit — simplify the visualization"
    for pattern, reason in _BLOCKED_PATTERNS:
        if pattern.search(html):
            return reason
    return None


def _handle_create_visualization(args: Dict[str, Any], **kw) -> str:
    html = args.get("html", "")
    title = args.get("title", "") or "Visualization"

    if not isinstance(html, str):
        return tool_error("html must be a string of self-contained HTML")
    if not isinstance(title, str):
        title = "Visualization"

    problem = _validate_html(html)
    if problem:
        return tool_error(f"Invalid visualization: {problem}")

    return json.dumps({
        "success": True,
        "visualization": {
            "title": title.strip()[:120],
            "html": html,
        },
    })


CREATE_VISUALIZATION_SCHEMA = {
    "name": "create_visualization",
    "description": (
        "Render a rich interactive visualization INLINE in the chat thread — a chart, "
        "stats dashboard, heatmap, timeline, or comparison — as a sandboxed card the user "
        "sees right in the conversation.\n\n"
        "WHEN TO USE: the user asks for data shown visually, or you have tabular/numeric "
        "data (comparisons, trends over time, distributions, stats) that a chart would "
        "communicate better than prose. Prefer a visualization over a long markdown table "
        "when there are 5+ data points.\n\n"
        "CONSTRAINTS (hard):\n"
        "- `html` must be ONE self-contained HTML document (inline <style> and <script>). "
        "No external stylesheets except chart-library CDNs.\n"
        "- Use a CDN chart library: ECharts (https://cdn.jsdelivr.net/npm/echarts/dist/echarts.min.js) "
        "or Chart.js (https://cdn.jsdelivr.net/npm/chart.js). ECharts is preferred for dashboards/heatmaps.\n"
        "- ALL DATA MUST BE INLINED as JS constants. No fetch/XHR/WebSocket — the sandbox "
        "has no network for data and the call will be rejected.\n"
        "- Dark-theme friendly: use a dark background (#0f1115-ish) with light text, OR read "
        "`document.documentElement.dataset.theme` ('dark'|'light', injected by the host) and adapt. "
        "Default to dark styling — Hermes is dark-first.\n"
        "- Keep it under ~200KB. This is a card, not a web app.\n"
        "- No frame-busting, no parent/top access, no cookies/localStorage reliance.\n\n"
        "The card renders at ~640px wide; make charts responsive (ECharts: chart.resize on "
        "window resize). Include a clear title inside the card."
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
                "description": "Short title shown in the card header (e.g. 'Weekly commit activity').",
            },
        },
        "required": ["html"],
    },
}


def check_visualization_requirements() -> tuple:
    return (True, "")


registry.register(
    name="create_visualization", toolset="visualization", schema=CREATE_VISUALIZATION_SCHEMA,
    handler=_handle_create_visualization, check_fn=check_visualization_requirements, requires_env=[],
    is_async=False,
    emoji="📊",
)
