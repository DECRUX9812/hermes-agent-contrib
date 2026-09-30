"""Team Bots (``bots_team.*``) — org chart, goals, budgets, approvals, shared learnings, briefs
and Team Packs. Handlers: ``tui_gateway/methods_bot_team.py``; state and rules:
``tools/bot_team.py`` (install-wide store, so no profile scope on any of these)."""

from __future__ import annotations

from .base import JsonValue, Params, Result
from .common import OkResult, OpenModel
from .registry import method


class TeamBudget(OpenModel):
    monthly_usd: float | None = None
    hard_stop: bool = True
    spent_usd: float = 0.0
    period: str = ""


class TeamMember(OpenModel):
    """One seat — ``tools/bot_team.py::upsert_member``. ``profile`` is null for an open seat;
    ``credentials`` are reference names, never values."""

    slot: str
    profile: str | None = None
    role: str = ""
    title: str = ""
    reports_to: str | None = None
    lead: bool = False
    status: str = "active"
    skills: list[str] = []
    plugins: list[str] = []
    credentials: list[str] = []
    budget: TeamBudget
    joined_at: int = 0


class TeamOrgNode(TeamMember):
    reports: list["TeamOrgNode"] = []


class TeamGoal(OpenModel):
    id: str
    title: str
    detail: str = ""
    parent_id: str | None = None
    owner: str | None = None
    status: str = "open"
    task_ids: list[str] = []
    created_at: int = 0
    updated_at: int | None = None


class TeamApproval(OpenModel):
    id: str
    kind: str
    subject: str
    detail: str = ""
    payload: dict[str, JsonValue] | None = None
    requested_by: str
    status: str
    decided_by: str | None = None
    decided_at: int | None = None
    note: str = ""
    created_at: int = 0


class TeamLearning(OpenModel):
    id: str
    text: str
    by: str
    source: str = ""
    count: int = 1
    at: int = 0
    last_at: int = 0


class TeamPolicy(OpenModel):
    lead_decides: bool = False


class Team(OpenModel):
    id: str
    name: str
    mission: str = ""
    policy: TeamPolicy
    channels: dict[str, str] = {}
    members: list[TeamMember]
    goals: list[TeamGoal]
    approvals: list[TeamApproval]
    learnings: list[TeamLearning]
    created_at: int
    updated_at: int


class TeamSummary(OpenModel):
    id: str
    name: str
    mission: str = ""
    member_count: int
    open_seats: int
    goal_count: int
    pending_approvals: int
    created_at: int
    updated_at: int


class GoalProgress(OpenModel):
    done: int
    total: int
    percent: int
    blocked: bool = False
    status: str = "open"


class TeamRollupOverall(OpenModel):
    done: int
    total: int
    percent: int


class TeamRollup(OpenModel):
    goals: dict[str, GoalProgress]
    overall: TeamRollupOverall


class TeamView(Result):
    """What every mutating call returns: the fresh doc, its org tree and the goal roll-up, so
    a client re-renders from one response."""

    team: Team
    tree: list[TeamOrgNode]
    rollup: TeamRollup


class TeamIdParams(Params):
    team_id: str


class TeamActorParams(TeamIdParams):
    actor: str | None = None


class TeamListResult(Result):
    teams: list[TeamSummary]


method("bots_team.list", params=Params, result=TeamListResult, doc="List this install's teams, newest first.")
method("bots_team.get", params=TeamIdParams, result=TeamView,
       doc="One team with its org tree and goal roll-up (Kanban task status folded into goals).")


class BotsTeamRoomLeadParams(Params):
    """Local member profiles of a group-chat room (remote members can't hold seats — the
    caller leaves them out)."""

    members: list[str] = []


class BotsTeamRoomLeadResult(Result):
    """``lead`` is the room's orchestrator profile when one team covers the room and its lead
    is seated; ``None`` — not a team room, no seated lead, or several teams disagree — means
    the room keeps fan-out listening."""

    lead: str | None = None
    lead_slot: str = ""
    lead_title: str = ""
    team_id: str | None = None
    team_name: str = ""


method("bots_team.room_lead", params=BotsTeamRoomLeadParams, result=BotsTeamRoomLeadResult,
       doc="The org-tree lead for a group chat: the single team whose filled seats cover the "
           "room's local members, lead included. The room then listens through the lead alone "
           "and teammates wake only when addressed.")


class BotsTeamCreateParams(Params):
    name: str
    mission: str | None = None
    lead_decides: bool | None = None
    channels: dict[str, str] | None = None
    actor: str | None = None


method("bots_team.create", params=BotsTeamCreateParams, result=TeamView, doc="Create a team.")


class BotsTeamUpdateParams(TeamActorParams):
    name: str | None = None
    mission: str | None = None
    lead_decides: bool | None = None
    channels: dict[str, str] | None = None


method("bots_team.update", params=BotsTeamUpdateParams, result=TeamView,
       doc="Rename, re-mission, set the approval policy or the external channel bindings.")
method("bots_team.delete", params=TeamActorParams, result=OkResult,
       doc="Delete a team (its audit trail is kept).")


class BotsTeamMemberUpsertParams(TeamActorParams):
    slot: str | None = None
    profile: str | None = None
    role: str | None = None
    title: str | None = None
    skills: list[str] | None = None
    plugins: list[str] | None = None
    credentials: list[str] | None = None
    status: str | None = None
    monthly_usd: float | None = None
    hard_stop: bool | None = None
    reports_to: str | None = None
    lead: bool | None = None


class BotsTeamMemberUpsertResult(TeamView):
    member: TeamMember


method("bots_team.member.upsert", params=BotsTeamMemberUpsertParams, result=BotsTeamMemberUpsertResult,
       doc="Add or edit a seat (slot omitted = add). Refuses reporting cycles; lead moves the lead badge.")


class BotsTeamMemberRemoveParams(TeamActorParams):
    member: str


method("bots_team.member.remove", params=BotsTeamMemberRemoveParams, result=TeamView,
       doc="Remove a seat by slot or profile; its reports re-attach to its boss, its goals become unowned.")


class BotsTeamGoalUpsertParams(TeamActorParams):
    goal_id: str | None = None
    title: str | None = None
    detail: str | None = None
    parent_id: str | None = None
    owner: str | None = None
    status: str | None = None


class BotsTeamGoalResult(TeamView):
    goal: TeamGoal


method("bots_team.goal.upsert", params=BotsTeamGoalUpsertParams, result=BotsTeamGoalResult,
       doc="Create (goal_id omitted) or edit a goal; parent_id null hangs it under the mission.")


class BotsTeamGoalLinkTaskParams(TeamActorParams):
    goal_id: str
    task_id: str
    unlink: bool | None = None


method("bots_team.goal.link_task", params=BotsTeamGoalLinkTaskParams, result=BotsTeamGoalResult,
       doc="Attach or detach a Kanban task id on a goal (the task itself is untouched).")


class BotsTeamGoalSpawnTaskParams(TeamActorParams):
    goal_id: str
    title: str
    body: str | None = None
    assignee: str | None = None


class BotsTeamGoalSpawnTaskResult(TeamView):
    task_id: str
    assignee: str


method("bots_team.goal.spawn_task", params=BotsTeamGoalSpawnTaskParams, result=BotsTeamGoalSpawnTaskResult,
       doc="Delegate work: create a Kanban card for a teammate (default: the goal's owner) whose body opens "
           "with their brief and the mission→goal chain, and link it to the goal. Idempotent per title.")


class BotsTeamApprovalRequestParams(TeamIdParams):
    kind: str
    subject: str
    requested_by: str
    detail: str | None = None
    payload: dict[str, JsonValue] | None = None


class BotsTeamApprovalRequestResult(Result):
    approval: TeamApproval


method("bots_team.approval.request", params=BotsTeamApprovalRequestParams, result=BotsTeamApprovalRequestResult,
       doc="A teammate asks the board for a hire, spend, credential grant or risky action.")


class BotsTeamApprovalDecideParams(TeamActorParams):
    approval_id: str
    approve: bool
    note: str | None = None


class BotsTeamApprovalDecideResult(TeamView):
    approval: TeamApproval


method("bots_team.approval.decide", params=BotsTeamApprovalDecideParams, result=BotsTeamApprovalDecideResult,
       doc="Board (or the lead, if the team's policy allows) decides; never the requester itself.")


class BotsTeamBudgetParams(TeamIdParams):
    member: str


class BotsTeamBudgetResult(Result):
    allowed: bool
    reason: str = ""
    remaining_usd: float | None = None
    over_budget: bool = False


method("bots_team.budget.check", params=BotsTeamBudgetParams, result=BotsTeamBudgetResult,
       doc="May this teammate take on more work now? False when paused or hard-stopped over budget.")


class BotsTeamBudgetRecordParams(BotsTeamBudgetParams):
    usd: float
    actor: str | None = None


method("bots_team.budget.record", params=BotsTeamBudgetRecordParams, result=BotsTeamBudgetResult,
       doc="Add spend to a teammate's month; returns the fresh budget verdict.")


class BotsTeamLearningAddParams(TeamIdParams):
    text: str
    by: str
    source: str | None = None


class BotsTeamLearningResult(Result):
    learning: TeamLearning


method("bots_team.learning.add", params=BotsTeamLearningAddParams, result=BotsTeamLearningResult,
       doc="Record a short team lesson; a repeat of the same lesson bumps its count instead of duplicating.")


class BotsTeamLearningRemoveParams(TeamActorParams):
    learning_id: str


method("bots_team.learning.remove", params=BotsTeamLearningRemoveParams, result=TeamView,
       doc="Delete a lesson the team no longer wants to carry.")


class BotsTeamBriefParams(BotsTeamBudgetParams):
    goal_id: str | None = None


class BotsTeamBriefResult(Result):
    brief: str


method("bots_team.brief", params=BotsTeamBriefParams, result=BotsTeamBriefResult,
       doc="The session-start context for a teammate: role, boss, mission→goal chain, team lessons.")


class TeamPackSeat(OpenModel):
    slot: str
    role: str = ""
    title: str = ""
    reports_to_slot: str | None = None
    lead: bool = False
    skills: list[str] = []
    plugins: list[str] = []
    credentials: list[str] = []
    monthly_usd: float | None = None
    hard_stop: bool = True


class TeamPack(OpenModel):
    pack_version: int
    name: str
    mission: str = ""
    policy: TeamPolicy
    seats: list[TeamPackSeat]


class BotsTeamPackExportResult(Result):
    pack: TeamPack


method("bots_team.pack.export", params=TeamIdParams, result=BotsTeamPackExportResult,
       doc="A shareable, data-only org design — no profiles, spend, credential values or learnings.")


class BotsTeamPackImportParams(Params):
    pack: TeamPack
    name: str | None = None
    actor: str | None = None


method("bots_team.pack.import", params=BotsTeamPackImportParams, result=TeamView,
       doc="Create a team from a pack (allow-listed keys only); every seat starts open.")


class TeamAuditEntry(OpenModel):
    at: int
    actor: str
    action: str
    detail: dict[str, JsonValue] = {}


class BotsTeamAuditParams(TeamIdParams):
    limit: int | None = None


class BotsTeamAuditResult(Result):
    entries: list[TeamAuditEntry]


method("bots_team.audit.list", params=BotsTeamAuditParams, result=BotsTeamAuditResult,
       doc="The team's append-only audit trail, newest first.")
