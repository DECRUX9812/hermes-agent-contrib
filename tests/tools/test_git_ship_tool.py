"""git_ship / open_pr — the agent-callable ship flow over web_git's service layer."""
import json
import shutil
import subprocess

import pytest

import tools.git_ship_tool  # noqa: F401 — registers the tools
from tools.registry import registry


GIT = shutil.which("git")
pytestmark = pytest.mark.skipif(GIT is None, reason="git is required")


def _dispatch(name: str, arguments: dict) -> dict:
    return json.loads(registry.dispatch(name, arguments, task_id="git-ship-test"))


@pytest.fixture
def repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    for args in (["init", "-b", "main"], ["config", "user.email", "t@t"], ["config", "user.name", "t"]):
        subprocess.run([GIT, *args], cwd=repo, check=True, capture_output=True)
    (repo / "seed.txt").write_text("seed\n")
    subprocess.run([GIT, "add", "-A"], cwd=repo, check=True, capture_output=True)
    subprocess.run([GIT, "commit", "-m", "seed"], cwd=repo, check=True, capture_output=True)
    return repo


@pytest.mark.platforms("posix")
def test_git_ship_commits_dirty_tree(repo):
    (repo / "feature.txt").write_text("new work\n")
    result = _dispatch("git_ship", {"path": str(repo), "message": "feat: add feature"})
    assert result["ok"] is True
    assert result["files"] >= 1
    assert result["subject"] == "feat: add feature"
    assert result["branch"] == "main"
    assert result["pushed"] is False
    # The tree is clean afterwards — a real repo proves it, not the payload.
    status = subprocess.run(
        [GIT, "status", "--porcelain"], cwd=repo, capture_output=True, text=True).stdout
    assert status == ""


@pytest.mark.platforms("posix")
def test_git_ship_new_branch_and_generated_message(repo):
    (repo / "src").mkdir()
    (repo / "src" / "code.py").write_text("x = 1\n")
    result = _dispatch("git_ship", {"path": str(repo), "branch": "work"})
    assert result["ok"] is True
    assert result["branch"] == "work"
    head = subprocess.run(
        [GIT, "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()
    assert head == "work"
    # Omitted message lands a conventional fallback, not a failure.
    assert ":" in result["subject"]

    (repo / "again.txt").write_text("x\n")
    again = _dispatch("git_ship", {"path": str(repo), "branch": "work"})
    assert again.get("ok") is not True
    assert "already exists" in again.get("error", "")


@pytest.mark.platforms("posix")
def test_git_ship_clean_tree_and_non_repo_errors(repo, tmp_path):
    clean = _dispatch("git_ship", {"path": str(repo)})
    assert "nothing to commit" in clean.get("error", "")
    outside = _dispatch("git_ship", {"path": str(tmp_path)})
    assert "not a git repository" in outside.get("error", "")


@pytest.mark.platforms("posix")
def test_git_ship_files_only_stages_selection(repo):
    (repo / "a.txt").write_text("a\n")
    (repo / "b.txt").write_text("b\n")
    result = _dispatch("git_ship", {"path": str(repo), "files": ["a.txt"], "message": "chore: only a"})
    assert result["ok"] is True
    status = subprocess.run(
        [GIT, "status", "--porcelain"], cwd=repo, capture_output=True, text=True).stdout
    assert status == "?? b.txt\n"


@pytest.mark.platforms("posix")
def test_open_pr_fails_without_ready_gh(repo, monkeypatch):
    """gh absent/missing-auth produces a clear error, not a traceback."""
    monkeypatch.setattr("shutil.which", lambda name: None if name == "gh" else shutil.which(name))
    (repo / "work.txt").write_text("w\n")
    _dispatch("git_ship", {"path": str(repo), "message": "feat: w"})
    result = _dispatch("open_pr", {"path": str(repo)})
    assert result.get("ok") is not True
    assert "gh" in result.get("error", "")
