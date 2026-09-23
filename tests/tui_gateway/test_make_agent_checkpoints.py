"""#79625: _make_agent must honor the config-owned ``checkpoints.enabled`` gate.

Desktop/serve sessions built agents with ``checkpoints_enabled`` from
``HERMES_TUI_CHECKPOINTS`` only, so ``checkpoints.enabled: true`` in a profile's
config.yaml did nothing. The env var stays as an override/bridge.
"""

import os
from unittest.mock import MagicMock, patch


def _build_with_cfg(fake_cfg, env):
    env = {k: v for k, v in env.items() if v is not None}
    fake_runtime = {
        "provider": "anthropic",
        "base_url": "https://api.anthropic.com",
        "api_key": "sk-test-key",
        "api_mode": "anthropic_messages",
        "command": None,
        "args": None,
        "credential_pool": None,
    }
    with (
        patch("tui_gateway.server._load_cfg", return_value=fake_cfg),
        patch("tui_gateway.server._get_db", return_value=MagicMock()),
        patch("tui_gateway.server._load_tool_progress_mode", return_value="compact"),
        patch("tui_gateway.server._load_reasoning_config", return_value=None),
        patch("tui_gateway.server._load_service_tier", return_value=None),
        patch("tui_gateway.server._load_enabled_toolsets", return_value=None),
        patch.dict(os.environ, env, clear=False),
        patch("hermes_cli.runtime_provider.resolve_runtime_provider", return_value=fake_runtime),
        patch("run_agent.AIAgent") as mock_agent,
    ):
        os.environ.pop("HERMES_TUI_CHECKPOINTS", None) if "HERMES_TUI_CHECKPOINTS" not in env else None
        from tui_gateway.server import _make_agent

        _make_agent("sid-1", "key-1")
        return mock_agent.call_args.kwargs["checkpoints_enabled"]


def test_make_agent_checkpoints_enabled_from_config():
    assert _build_with_cfg({"checkpoints": {"enabled": True}}, {}) is True


def test_make_agent_checkpoints_default_off():
    assert _build_with_cfg({}, {}) is False


def test_make_agent_checkpoints_env_overrides_config():
    assert _build_with_cfg(
        {"checkpoints": {"enabled": True}}, {"HERMES_TUI_CHECKPOINTS": "0"}
    ) is False
    assert _build_with_cfg({}, {"HERMES_TUI_CHECKPOINTS": "1"}) is True


def test_make_agent_checkpoints_legacy_bool_form():
    assert _build_with_cfg({"checkpoints": True}, {}) is True
