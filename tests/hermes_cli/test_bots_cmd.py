"""``hermes bots`` — the agent's door into Bot Mode setup (bot-team-builder skill).

Contract: what the CLI creates is indistinguishable from what the Desktop creates — the
Bot Mode probe counts the profile as a bot, and a CLI-built team's lead is the listener the
group-chat gate resolves (tools/bot_team.room_lead)."""

import json
from pathlib import Path

import pytest

from hermes_cli.main import main


@pytest.fixture
def profile_env(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    (home / "config.yaml").write_text("model:\n  provider: openrouter\n  default: test/model\n", encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    return home


def _run(capsys, monkeypatch, *argv) -> dict:
    monkeypatch.setattr("sys.argv", ["hermes", "bots", *argv, "--json"])
    try:
        main()
    except SystemExit as exc:
        assert not exc.code, capsys.readouterr()
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def test_cli_bots_are_bot_mode_bots_with_a_working_model(profile_env, capsys, monkeypatch):
    _run(capsys, monkeypatch, "create", "scout", "--title", "Scout", "--role", "Researcher", "--color", "#35d49a")

    from tools.bot_mode_probe import _is_bot_managed
    scout = profile_env / "profiles" / "scout"
    assert _is_bot_managed(scout)
    # Cloned from the active profile: the bot answers on the same model from its first message.
    assert "test/model" in (scout / "config.yaml").read_text(encoding="utf-8")
    assert [b["name"] for b in _run(capsys, monkeypatch, "list")["bots"]] == ["scout"]
    # The avatar color rides the same ui_meta the Desktop overlays onto its bot meta.
    from hermes_cli.profile_ui_meta import read_profile_yaml
    assert read_profile_yaml(scout)["ui_meta"]["hermes-bots"]["color"] == "#35d49a"


def test_cli_team_lead_is_the_room_listener(profile_env, capsys, monkeypatch):
    for name in ("scout", "forge"):
        _run(capsys, monkeypatch, "create", name)
    _run(capsys, monkeypatch, "team", "create", "Crew")
    _run(capsys, monkeypatch, "team", "add", "Crew", "scout", "--lead")
    _run(capsys, monkeypatch, "team", "add", "Crew", "forge", "--reports-to", "scout")

    from tools import bot_team
    assert bot_team.room_lead(profile_env, ["scout", "forge"])["lead"] == "scout"
