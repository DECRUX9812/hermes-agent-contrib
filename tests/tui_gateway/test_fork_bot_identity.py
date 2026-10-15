"""Behaviour contracts for fork.bot.identity.* RPCs."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import hermes_yaml as yaml

import tui_gateway.server as srv
from hermes_cli.profile_ui_meta import read_profile_yaml


@pytest.fixture
def env(tmp_path, monkeypatch):
    launch = tmp_path / ".hermes"
    launch.mkdir()
    (launch / "SOUL.md").write_text("# Launch Soul\nLaunch instructions.", encoding="utf-8")
    (launch / "config.yaml").write_text(yaml.safe_dump({"model": {"provider": "nous", "default": "hermes-default"}}))

    profiles_dir = launch / "profiles"
    secondary = profiles_dir / "assistant-bot"
    secondary.mkdir(parents=True)
    (secondary / "SOUL.md").write_text("# Assistant Soul\nInitial instructions.", encoding="utf-8")
    (secondary / "config.yaml").write_text(yaml.safe_dump({"model": {"provider": "nous", "default": "hermes-3-70b"}}))
    (secondary / "profile.yaml").write_text(yaml.safe_dump({
        "ui_meta": {
            "hermes-bots": {
                "title": "Assistant Bot",
                "role": "General Assistant",
                "color": "#123456",
                "sectionId": "sec-1",
            }
        },
        "_ui_meta_revisions": {
            "hermes-bots": 1
        }
    }))

    monkeypatch.setenv("HERMES_HOME", str(launch))
    monkeypatch.setattr(srv, "_hermes_home", launch)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    from hermes_cli.model_switch import ModelSwitchResult
    monkeypatch.setattr(
        "hermes_cli.model_switch.switch_model",
        lambda *, raw_input, explicit_provider, **_kw: ModelSwitchResult(
            success=True, new_model=raw_input, target_provider=explicit_provider or "nous"))

    return launch, secondary


def test_fork_bot_identity_get(env):
    _launch, _secondary = env
    resp = srv._methods["fork.bot.identity.get"](1, {"profile": "assistant-bot"})
    assert "error" not in resp, resp.get("error")
    res = resp["result"]
    assert res["profile"] == "assistant-bot"
    assert res["display_name"] == "Assistant Bot"
    assert res["role"] == "General Assistant"
    assert res["instructions"] == "# Assistant Soul\nInitial instructions."
    assert res["model"] == {"provider": "nous", "default": "hermes-3-70b"}
    assert res["revision"] == 1


def test_fork_bot_identity_set_round_trip_and_merge(env):
    _launch, secondary = env
    resp = srv._methods["fork.bot.identity.set"](
        2,
        {
            "profile": "assistant-bot",
            "display_name": "Senior Researcher",
            "role": "Head of Research",
            "instructions": "# Research Soul\nDeep dive.",
            "model": "hermes-4-405b",
            "provider": "nous",
            "expected_revision": 1,
        },
    )
    assert "error" not in resp, resp.get("error")
    res = resp["result"]
    assert res["display_name"] == "Senior Researcher"
    assert res["role"] == "Head of Research"
    assert res["instructions"] == "# Research Soul\nDeep dive."
    assert res["model"] == {"provider": "nous", "default": "hermes-4-405b"}
    assert res["revision"] == 2
    assert res["applied"] == {
        "display_name": True,
        "role": True,
        "instructions": True,
        "model": True,
    }

    # Verify on-disk persistence
    y = read_profile_yaml(secondary)
    bots_meta = y["ui_meta"]["hermes-bots"]
    assert bots_meta["title"] == "Senior Researcher"
    assert bots_meta["role"] == "Head of Research"
    # Unrelated keys preserved
    assert bots_meta["color"] == "#123456"
    assert bots_meta["sectionId"] == "sec-1"

    assert (secondary / "SOUL.md").read_text(encoding="utf-8") == "# Research Soul\nDeep dive."
    cfg = yaml.safe_load((secondary / "config.yaml").read_text(encoding="utf-8"))
    assert cfg["model"]["default"] == "hermes-4-405b"
    assert cfg["model"]["provider"] == "nous"

    # Get reflects all changes
    get_resp = srv._methods["fork.bot.identity.get"](3, {"profile": "assistant-bot"})
    assert get_resp["result"]["display_name"] == "Senior Researcher"
    assert get_resp["result"]["role"] == "Head of Research"
    assert get_resp["result"]["instructions"] == "# Research Soul\nDeep dive."
    assert get_resp["result"]["model"] == {"provider": "nous", "default": "hermes-4-405b"}
    assert get_resp["result"]["revision"] == 2


def test_fork_bot_identity_isolation_and_environ(env):
    launch, _secondary = env
    environ_before = dict(os.environ)

    resp = srv._methods["fork.bot.identity.set"](
        4,
        {
            "profile": "assistant-bot",
            "display_name": "Isolated Bot",
            "role": "Isolation Test",
            "instructions": "New secondary soul",
            "model": "hermes-isolated",
            "provider": "nous",
        },
    )
    assert "error" not in resp

    # Launch files must be completely untouched
    assert (launch / "SOUL.md").read_text(encoding="utf-8") == "# Launch Soul\nLaunch instructions."
    cfg_launch = yaml.safe_load((launch / "config.yaml").read_text(encoding="utf-8"))
    assert cfg_launch["model"]["default"] == "hermes-default"
    assert not (launch / "profile.yaml").exists()

    # Environment untouched
    assert os.environ == environ_before


def test_fork_bot_identity_stale_expected_revision_answers_4091(env):
    _launch, secondary = env
    resp = srv._methods["fork.bot.identity.set"](
        5,
        {
            "profile": "assistant-bot",
            "display_name": "Should Fail",
            "expected_revision": 999,
        },
    )
    assert resp.get("error") is not None
    assert resp["error"]["code"] == 4091
    assert "bot identity changed" in resp["error"]["message"]

    # Nothing written
    y = read_profile_yaml(secondary)
    assert y["ui_meta"]["hermes-bots"]["title"] == "Assistant Bot"


def test_fork_bot_identity_empty_display_name_answers_4092(env):
    _launch, _secondary = env
    resp = srv._methods["fork.bot.identity.set"](
        6,
        {
            "profile": "assistant-bot",
            "display_name": "   ",
        },
    )
    assert resp.get("error") is not None
    assert resp["error"]["code"] == 4092
    assert "empty display_name" in resp["error"]["message"]


def test_fork_bot_identity_expensive_model_guard(env, monkeypatch):
    _launch, _secondary = env
    from types import SimpleNamespace
    import hermes_cli.model_selection_guards as guards

    def fake_guard(model_name, **_kwargs):
        if model_name == "expensive-model":
            return SimpleNamespace(message="EXPENSIVE: Costs $100/token", kind="cost")
        return None

    monkeypatch.setattr(guards, "combined_selection_warning", fake_guard)

    resp = srv._methods["fork.bot.identity.set"](
        7,
        {
            "profile": "assistant-bot",
            "model": "expensive-model",
            "provider": "nous",
        },
    )
    assert "error" not in resp
    res = resp["result"]
    assert res.get("confirm_required") is True
    assert "EXPENSIVE: Costs $100/token" in (res.get("confirm_message") or "")
    assert res["applied"].get("model") is not True

    # Resend with confirmation
    resp2 = srv._methods["fork.bot.identity.set"](
        8,
        {
            "profile": "assistant-bot",
            "model": "expensive-model",
            "provider": "nous",
            "confirm_expensive_model": True,
        },
    )
    assert "error" not in resp2
    assert not resp2["result"].get("confirm_required")
    assert resp2["result"]["applied"].get("model") is True
    assert resp2["result"]["model"]["default"] == "expensive-model"
