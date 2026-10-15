"""Durable approval journal contracts (``tui_gateway/methods_fork_approvals.py``).

Rows mirror the profile's ``fork_approvals`` table. ``status`` moves once from ``pending`` to a
terminal state; ``decide`` on a request that is no longer pending returns the row unchanged.
"""

from __future__ import annotations

from .base import Params, Payload, Result, WireEnum
from .registry import method
from .server_requests import ApprovalChoice


class ForkApprovalStatus(WireEnum):
    pending = "pending"
    allowed = "allowed"
    denied = "denied"
    expired = "expired"
    withdrawn = "withdrawn"


class ForkApproval(Payload):
    request_id: str
    tool_call_id: str
    tool_name: str
    command: str
    description: str
    created_at: float
    status: ForkApprovalStatus
    decided_at: float | None = None
    choice: ApprovalChoice | None = None
    ran_at: float | None = None
    reason: str | None = None


class ForkApprovalsListParams(Params):
    session_id: str
    profile: str | None = None


class ForkApprovalsListResult(Result):
    approvals: list[ForkApproval]


method("fork.approvals.list", params=ForkApprovalsListParams, result=ForkApprovalsListResult,
       doc="Journal rows for one stored session, oldest to newest (at most 50).")


class ForkApprovalsDecideParams(Params):
    session_id: str
    request_id: str
    choice: ApprovalChoice
    profile: str | None = None


class ForkApprovalsDecideResult(Result):
    approval: ForkApproval
    resolved: bool


method("fork.approvals.decide", params=ForkApprovalsDecideParams, result=ForkApprovalsDecideResult,
       doc="Answer one pending approval. Idempotent: a request already decided resolves nothing "
           "and returns its recorded row.")
