"""Bot computer timeline RPC contract."""

from __future__ import annotations

from typing import Literal

from .base import Params, Result
from .registry import method


class ComputerTimelineParams(Params):
    profile: str
    session_id: str
    limit: int | None = None


class ComputerTimelineDetail(Result):
    command: str | None = None
    output_tail: str | None = None
    path: str | None = None
    diff: str | None = None
    url: str | None = None
    page_title: str | None = None
    screenshot_path: str | None = None


class ComputerTimelineStep(Result):
    id: str
    index: int
    tool: str
    kind: Literal["terminal", "file", "browser", "search", "other"]
    title: str
    status: Literal["done", "error", "running"]
    at: str | None = None
    duration_s: float | None = None
    detail: ComputerTimelineDetail


class ComputerTodo(Result):
    id: str
    content: str
    status: str


class ComputerTimelineResult(Result):
    session_id: str
    steps: list[ComputerTimelineStep]
    todos: list[ComputerTodo]


method("fork.computer.timeline", params=ComputerTimelineParams, result=ComputerTimelineResult,
       doc="Read persisted tool activity and the latest todo checklist from a profile session.")
