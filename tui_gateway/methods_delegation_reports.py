"""Settled-delegation report-back cards (``delegation.reports``).

Returns the durable terminal delegations routed to one session
(``tools.async_delegation.settled_delegations_for_session``) shaped as report cards: outcome,
task title, a one-line summary, and the delegated-session ids a card may offer to open.

The summary prefers a cached utility-model one-liner (``result_json.report_summary``); when absent,
the card ships a heuristic snippet immediately and a detached thread fills the cache for the next
read — the auxiliary model is optional end-to-end, so a missing provider never breaks the card.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List

from .method_ctx import HandlerRegistry, bind_module

logger = logging.getLogger(__name__)

_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped

_DONE = ("completed", "success")
_MAX_REPORTS = 25
_SNIPPET_MAX_CHARS = 160
_SUMMARY_MAX_CHARS = 160
_SUMMARY_MAX_TOKENS = 256
_SUMMARY_TIMEOUT = 10.0
_SUMMARY_TASK = "delegation_summary"
# A crash report's recovery payload drowns the one-liner; cap what the model ever sees.
_SUMMARY_INPUT_MAX_CHARS = 3000

_SUMMARY_PROMPT = (
    "You write the one-line summary shown on a report card for a background subagent task that "
    "just finished. Reply with ONE plain-text line (max 140 characters), no quotes, no emoji, no "
    "markdown. Lead with what happened and the outcome; say it plainly. If the task failed or was "
    "interrupted, lead with that."
)

_SUMMARY_IN_FLIGHT: set = set()
_SUMMARY_IN_FLIGHT_LOCK = threading.Lock()


def _task_entries(event: Dict[str, Any], result: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Per-task result dicts for a settled delegation: the batch ``results`` list when present
    (event first — it is what the completion formatter saw — then the durable result), else the
    single task shaped from the event's own fields."""
    for source in (event, result):
        raw = source.get("results")
        if isinstance(raw, list):
            return [r for r in raw if isinstance(r, dict)]
    return [event] if event else []


def _is_truncated(entry: Dict[str, Any]) -> bool:
    return bool(entry.get("truncated") or entry.get("exit_reason") == "max_iterations")


def _report_outcome(entries: List[Dict[str, Any]], state: str) -> tuple:
    """``(outcome, completed_count, failed_count)`` for one settled delegation.

    done = every task finished cleanly; failed = nothing completed; needs_decision = the mixed
    middle (interrupted, truncated, partially failed, or stalled/unknown) — the card states the
    user still has to look at.
    """
    total = len(entries) or 1
    completed = failed = 0
    for entry in entries:
        status = entry.get("status") or ("failed" if entry.get("error") else state or "completed")
        if status in _DONE and not _is_truncated(entry):
            completed += 1
        elif status in {"failed", "error", "timeout", "rejected"}:
            failed += 1
        # interrupted / truncated / stalled / unknown / cancelled land in neither bucket.
    if completed == total:
        return "done", completed, failed
    if completed == 0 and failed > 0:
        return "failed", completed, failed
    return "needs_decision", completed, failed


def _report_title(event: Dict[str, Any]) -> str:
    """The card's task line: the group label when the unit was grouped, else the unit's goal
    (single delegations store the raw goal; batch units store the composed one)."""
    title = str(event.get("group") or event.get("goal") or "")
    if not title:
        goals = [g for g in (event.get("goals") or []) if isinstance(g, str) and g.strip()]
        title = goals[0] if len(goals) == 1 else "; ".join(g.strip() for g in goals[:2])
    return " ".join(title.split())[:200]


def _heuristic_snippet(event: Dict[str, Any], result: Dict[str, Any], entries: List[Dict[str, Any]]) -> str:
    """First substantive line of the result — the summary call's always-available stand-in."""
    candidates: List[str] = []
    for entry in entries:
        candidates.extend(str(entry.get(key) or "") for key in ("summary", "error"))
    candidates.extend(str(source.get(key) or "")
                      for source, key in ((event, "summary"), (event, "error"),
                                          (result, "error")))
    for text in candidates:
        line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
        if line:
            return line[:_SNIPPET_MAX_CHARS]
    return ""


def _summary_enabled() -> bool:
    """``auxiliary.delegation_summary.enabled`` (default true); mirrors title_generation's gate."""
    try:
        from hermes_cli.config import load_config_readonly
        from utils import is_truthy_value
        cfg = (load_config_readonly() or {}).get("auxiliary") or {}
        return is_truthy_value((cfg.get("delegation_summary") or {}).get("enabled"), default=True)
    except Exception:
        logger.debug("delegation_summary enabled check failed; proceeding", exc_info=True)
        return True


def _generate_summary(row: Dict[str, Any]) -> str:
    """One utility-model call → one line, or "" on any failure (missing provider included)."""
    event, result = row.get("event") or {}, row.get("result") or {}
    entries = _task_entries(event, result)
    if len(entries) > 1:
        status_line = "Outcomes: " + ", ".join(
            f"task {e.get('task_index', '?')}={e.get('status', '?')}" for e in entries[:8])
    else:
        status_line = f"Status: {(entries[0] if entries else {}).get('status') or row.get('state') or ''}"
    lines = [f"Task: {_report_title(event)}", status_line]
    if len(entries) > 1:
        lines += [f"Task {e.get('task_index', '?')} ({e.get('status', '?')}): "
                  f"{str(e.get('summary') or e.get('error') or '')[:400]}" for e in entries[:4]]
    elif snippet := _heuristic_snippet(event, result, entries):
        lines.append(f"Result:\n{snippet}")
    body = "\n".join(lines)[:_SUMMARY_INPUT_MAX_CHARS]
    if not body.strip():
        return ""
    try:
        from agent.auxiliary_client import call_llm
        response = call_llm(
            task=_SUMMARY_TASK,
            messages=[{"role": "system", "content": _SUMMARY_PROMPT}, {"role": "user", "content": body}],
            # temperature=None: omitted from the wire so default-only reasoning models accept the
            # request (same constraint as title_generation, #72351).
            max_tokens=_SUMMARY_MAX_TOKENS, temperature=None,
            timeout=_SUMMARY_TIMEOUT, reasoning_config={"enabled": False},
        )
        text = str(response.choices[0].message.content or "")
        line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
        return line[:_SUMMARY_MAX_CHARS]
    except Exception as exc:  # noqa: BLE001 — the heuristic snippet already covers the card
        logger.debug("delegation report summary generation failed for %s: %s",
                     row.get("delegation_id"), exc)
        return ""


def _kick_summary_generation(rows: List[Dict[str, Any]]) -> None:
    """Fill ``result_json.report_summary`` for rows lacking it, off the request path. One worker
    per call drains the pending ids; a second call while it runs requeues nothing it already holds."""
    if not _summary_enabled():
        return
    todo = [row["delegation_id"] for row in rows
            if row.get("delegation_id") and not (row.get("result") or {}).get("report_summary")]
    if not todo:
        return
    with _SUMMARY_IN_FLIGHT_LOCK:
        pending = [delegation_id for delegation_id in todo if delegation_id not in _SUMMARY_IN_FLIGHT]
        _SUMMARY_IN_FLIGHT.update(pending)
    if not pending:
        return
    by_id = {row["delegation_id"]: row for row in rows}

    def _run() -> None:
        try:
            from tools.async_delegation import record_delegation_report_summary
            for delegation_id in pending:
                row = by_id.get(delegation_id)
                if row is None:
                    continue
                if summary := _generate_summary(row):
                    record_delegation_report_summary(delegation_id, summary)
        finally:
            with _SUMMARY_IN_FLIGHT_LOCK:
                _SUMMARY_IN_FLIGHT.difference_update(pending)

    from agent.memory_provider import spawn_context_thread
    spawn_context_thread(_run, name="delegation-report-summary").start()


def _report_for_row(row: Dict[str, Any]) -> Dict[str, Any]:
    event, result = row.get("event") or {}, row.get("result") or {}
    entries = _task_entries(event, result)
    outcome, completed_count, failed_count = _report_outcome(entries, str(row.get("state") or ""))
    cached = result.get("report_summary")
    duration = event.get("total_duration_seconds") or event.get("duration_seconds")
    if duration is None:
        duration = result.get("total_duration_seconds")
    child_ids = result.get("child_session_ids")
    return {
        "delegation_id": row["delegation_id"],
        "state": str(row.get("state") or ""),
        "outcome": outcome,
        "title": _report_title(event),
        "summary": str(cached or _heuristic_snippet(event, result, entries)),
        "summary_source": "model" if isinstance(cached, str) and cached else "heuristic",
        "task_count": len(entries) or 1,
        "completed_count": completed_count,
        "failed_count": failed_count,
        "duration_seconds": duration if isinstance(duration, (int, float)) else None,
        "completed_at": row.get("completed_at"),
        "delivery_state": str(row.get("delivery_state") or ""),
        "child_session_ids": {str(k): str(v) for k, v in child_ids.items() if v}
        if isinstance(child_ids, dict) else {},
        "group": str(event["group"]) if event.get("group") is not None else None,
    }


@method("delegation.reports")
@_profile_scoped
def _(rid, params):
    session_id = _str_param(params, "session_id")
    if not session_id:
        return _err(rid, 4000, "session_id required")
    try:
        from tools.async_delegation import settled_delegations_for_session
        rows = settled_delegations_for_session(session_id, limit=_MAX_REPORTS)
    except Exception as exc:  # noqa: BLE001 — a broken ledger yields an empty feed, not a 500
        logger.debug("delegation.reports query failed for %s: %s", session_id, exc)
        return _ok(rid, {"reports": []})
    try:
        _kick_summary_generation(rows)
    except Exception:  # noqa: BLE001 — summaries are decorative; never fail the read
        logger.debug("delegation report summary dispatch failed", exc_info=True)
    return _ok(rid, {"reports": [_report_for_row(row) for row in rows]})


def register(server):
    bind_module(globals(), server, skip=("_",))
