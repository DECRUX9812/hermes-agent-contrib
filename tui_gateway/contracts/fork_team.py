"""Goal-first team board contracts (``tui_gateway/methods_fork_team.py``)."""

from __future__ import annotations

from typing import Literal

from .base import Params, Result
from .bot_team import Team, TeamGoal
from .registry import method


class ForkTeamBoardParams(Params):
    team_id: str
    goal_id: str | None = None


class ForkTeamAssignee(Result):
    profile: str
    title: str
    role: str


class ForkTeamLastTool(Result):
    name: str
    status: str


class ForkTeamCard(Result):
    task_id: str
    title: str
    assignee: ForkTeamAssignee | None = None
    column: Literal["queued", "in_progress", "needs_approval", "done"]
    status: str
    started_at: int | None = None
    updated_at: int | None = None
    elapsed_s: int | None = None
    tokens: int | None = None
    cost_usd: float | None = None
    last_tool: ForkTeamLastTool | None = None
    session_id: str | None = None
    needs_you: Literal["approval", "review", "blocked", "question"] | None = None
    stoppable: bool
    takeable: bool


class ForkTeamTotals(Result):
    queued: int
    in_progress: int
    needs_approval: int
    done: int
    needs_you: int
    tokens: int | None = None
    cost_usd: float | None = None


class ForkTeamBoardResult(Result):
    goal: TeamGoal | None = None
    cards: list[ForkTeamCard]
    totals: ForkTeamTotals


method(
    "fork.team.board",
    params=ForkTeamBoardParams,
    result=ForkTeamBoardResult,
    doc="Read a goal's linked Kanban cards and descendants as a goal-first board.",
)


class ForkTeamGoalStartParams(Params):
    team_id: str
    title: str
    detail: str | None = None


class ForkTeamGoalStartResult(Result):
    goal: TeamGoal
    lead_task_id: str


method(
    "fork.team.goal.start",
    params=ForkTeamGoalStartParams,
    result=ForkTeamGoalStartResult,
    doc="Upsert a team goal and dispatch one lead card through Kanban.",
)


class ForkTeamCardParams(Params):
    task_id: str


class ForkTeamCardStopResult(Result):
    task_id: str
    stopped: bool
    status: str


method(
    "fork.team.card.stop",
    params=ForkTeamCardParams,
    result=ForkTeamCardStopResult,
    doc="Safely stop a running team card and park it as blocked.",
)


class ForkTeamCardTakeoverResult(Result):
    session_id: str | None = None
    profile: str | None = None


method(
    "fork.team.card.takeover",
    params=ForkTeamCardParams,
    result=ForkTeamCardTakeoverResult,
    doc="Stop a card, unassign it to the human, and return its latest worker stream.",
)


class ForkTeamCardResumeParams(ForkTeamCardParams):
    assignee: str | None = None


class ForkTeamCardResumeResult(Result):
    task_id: str
    status: str
    assignee: str | None = None


method(
    "fork.team.card.resume",
    params=ForkTeamCardResumeParams,
    result=ForkTeamCardResumeResult,
    doc="Hand a team card back to a profile and return it to Kanban's ready phase.",
)


class ForkTeamTemplatesListParams(Params):
    pass


class ForkTeamTemplateSeat(Result):
    role: str
    title: str
    reports_to: str | None = None
    instruction: str
    lead: bool


class ForkTeamTemplate(Result):
    template_id: str
    name: str
    description: str
    seats: list[ForkTeamTemplateSeat]


class ForkTeamTemplatesListResult(Result):
    templates: list[ForkTeamTemplate]


method(
    "fork.team.templates.list",
    params=ForkTeamTemplatesListParams,
    result=ForkTeamTemplatesListResult,
    doc="List built-in team templates.",
)


class ForkTeamTemplatesApplyParams(Params):
    request_id: str
    template_id: str
    name: str | None = None
    assign: dict[str, str] | None = None


class ForkTeamTemplatesApplyResult(Result):
    team: Team
    created: bool


method(
    "fork.team.templates.apply",
    params=ForkTeamTemplatesApplyParams,
    result=ForkTeamTemplatesApplyResult,
    doc="Idempotently create a built-in team template using a client request ID, reusing assigned profiles or creating new ones.",
)
