"""Contracts: ``delegation.reports`` — settled background-delegation report-back cards.

Handlers in ``tui_gateway/methods_delegation_reports.py``; the durable feed is
``tools.async_delegation.settled_delegations_for_session`` over the ``async_delegations`` table.
"""

from __future__ import annotations

from .base import Result, WireEnum
from .common import SessionParams
from .registry import method


class DelegationReportOutcome(WireEnum):
    """done = every task finished cleanly; failed = nothing completed; needs_decision =
    the mixed middle (interrupted, truncated, partly failed, stalled) — a human should look."""

    done = "done"
    needs_decision = "needs_decision"
    failed = "failed"


class DelegationReportSummarySource(WireEnum):
    """``model`` = the cached utility-model one-liner; ``heuristic`` = first substantive line of
    the result, always available when no auxiliary model is configured."""

    model = "model"
    heuristic = "heuristic"


class DelegationReport(Result):
    """One settled background delegation awaiting report-back to its origin session."""

    delegation_id: str
    state: str
    outcome: DelegationReportOutcome
    title: str
    summary: str
    summary_source: DelegationReportSummarySource
    task_count: int
    completed_count: int
    failed_count: int
    duration_seconds: float | None = None
    completed_at: float | None = None
    delivery_state: str = ""
    # Task index → the child's stored session id; powers the card's open action. Empty when the
    # runner did not record it (older rows, non-delegate_tool dispatchers).
    child_session_ids: dict[str, str] = {}
    group: str | None = None


class DelegationReportsResult(Result):
    reports: list[DelegationReport]


method(
    "delegation.reports",
    params=SessionParams,
    result=DelegationReportsResult,
    doc="Terminal delegations routed to this session, newest first — the sidebar report cards.",
)
