"""Tests for cua-driver agent cursor motion configuration."""

from unittest.mock import MagicMock, patch

from tools.computer_use import cua_backend


def test_cursor_motion_style_from_config():
    with patch("hermes_cli.config.load_config", return_value={"computer_use": {"cursor_style": "magnetic"}}):
        assert cua_backend._cua_cursor_motion_style() == "magnetic"

    with patch("hermes_cli.config.load_config", return_value={"computer_use": {"cursor_motion": {"style": "spring_settle"}}}):
        assert cua_backend._cua_cursor_motion_style() == "spring_settle"

    with patch("hermes_cli.config.load_config", return_value={"computer_use": {}}):
        assert cua_backend._cua_cursor_motion_style() is None


def test_start_session_passes_cursor_motion():
    backend = cua_backend.CuaDriverBackend()
    backend._session = MagicMock()
    backend._session._started = True

    with patch("hermes_cli.config.load_config", return_value={"computer_use": {"cursor_style": "magnetic"}}), \
         patch.object(backend, "_embedded_daemon", None), \
         patch("tools.computer_use.cua_backend.sandbox_mcp_invocation", return_value=None), \
         patch("tools.computer_use.cua_backend.cua_driver_runtime_contract_status", return_value={"ready": True}), \
         patch("tools.computer_use.cua_backend._cua_no_overlay", return_value=True), \
         patch("pm.ensure"), \
         patch("pm.ensure_import"):
        backend.start()

    calls = backend._session.call_tool.call_args_list
    start_calls = [c for c in calls if c[0][0] == "start_session"]
    assert len(start_calls) == 1
    payload = start_calls[0][0][1]
    assert payload["session"] == backend._session_id
    assert payload["cursor_motion"] == {"style": "magnetic"}


def test_set_agent_cursor_motion_action():
    backend = cua_backend.CuaDriverBackend()
    backend._session = MagicMock()
    with patch.object(backend, "_action") as mock_action:
        backend.set_agent_cursor_motion("comet_swoop", timing="fitts")
        mock_action.assert_called_once_with(
            "set_agent_cursor_motion",
            {"style": "comet_swoop", "timing": "fitts"},
        )
