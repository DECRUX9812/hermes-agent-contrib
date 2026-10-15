"""Bot routine RPC contracts."""

from __future__ import annotations

from typing import Literal

from .base import Params, Result
from .registry import method


class RoutinesProfileParams(Params):
    profile: str


class ListRoutinesParams(RoutinesProfileParams):
    pass


class CreateRoutineParams(RoutinesProfileParams):
    name: str
    kind: Literal["schedule", "watch"]
    schedule: str
    prompt: str | None = None
    condition: str | None = None


class UpdateRoutineParams(RoutinesProfileParams):
    id: str
    name: str | None = None
    schedule: str | None = None
    prompt: str | None = None
    condition: str | None = None


class PauseRoutineParams(RoutinesProfileParams):
    id: str


class ResumeRoutineParams(RoutinesProfileParams):
    id: str


class RemoveRoutineParams(RoutinesProfileParams):
    id: str


class RunRoutineNowParams(RoutinesProfileParams):
    id: str


class Routine(Result):
    id: str
    name: str
    kind: Literal["schedule", "watch"]
    schedule: str
    prompt: str
    condition: str | None = None
    enabled: bool
    next_run_at: str | None = None
    last_run_at: str | None = None
    last_status: str | None = None
    deliver: str | None = None


class ListRoutinesResult(Result):
    routines: list[Routine]


class CreateRoutineResult(Result):
    routines: list[Routine]


class UpdateRoutineResult(Result):
    routines: list[Routine]


class PauseRoutineResult(Result):
    routines: list[Routine]


class ResumeRoutineResult(Result):
    routines: list[Routine]


class RemoveRoutineResult(Result):
    routines: list[Routine]


class RunRoutineNowResult(Result):
    routines: list[Routine]
    started: bool


method("fork.routines.list", params=ListRoutinesParams, result=ListRoutinesResult,
       doc="List this profile's persisted bot routines, including paused routines.")
method("fork.routines.create", params=CreateRoutineParams, result=CreateRoutineResult,
       doc="Create a recurring schedule or condition watch delivered to this bot's canonical chat.")
method("fork.routines.update", params=UpdateRoutineParams, result=UpdateRoutineResult,
       doc="Update a bot routine without replacing its cron job or run history.")
method("fork.routines.pause", params=PauseRoutineParams, result=PauseRoutineResult,
       doc="Pause a bot routine.")
method("fork.routines.resume", params=ResumeRoutineParams, result=ResumeRoutineResult,
       doc="Resume a bot routine.")
method("fork.routines.remove", params=RemoveRoutineParams, result=RemoveRoutineResult,
       doc="Remove a bot routine.")
method("fork.routines.run_now", params=RunRoutineNowParams, result=RunRoutineNowResult,
       doc="Start a bot routine manually in the background.")
