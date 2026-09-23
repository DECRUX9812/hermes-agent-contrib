"""Slash worker subprocess must spawn in the session's workspace, not the gateway
launch dir (#102268): repo-relative slash commands like /worktree resolve
_git_repo_root() against the worker cwd."""

from unittest.mock import MagicMock, patch


def _fake_popen():
    mock = MagicMock()
    mock.return_value.stdout = MagicMock()
    mock.return_value.stderr = MagicMock()
    return mock


def test_slash_worker_accepts_cwd(tmp_path):
    """_SlashWorker.__init__ passes the session workspace through to Popen."""
    from tui_gateway.server import _SlashWorker

    with patch("subprocess.Popen") as mock_popen:
        mock_popen.return_value.stdout = MagicMock()
        mock_popen.return_value.stderr = MagicMock()
        _SlashWorker("k", "m", cwd=str(tmp_path))
        assert mock_popen.call_args[1]["cwd"] == str(tmp_path)


def test_restart_slash_worker_uses_session_cwd(tmp_path):
    """_restart_slash_worker respawns the worker with cwd=_session_cwd(session):
    a session whose cwd is repo B must not run slash commands in gateway dir A."""
    import tui_gateway.server as server

    session = {
        "session_key": "k1",
        "cwd": str(tmp_path),
        "agent": MagicMock(model="m"),
        "slash_worker": MagicMock(),
    }
    server._sessions["s1"] = session
    try:
        with patch("subprocess.Popen") as mock_popen:
            mock_popen.return_value.stdout = MagicMock()
            mock_popen.return_value.stderr = MagicMock()
            server._restart_slash_worker("s1", session)
            assert mock_popen.call_args[1]["cwd"] == str(tmp_path)
    finally:
        server._sessions.pop("s1", None)
