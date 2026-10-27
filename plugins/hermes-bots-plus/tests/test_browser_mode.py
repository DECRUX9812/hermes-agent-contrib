import importlib.util
import json
from pathlib import Path

import pytest
import yaml

HERE = Path(__file__).resolve().parents[1] / "dashboard" / "browser_mode.py"
spec = importlib.util.spec_from_file_location("hbp_browser_mode_test", HERE)
bm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bm)


def _modes(root: Path):
    def read(path):
        return yaml.safe_load(path.read_text()) or {}

    def write(path, data):
        path.write_text(yaml.safe_dump(data))

    return bm.BrowserModes(lambda name: root / name, read, write, clock=lambda: 1_700_000_000)


def _profile(root: Path, name: str, cfg: dict) -> Path:
    d = root / name
    d.mkdir()
    (d / "config.yaml").write_text(yaml.safe_dump(cfg))
    return d


def test_reads_modes(tmp_path):
    _profile(tmp_path, "a", {"browser": {"cloud_provider": "nous"}})
    _profile(tmp_path, "b", {"browser": {"cloud_provider": "local", "headed": True}})
    _profile(tmp_path, "c", {"model": "x"})
    m = _modes(tmp_path)
    assert m.get("a")["mode"] == "cloud"
    assert m.get("b")["mode"] == "local"
    assert m.get("c")["mode"] == "other"


def test_local_then_cloud_round_trip_keeps_everything_else(tmp_path):
    d = _profile(tmp_path, "a", {"model": {"default": "m"}, "browser": {"cloud_provider": "nous", "headed": False, "timeout": 9}})
    m = _modes(tmp_path)
    out = m.set("a", "local")
    assert out["mode"] == "local" and out["backup"].startswith("config.yaml.bak-hbp-")
    assert "/" not in out["backup"]
    cfg = yaml.safe_load((d / "config.yaml").read_text())
    assert cfg["browser"] == {"cloud_provider": "local", "headed": True, "timeout": 9}
    assert cfg["model"] == {"default": "m"}
    assert json.loads((d / bm.SIDECAR).read_text()) == {"cloud_provider": "nous", "headed": False}

    back = m.set("a", "cloud")
    assert back["mode"] == "cloud"
    cfg = yaml.safe_load((d / "config.yaml").read_text())
    assert cfg["browser"] == {"cloud_provider": "nous", "headed": False, "timeout": 9}
    backups = sorted(p.name for p in d.glob("config.yaml.bak-hbp-*"))
    assert len(backups) == 2
    first = yaml.safe_load((d / backups[0]).read_text())
    assert first["browser"]["cloud_provider"] == "nous"


def test_cloud_without_sidecar_defaults_to_nous(tmp_path):
    d = _profile(tmp_path, "a", {"browser": {"cloud_provider": "local", "headed": True}})
    _modes(tmp_path).set("a", "cloud")
    assert yaml.safe_load((d / "config.yaml").read_text())["browser"]["cloud_provider"] == "nous"


def test_switching_local_twice_keeps_the_original_cloud(tmp_path):
    d = _profile(tmp_path, "a", {"browser": {"cloud_provider": "browserbase"}})
    m = _modes(tmp_path)
    m.set("a", "local")
    m.set("a", "local")
    m.set("a", "cloud")
    assert yaml.safe_load((d / "config.yaml").read_text())["browser"]["cloud_provider"] == "browserbase"


@pytest.mark.parametrize("name", ["../x", "", "a/b", ".hidden", "x" * 70])
def test_rejects_bad_names(tmp_path, name):
    with pytest.raises(ValueError):
        _modes(tmp_path).get(name)


def test_rejects_bad_mode_and_missing_profile(tmp_path):
    _profile(tmp_path, "a", {})
    m = _modes(tmp_path)
    with pytest.raises(ValueError):
        m.set("a", "remote")
    with pytest.raises(LookupError):
        m.get("nope")
    assert not list((tmp_path / "a").glob("config.yaml.bak-hbp-*"))
