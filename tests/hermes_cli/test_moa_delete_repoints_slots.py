"""#82613: deleting a MoA preset must repoint slots that still name it.

``hermes moa delete`` cleared ``moa.default_preset``/``active_preset`` but left
``model.default`` (and ``auxiliary.<task>.model``) naming the deleted preset.
The next session start resolved that name through ``resolve_moa_preset`` and
crashed with ``MoAPresetNotFoundError``.
"""

from __future__ import annotations

from types import SimpleNamespace

import yaml


def _presets() -> dict:
    def preset():
        return {
            "reference_models": [{"provider": "openrouter", "model": "deepseek/deepseek-v4-pro"}],
            "aggregator": {"provider": "openrouter", "model": "anthropic/claude-opus-4.8"},
            "enabled": True,
        }

    return {"mypreset": preset(), "other": preset()}


def _seed_config(home, extra: dict | None = None) -> None:
    from hermes_cli.config import get_config_path

    cfg = {
        "model": {"default": "mypreset", "provider": "moa"},
        "auxiliary": {"title": {"provider": "moa", "model": "mypreset"}},
        "moa": {"default_preset": "mypreset", "active_preset": "mypreset", "presets": _presets()},
    }
    if extra:
        cfg.update(extra)
    get_config_path().write_text(yaml.safe_dump(cfg), encoding="utf-8")


def test_moa_delete_repoints_dangling_slots(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))

    from hermes_cli.config import get_config_path, load_config
    from hermes_cli.moa_cmd import cmd_moa
    from hermes_cli.moa_config import resolve_moa_preset

    _seed_config(home)
    cmd_moa(SimpleNamespace(moa_command="delete", name="mypreset"))

    cfg = load_config()
    assert cfg["model"]["default"] != "mypreset", (
        "model.default still names the deleted preset; session start raises MoAPresetNotFoundError"
    )
    assert cfg["auxiliary"]["title"]["model"] != "mypreset", (
        "auxiliary.title.model still names the deleted preset"
    )
    # The resolve path used at session start must not raise.
    resolve_moa_preset(cfg.get("moa"), cfg["model"]["default"])
    resolve_moa_preset(cfg.get("moa"), cfg["auxiliary"]["title"]["model"])


def test_moa_put_repoints_dangling_slots(tmp_path, monkeypatch):
    """The web PUT path replaces the whole presets dict — the same repoint applies."""
    from unittest.mock import patch

    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))

    from hermes_cli.config import get_config_path, load_config
    from hermes_cli.moa_config import resolve_moa_preset
    from hermes_cli.web_models import MoaConfigPayload, MoaModelSlot, MoaPresetPayload
    from hermes_cli.web_routers.models import set_moa_models

    _seed_config(home)

    payload = MoaConfigPayload(
        default_preset="other",
        active_preset="",
        presets={
            "other": MoaPresetPayload(
                reference_models=[MoaModelSlot(provider="openrouter", model="deepseek/deepseek-v4-pro")],
                aggregator=MoaModelSlot(provider="openrouter", model="anthropic/claude-opus-4.8"),
                enabled=True,
            ),
        },
    )
    with patch("hermes_cli.web_server_profiles._profile_scope"):
        set_moa_models(payload)

    cfg = load_config()
    assert cfg["model"]["default"] != "mypreset"
    assert cfg["auxiliary"]["title"]["model"] != "mypreset"
    resolve_moa_preset(cfg.get("moa"), cfg["model"]["default"])
