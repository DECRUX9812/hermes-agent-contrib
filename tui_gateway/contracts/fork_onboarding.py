"""Fork-only setup-profile lifecycle contracts (``tui_gateway/methods_fork_onboarding.py``).

Namespaced under ``fork.onboarding.*`` so they never collide with upstream's ``onboarding.*``
(state/start/skip/set_run) RPCs. State shape mirrors ``hermes_cli/setup_profile.py::read_state``
as filtered by ``_public_state`` (setup-only bookkeeping never reaches the wire).
"""

from __future__ import annotations

from .base import JsonValue, Params, Result
from .registry import method


class ForkOnboardingEmptyParams(Params):
    """Calls that take no arguments; the desktop sends ``{}``."""


class EnsureSetupProfileResult(Result):
    name: str
    path: str
    created: bool


method("fork.onboarding.ensure_setup_profile", params=ForkOnboardingEmptyParams,
       result=EnsureSetupProfileResult,
       doc="Create the setup profile under the setup lock (mirroring launch credentials), or no-op.")


class EnsureSetupSessionParams(Params):
    """``messages`` seeds the setup chat only when it is created empty; anything else is ignored."""

    messages: list[JsonValue] | None = None


class EnsureSetupSessionResult(Result):
    profile: str
    session_id: str
    empty: bool


method("fork.onboarding.ensure_setup_session", params=EnsureSetupSessionParams,
       result=EnsureSetupSessionResult,
       doc="Find the setup chat by title or create it; empty is true only before its first turn.")


class ForkOnboardingStateResult(Result):
    eligible: bool
    profile: str | None = None
    intro: str
    failed_starts: int
    completed_at: str | None = None


method("fork.onboarding.state", params=ForkOnboardingEmptyParams, result=ForkOnboardingStateResult,
       doc="Fork setup-profile state (eligible/intro/failed_starts/completed_at/profile).")
method("fork.onboarding.record_failed_start", params=ForkOnboardingEmptyParams,
       result=ForkOnboardingStateResult,
       doc="Count a failed guide start (capped); at the cap the intro latches seen.")
method("fork.onboarding.mark_seen", params=ForkOnboardingEmptyParams,
       result=ForkOnboardingStateResult,
       doc="Latch the intro as seen so it does not replay.")


class ResetSetupProfileResult(Result):
    name: str
    path: str
    reset: bool


method("fork.onboarding.reset_setup_profile", params=ForkOnboardingEmptyParams,
       result=ResetSetupProfileResult,
       doc="Clear the setup profile's sessions and reset its state; refused when none exists.")
