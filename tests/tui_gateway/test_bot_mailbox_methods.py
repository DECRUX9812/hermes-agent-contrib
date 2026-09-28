"""Tests: bots_mailbox.* JSON-RPC handlers (tui_gateway/methods_bot_mailbox.py).

Regression: register() installed the handlers without binding the module's own
helpers onto the server namespace, so a rebound handler resolving `_local_roster`
hit a bare NameError at call time — every send/update failed. These assert the
handlers reach their real logic (a domain error, not a lookup crash).
"""

from __future__ import annotations

import pytest

import tui_gateway.server as srv


@pytest.fixture
def home(tmp_path, monkeypatch):
    h = tmp_path / ".hermes"
    (h / "profiles" / "ops").mkdir(parents=True)
    (h / "profiles" / "ops" / "config.yaml").write_text("{}\n")
    monkeypatch.setenv("HERMES_HOME", str(h))
    return h


def test_send_unknown_bot_is_domain_error_not_name_error(home):
    out = srv._methods["bots_mailbox.send"](
        1, {"to": "no-such-bot", "title": "t", "body": "b"}
    )
    assert "error" in out, out
    assert "not defined" not in out["error"]["message"]
    assert out["error"]["code"] == 4101


def test_list_returns_notes_shape(home):
    out = srv._methods["bots_mailbox.list"](1, {})
    assert "error" not in out, out
    assert out["result"]["notes"] == []


def test_send_requires_to_and_title(home):
    out = srv._methods["bots_mailbox.send"](1, {"to": "", "title": ""})
    assert out["error"]["code"] == 4100
