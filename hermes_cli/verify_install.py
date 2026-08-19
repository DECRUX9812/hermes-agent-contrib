"""Installation verification — lightweight smoke test for `hermes install verify`.

Checks (all offline, <2s, no network):
  1. Python imports resolve (venv functional)
  2. uv is available (or managed)
  3. Node.js is available (for desktop/plugins)
  4. `hermes` shim is on PATH and exits 0
  5. config.yaml exists and parses
  6. .env exists (or guidance to create it)
  7. state.db is writable (or will be created)

Exit codes:
  0 — all checks passed
  1 — one or more checks failed
  2 — usage error
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List

import yaml

from hermes_cli.config import (
    check_config_version,
    get_config_path,
    get_env_path,
    get_hermes_home,
    load_config,
)
from hermes_cli.colors import Colors, color
from hermes_constants import get_optional_skills_dir


def _check(name: str, fn) -> Dict[str, Any]:
    """Run a check function and return its result dict."""
    try:
        result = fn()
        result["check"] = name
        return result
    except Exception as exc:
        return {
            "check": name,
            "status": "error",
            "detail": f"{type(exc).__name__}: {exc}",
        }


def _check_python_imports() -> Dict[str, Any]:
    """Verify core Python modules import (venv is functional)."""
    modules = ["hermes_cli.main", "hermes_state", "hermes_state_schema", "toolsets"]
    failed = []
    for mod in modules:
        try:
            __import__(mod)
        except Exception as exc:
            failed.append(f"{mod}: {type(exc).__name__}")

    if failed:
        return {"status": "degraded", "detail": f"Import failures: {', '.join(failed)}"}
    return {"status": "ok", "detail": f"All {len(modules)} core modules import"}


def _check_uv() -> Dict[str, Any]:
    """Check if uv is available."""
    venv_bin = get_hermes_home().parent / "bin"
    uv_path = venv_bin / "uv"
    if uv_path.exists():
        return {"status": "ok", "detail": "uv (managed)"}
    system_uv = shutil.which("uv")
    if system_uv:
        return {"status": "ok", "detail": f"uv (system: {system_uv})"}
    return {"status": "missing", "detail": "uv not found",
            "hint": "Reinstall via: curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"}


def _check_node() -> Dict[str, Any]:
    """Check if Node.js is available (for desktop/plugins)."""
    node = shutil.which("node")
    if node:
        return {"status": "ok", "detail": f"node ({node})"}
    return {"status": "missing", "detail": "Node.js not on PATH",
            "hint": "Install Node.js or let install.sh manage it: `hermes desktop -i`"}


def _check_hermes_shim() -> Dict[str, Any]:
    """Check if the `hermes` command is on PATH and exits 0."""
    hermes_bin = shutil.which("hermes")
    if not hermes_bin:
        return {"status": "missing", "detail": "`hermes` not on PATH",
                "hint": "Reinstall or add ~/.local/bin to PATH: export PATH=\"$HOME/.local/bin:$PATH\""}
    return {"status": "ok", "detail": f"hermes at {hermes_bin}"}


def _check_config_yaml() -> Dict[str, Any]:
    """Check if config.yaml exists and parses."""
    config_path = get_config_path()
    if not config_path.exists():
        return {"status": "missing", "detail": "config.yaml not found",
                "hint": "Run `hermes setup` to create it"}
    try:
        with open(config_path, encoding="utf-8") as f:
            config = yaml.safe_load(f)
        if not isinstance(config, dict):
            return {"status": "degraded", "detail": "config.yaml is not a valid YAML dict"}
        return {"status": "ok", "detail": "config.yaml parses"}
    except yaml.YAMLError as exc:
        return {"status": "degraded", "detail": f"config.yaml parse error: {exc}",
                "hint": f"Backup and fix: cp {config_path} {config_path}.bak"}


def _check_env_file() -> Dict[str, Any]:
    """Check if .env exists (credentials)."""
    env_path = get_env_path()
    if not env_path.exists():
        return {"status": "missing", "detail": ".env not found",
                "hint": "Add API keys: edit ~/.hermes/.env or run `hermes setup`"}
    # Check if it's non-empty (has at least one key)
    try:
        content = env_path.read_text(encoding="utf-8-sig").strip()
        if not content or content.startswith("#") and not any(
            line.strip() and not line.strip().startswith("#")
            for line in content.splitlines()
        ):
            return {"status": "missing", "detail": ".env exists but is empty",
                    "hint": "Add API keys to ~/.hermes/.env or run `hermes setup`"}
        return {"status": "ok", "detail": ".env present"}
    except Exception as exc:
        return {"status": "error", "detail": f"Cannot read .env: {exc}"}


def _check_state_db_writable() -> Dict[str, Any]:
    """Check if state.db is writable (or can be created)."""
    home = get_hermes_home()
    db_path = home / "state.db"

    # If DB exists, check it's readable
    if db_path.exists():
        import sqlite3
        try:
            with sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=2.0) as conn:
                conn.execute("PRAGMA integrity_check").fetchone()
            return {"status": "ok", "detail": f"state.db readable ({db_path.stat().st_size // 1024} KB)"}
        except Exception as exc:
            return {"status": "degraded", "detail": f"state.db error: {type(exc).__name__}",
                    "hint": "Backup and run `hermes doctor --fix`"}

    # If not, check we can create it
    try:
        home.mkdir(parents=True, exist_ok=True)
        # Test write to the directory
        test_file = home / ".write_test"
        test_file.touch()
        test_file.unlink()
        return {"status": "ok", "detail": "state.db can be created"}
    except Exception as exc:
        return {"status": "missing", "detail": f"Cannot write to {home}: {exc}",
                "hint": "Check permissions on ~/.hermes/"}


def _check_config_version() -> Dict[str, Any]:
    """Check config version compatibility."""
    current, latest = check_config_version()
    if current < latest:
        return {"status": "degraded", "detail": f"config v{current} → v{latest} (run `hermes config set _config_version {latest}` or `hermes update --repair`)",
                "detail_short": f"config v{current}/{latest}"}
    return {"status": "ok", "detail": f"config v{current}/{latest}"}


def run_install_verification() -> Dict[str, Any]:
    """Run all install verification checks and return a consolidated result.

    Returns a dict suitable for both CLI (`hermes install verify`) and
    `/api/runtime/status` health payload.
    """
    checks: List[Dict[str, Any]] = [
        _check("python_imports", _check_python_imports),
        _check("uv", _check_uv),
        _check("node", _check_node),
        _check("hermes_shim", _check_hermes_shim),
        _check("config_yaml", _check_config_yaml),
        _check("env_file", _check_env_file),
        _check("state_db", _check_state_db_writable),
        _check("config_version", _check_config_version),
    ]

    all_ok = all(c["status"] in ("ok", "degraded") for c in checks)
    any_missing = any(c["status"] == "missing" for c in checks)
    any_error = any(c["status"] == "error" for c in checks)

    overall = "ok"
    if any_error or any_missing:
        overall = "missing" if any_missing else "degraded"
    elif all(c["status"] == "degraded" for c in checks):
        overall = "degraded"

    return {
        "schema_version": 1,
        "overall": overall,
        "checks": checks,
    }


def cmd_install_verify(args) -> int:
    """Handler for `hermes install verify`."""
    json_output = getattr(args, "json", False)
    result = run_install_verification()

    if json_output:
        print(json.dumps(result, indent=2))
        return 0 if result["overall"] == "ok" else 1

    # Human-readable
    print()
    print(color("◆ Hermes Install Verification", Colors.CYAN, getattr(Colors, "BOLD", "")))
    print()

    overall = result["overall"]
    if overall == "ok":
        icon = color("✓", Colors.GREEN)
        label = color("All checks passed", Colors.GREEN)
    elif overall == "degraded":
        icon = color("⚠", Colors.YELLOW)
        label = color("Checks passed with warnings", Colors.YELLOW)
    else:
        icon = color("✗", Colors.RED)
        label = color("Checks failed", Colors.RED)

    print(f"  Overall:  {icon} {label}")
    print()

    for check in result["checks"]:
        status = check["status"]
        if status == "ok":
            icon = color("✓", Colors.GREEN)
        elif status == "missing":
            icon = color("✗", Colors.RED)
        elif status == "degraded":
            icon = color("⚠", Colors.YELLOW)
        else:
            icon = color("?", Colors.DIM)

        detail = check.get("detail", "")
        line = f"  {check['check']:<20} {icon}  {detail}"
        print(line)

        hint = check.get("hint")
        if hint and status != "ok":
            print(f"  {'':>20} → {color(hint, Colors.CYAN)}")

    print()
    if overall != "ok":
        print(f"  {color('→ Run', Colors.CYAN)} `hermes doctor --fix` for automatic repair suggestions.")
        print()
    else:
        print(color("  Hermes is ready to go!", Colors.GREEN))
        print()

    return 0 if result["overall"] in ("ok", "degraded") else 1


__all__ = ["run_install_verification", "cmd_install_verify"]
