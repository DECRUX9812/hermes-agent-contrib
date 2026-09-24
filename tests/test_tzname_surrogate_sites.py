"""Residual strftime('%Z') lone-surrogate sites (#102910 follow-up).

On fr-FR Windows the platform tzname can contain lone surrogates; every %Z
expansion that feeds a prompt, an alert, or CLI output must run through
``agent.message_sanitization._sanitize_surrogates`` so it degrades to U+FFFD
instead of raising UnicodeEncodeError downstream. These cover the three sites
left over after the system_prompt/account_usage/auxiliary_unavailable fix.
"""

from datetime import timezone
from types import SimpleNamespace
from unittest.mock import patch


class _SurrogateNow:
    """datetime stand-in: strftime returns a fr-FR-Windows-style tzname."""

    def __init__(self):
        self.tzinfo = timezone.utc

    def astimezone(self, *a, **kw):
        return self

    def replace(self, **kw):
        return self

    def __add__(self, other):
        return self

    def strftime(self, fmt):
        return "2026-09-23 12:00:00 Paris\udcff"


class _FakeDatetime:
    """Module-level ``datetime`` replacement for ``from datetime import datetime``."""

    @classmethod
    def now(cls, tz=None):
        return _SurrogateNow()

    @classmethod
    def fromisoformat(cls, text):
        return _SurrogateNow()


def test_goal_judge_prompt_scrubs_surrogate_tzname():
    """hermes_cli/goals.py embeds current_time (a %Z strftime) in the judge's
    user prompt — the same UnicodeEncodeError class as the system_prompt site."""
    from hermes_cli import goals

    seen = {}

    def fake_call_llm(*a, **kw):
        seen["messages"] = kw["messages"]
        reply = '{"verdict": "continue", "reason": "x"}'
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=reply))])

    with patch.object(goals, "datetime", _FakeDatetime), \
         patch("agent.auxiliary_client.call_llm", side_effect=fake_call_llm):
        goals.judge_goal("ship it", "still working")

    prompt = seen["messages"][1]["content"]
    assert "Paris" in prompt
    assert "\udcff" not in prompt
    prompt.encode("utf-8")  # must not raise UnicodeEncodeError


def test_hold_notice_scrubs_surrogate_tzname():
    """cron/quota_hold.py hold_notice interpolates a %Z strftime into the one
    failure alert delivered to messaging platforms."""
    from cron import quota_hold as qh

    with patch.object(qh, "_hermes_now", return_value=_SurrogateNow()):
        notice = qh.hold_notice({"schedule": {"kind": "cron"}}, 3600)

    assert notice
    assert "\udcff" not in notice
    notice.encode("utf-8")


def test_format_iso_timestamp_scrubs_surrogate_tzname():
    """hermes_cli/status_auth.py _format_iso_timestamp renders a %Z strftime for
    `hermes status` credential output."""
    from hermes_cli import status_auth

    with patch.object(status_auth, "datetime", _FakeDatetime):
        out = status_auth._format_iso_timestamp("2026-09-23T10:00:00Z")

    assert "Paris" in out
    assert "\udcff" not in out
    out.encode("utf-8")
