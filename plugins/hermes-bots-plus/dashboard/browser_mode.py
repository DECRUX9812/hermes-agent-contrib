"""Per-bot browser mode for the Hermes Browser settings page.

A bot's browser tool runs either in a provider's cloud browser (watch only)
or in a local headed browser on this machine's desktop (which the viewer can
take over). This switches one local profile between the two:

* ``local``  remembers the current provider / headed values in a sidecar,
  then sets ``browser.cloud_provider: local`` and ``browser.headed: true``.
* ``cloud``  puts back the remembered provider (``nous`` if none) and headed.

Every write first copies ``config.yaml`` to ``config.yaml.bak-hbp-<time>``,
reads through the core's refuse-unreadable guard, and writes through the
core's no-omission atomic writer. Only basenames are returned, never values
beyond the two browser keys.
"""

from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path
from typing import Any, Callable, Optional

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
SIDECAR = ".hermes-bots-plus-browser.json"
DEFAULT_CLOUD = "nous"


def _truthy(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def mode_of(cfg: dict[str, Any]) -> dict[str, Any]:
    """``local`` = local + headed (shows on the desktop), ``cloud`` = a provider, else ``other``."""
    browser = cfg.get("browser") if isinstance(cfg.get("browser"), dict) else {}
    provider = str(browser.get("cloud_provider") or "").strip()
    headed = _truthy(browser.get("headed"))
    if str(browser.get("cdp_url") or "").strip():
        mode = "other"
    elif provider.lower() == "local":
        mode = "local" if headed else "other"
    elif provider:
        mode = "cloud"
    else:
        mode = "other"
    return {"mode": mode, "provider": provider, "headed": headed}


class BrowserModes:
    """IO is injected so tests never touch a real profile."""

    def __init__(
        self,
        profile_dir: Callable[[str], Path],
        read_config: Callable[[Path], dict[str, Any]],
        write_config: Callable[[Path, dict[str, Any]], None],
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._profile_dir = profile_dir
        self._read = read_config
        self._write = write_config
        self._clock = clock

    def _config_path(self, profile: str) -> Path:
        if not isinstance(profile, str) or not NAME_RE.match(profile):
            raise ValueError("bad profile name")
        path = Path(self._profile_dir(profile)) / "config.yaml"
        if not path.is_file():
            raise LookupError("profile has no config")
        return path

    def get(self, profile: str) -> dict[str, Any]:
        cfg = self._read(self._config_path(profile))
        return {"profile": profile, **mode_of(cfg)}

    def set(self, profile: str, mode: str) -> dict[str, Any]:
        if mode not in ("local", "cloud"):
            raise ValueError("mode must be local or cloud")
        path = self._config_path(profile)
        cfg = self._read(path)
        if not isinstance(cfg, dict):
            raise ValueError("config is not a mapping")

        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(self._clock()))
        backup = path.with_name(f"config.yaml.bak-hbp-{stamp}")
        n = 1
        while backup.exists():
            backup = path.with_name(f"config.yaml.bak-hbp-{stamp}-{n}")
            n += 1
        shutil.copy2(path, backup)

        browser = cfg.get("browser")
        if not isinstance(browser, dict):
            browser = {}
            cfg["browser"] = browser
        sidecar = path.with_name(SIDECAR)

        if mode == "local":
            if mode_of(cfg)["mode"] != "local":
                previous = {"cloud_provider": browser.get("cloud_provider"), "headed": browser.get("headed")}
                sidecar.write_text(json.dumps(previous), encoding="utf-8")
            browser["cloud_provider"] = "local"
            browser["headed"] = True
        else:
            previous: dict[str, Any] = {}
            try:
                previous = json.loads(sidecar.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                previous = {}
            provider = previous.get("cloud_provider")
            if not isinstance(provider, str) or not provider.strip() or provider.strip().lower() == "local":
                provider = DEFAULT_CLOUD
            browser["cloud_provider"] = provider
            if "headed" in previous and previous["headed"] is not None:
                browser["headed"] = previous["headed"]

        self._write(path, cfg)
        return {"profile": profile, **mode_of(cfg), "backup": backup.name}


def default_modes() -> BrowserModes:
    from hermes_cli.config import atomic_config_write, require_readable_config_before_write
    from hermes_cli.profiles import get_profile_dir

    return BrowserModes(get_profile_dir, require_readable_config_before_write, atomic_config_write)


_MODES: Optional[BrowserModes] = None


def modes() -> BrowserModes:
    global _MODES
    if _MODES is None:
        _MODES = default_modes()
    return _MODES
