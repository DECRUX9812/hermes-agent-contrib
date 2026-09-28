"""Agent-init failures are classified by the auth error's own code, never by its text: a missing
provider is a setup problem with one fix, everything else stays a retryable runtime failure."""
from __future__ import annotations

from agent.error_surface import agent_init_error_surface
from hermes_cli.auth import AuthError
from tui_gateway.user_messages import agent_init_failed_message


def test_missing_provider_is_a_non_retryable_auth_surface_with_in_app_copy():
    exc = AuthError("No inference provider configured. Run `hermes model` …", code="no_provider_configured")
    surface = agent_init_error_surface(exc)
    assert surface == {"layer": "auth", "code": "no_provider_configured", "retryable": False}
    msg = agent_init_failed_message(exc)
    assert "hermes setup" not in msg and "terminal" not in msg  # the fix is in the app


def test_other_init_failures_stay_retryable_runtime_errors():
    for exc in (RuntimeError("boom"), AuthError("expired", code="something_else")):
        assert agent_init_error_surface(exc) == {"layer": "runtime", "code": "agent_init_failed", "retryable": True}
        assert "hermes setup" in agent_init_failed_message(exc)


def test_text_that_merely_mentions_the_code_does_not_classify():
    assert agent_init_error_surface(RuntimeError("no_provider_configured"))["code"] == "agent_init_failed"
