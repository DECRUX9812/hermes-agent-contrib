"""Fork bot identity and memory contracts (``tui_gateway/methods_fork_bot.py``).

Namespaced under ``fork.bot.identity.*`` and ``fork.memory.*`` for the desktop
bot context pane.
"""

from __future__ import annotations

from .base import Params, Result
from .registry import method


class ForkBotIdentityGetParams(Params):
    profile: str


class ForkBotModelPin(Result):
    provider: str
    default: str


class ForkBotIdentityGetResult(Result):
    profile: str
    display_name: str
    role: str
    instructions: str
    model: ForkBotModelPin
    revision: int


class ForkBotIdentitySetParams(Params):
    profile: str
    display_name: str | None = None
    role: str | None = None
    instructions: str | None = None
    model: str | None = None
    provider: str | None = None
    confirm_expensive_model: bool | None = None
    expected_revision: int | None = None


class ForkBotIdentityApplied(Result):
    display_name: bool | None = None
    role: bool | None = None
    instructions: bool | None = None
    model: bool | None = None


class ForkBotIdentitySetResult(Result):
    profile: str
    display_name: str
    role: str
    instructions: str
    model: ForkBotModelPin
    revision: int
    applied: ForkBotIdentityApplied
    confirm_required: bool | None = None
    confirm_message: str | None = None


method(
    "fork.bot.identity.get",
    params=ForkBotIdentityGetParams,
    result=ForkBotIdentityGetResult,
    doc="Read a bot profile's identity (display name, role, instructions, model, revision).",
)

method(
    "fork.bot.identity.set",
    params=ForkBotIdentitySetParams,
    result=ForkBotIdentitySetResult,
    doc="Update a bot profile's identity with CAS and model selection guards.",
)


class ForkMemoryListParams(Params):
    profile: str


class ForkMemoryAddParams(Params):
    profile: str
    target: str
    text: str


class ForkMemoryUpdateParams(Params):
    profile: str
    id: str
    text: str


class ForkMemoryRemoveParams(Params):
    profile: str
    id: str


class ForkMemoryEntry(Result):
    id: str
    target: str
    text: str


class ForkMemoryLimitUsage(Result):
    used: int
    limit: int


class ForkMemoryUsage(Result):
    memory: ForkMemoryLimitUsage
    user: ForkMemoryLimitUsage


class ForkMemoryEnabled(Result):
    memory: bool
    user: bool


class ForkMemoryListResult(Result):
    entries: list[ForkMemoryEntry]
    usage: ForkMemoryUsage
    enabled: ForkMemoryEnabled


method(
    "fork.memory.list",
    params=ForkMemoryListParams,
    result=ForkMemoryListResult,
    doc="List on-disk memories for a bot profile with limits and usage.",
)

method(
    "fork.memory.add",
    params=ForkMemoryAddParams,
    result=ForkMemoryListResult,
    doc="Append an on-disk memory item and return the fresh list.",
)

method(
    "fork.memory.update",
    params=ForkMemoryUpdateParams,
    result=ForkMemoryListResult,
    doc="Update an on-disk memory item by stable content id and return the fresh list.",
)

method(
    "fork.memory.remove",
    params=ForkMemoryRemoveParams,
    result=ForkMemoryListResult,
    doc="Remove an on-disk memory item by stable content id and return the fresh list.",
)

__all__ = [
    "ForkBotIdentityApplied",
    "ForkBotIdentityGetParams",
    "ForkBotIdentityGetResult",
    "ForkBotIdentitySetParams",
    "ForkBotIdentitySetResult",
    "ForkBotModelPin",
    "ForkMemoryAddParams",
    "ForkMemoryEnabled",
    "ForkMemoryEntry",
    "ForkMemoryLimitUsage",
    "ForkMemoryListParams",
    "ForkMemoryListResult",
    "ForkMemoryRemoveParams",
    "ForkMemoryUpdateParams",
    "ForkMemoryUsage",
]
