"""Tests for install verification checks (part of `hermes health` pipeline).

These tests verify the deterministic, offline checks that confirm a Hermes
installation is functional — venv/uv/node/shim/.env/config — without
triggering network calls or actual setup flows.

Pattern adapted from tests/hermes_cli/test_doctor_command_install.py.
"""

from __future__ import annotations

import sys
import os
from pathlib import Path

import pytest

# We test the health module's install verification functions directly.
# The _probe_runtime_version and _probe_database functions in health.py
# exercise the install verification path.


class TestInstallVerification:
    """Verify that health checks detect a broken vs. functional install."""

    def _make_sandbox_home(self, tmp_path: Path) -> Path:
        """Create a minimal HERMES_HOME sandbox."""
        home = tmp_path / ".hermes"
        home.mkdir(parents=True, exist_ok=True)
        (home / "config.yaml").write_text("memory: {}\n", encoding="utf-8")
        return home

    def test_runtime_probe_detects_version(self, monkeypatch, tmp_path):
        """_probe_runtime_version must return the installed Hermes version."""
        from hermes_cli.health import _probe_runtime_version

        result = _probe_runtime_version()
        assert result["status"] == "ok"
        assert "version" in result
        # Version must be a non-empty string (not the default placeholder)
        assert isinstance(result["version"], str)
        assert len(result["version"]) > 0

    def test_runtime_probe_includes_config_version(self, monkeypatch, tmp_path):
        """_probe_runtime_version must report current vs latest config version."""
        from hermes_cli.health import _probe_runtime_version

        home = self._make_sandbox_home(tmp_path)
        monkeypatch.setattr("hermes_cli.health.get_hermes_home", lambda: home)

        result = _probe_runtime_version()
        cv = result.get("config_version", {})
        assert "current" in cv
        assert "latest" in cv
        assert isinstance(cv["current"], int)
        assert isinstance(cv["latest"], int)

    def test_database_probe_handles_missing_db(self, monkeypatch, tmp_path):
        """_probe_database must succeed even when state.db doesn't exist yet."""
        from hermes_cli.health import _probe_database

        home = tmp_path / ".hermes"
        home.mkdir(parents=True)
        # No state.db — first run
        monkeypatch.setattr("hermes_cli.health.get_hermes_home", lambda: home)

        result = _probe_database()
        # Must not error — should report OK with "not initialized"
        assert result["status"] in ("ok", "degraded")
        assert "schema_version" in result
        assert result["db_size_bytes"] == 0

    def test_database_probe_reads_existing_db(self, monkeypatch, tmp_path):
        """_probe_database must read an existing state.db."""
        from hermes_cli.health import _probe_database
        import sqlite3

        home = tmp_path / ".hermes"
        home.mkdir(parents=True)
        db_path = home / "state.db"
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT, value TEXT)")
        conn.commit()
        conn.close()

        monkeypatch.setattr("hermes_cli.health.get_hermes_home", lambda: home)

        result = _probe_database()
        assert result["status"] == "ok"
        assert result["db_size_bytes"] > 0
        assert "schema_version" in result

    def test_database_probe_handles_corrupt_db(self, monkeypatch, tmp_path):
        """_probe_database must degrade gracefully on corrupt DB."""
        from hermes_cli.health import _probe_database

        home = tmp_path / ".hermes"
        home.mkdir(parents=True)
        (home / "state.db").write_bytes(b"NOT A REAL SQLITE DATABASE")

        monkeypatch.setattr("hermes_cli.health.get_hermes_home", lambda: home)

        result = _probe_database()
        assert result["status"] == "degraded"

    def test_install_dir_resolved(self, monkeypatch, tmp_path):
        """Runtime probe should detect install_dir if hermes-agent dir exists."""
        from hermes_cli import __version__

        home = tmp_path / ".hermes"
        home.mkdir(parents=True)
        (home.parent / "hermes-agent").mkdir(exist_ok=True)

        monkeypatch.setattr("hermes_cli.health.get_hermes_home", lambda: home)

        from hermes_cli.health import _probe_runtime_version
        result = _probe_runtime_version()
        assert "install_dir" in result


class TestHealthPayloadIntegrity:
    """Verify the health payload is always complete, even on failures."""

    def test_payload_never_raises(self, monkeypatch):
        """run_health_checks must never raise — always return a dict."""
        result = run_health_checks_safe()
        assert isinstance(result, dict)
        assert "overall" in result
        assert "checks" in result
        assert "capabilities" in result

    def test_payload_has_timestamp(self, monkeypatch):
        """Payload must include a timestamp."""
        result = run_health_checks_safe()
        assert "timestamp" in result

    def test_payload_schema_version(self, monkeypatch):
        """Payload must declare its schema_version."""
        result = run_health_checks_safe()
        assert result["schema_version"] == 1

    def test_capabilities_covers_all_registry_items(self, monkeypatch):
        """Capabilities in payload must match the registry."""
        from hermes_cli.health_capabilities import HEALTH_CAPABILITIES
        result = run_health_checks_safe()
        caps = result["capabilities"]
        for cap_id in HEALTH_CAPABILITIES:
            assert cap_id in caps, f"Capability {cap_id} missing from health output"
            assert "status" in caps[cap_id]
            assert "label" in caps[cap_id]


def run_health_checks_safe():
    """Run health checks with all sections included but no network."""
    from hermes_cli.health import run_health_checks
    return run_health_checks(
        include_providers=True,
        include_tools=False,  # Skip tool discovery (slow + side effects)
        include_plugins=False,  # Skip plugin discovery (side effects)
        include_mcp=False,
    )
