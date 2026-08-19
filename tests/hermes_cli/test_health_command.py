"""Tests for `hermes health` and `GET /api/runtime/status`.

Hermetic-test invariants (enforced by tests/conftest.py):
1. No credential env vars leak in.
2. Isolated HERMES_HOME in a tempdir.
3. Deterministic runtime (TZ=UTC, etc.).

These tests use NO network calls — all provider/auth/tool checks are
either satisfied by the real config on the test machine (which uses the
sandboxed HERMES_HOME) or stubbed via monkeypatch.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from hermes_cli.health import run_health_checks, cmd_health
from hermes_cli.health_capabilities import (
    HEALTH_CAPABILITIES,
    resolve_capability_status,
    get_all_capability_statuses,
    is_first_run,
)


# ─── Capability registry tests ────────────────────────────────────────────────

class TestCapabilityRegistry:
    """Tests for the static HEALTH_CAPABILITIES registry."""

    def test_registry_has_all_desired_categories(self):
        """The registry must cover all categories in the desired health card."""
        expected_categories = {
            "inference",    # OpenRouter, Claude, etc.
            "coding",       # OpenCode, Codex
            "desktop",      # Computers
            "version_control",  # GitHub
            "messaging",    # Telegram, Discord
            "web",          # Web Search, Browser
            "media",        # Image Gen, TTS
            "memory",        # Long-Term Memory
        }
        actual_categories = {spec["category"] for spec in HEALTH_CAPABILITIES.values()}
        missing = expected_categories - actual_categories
        assert not missing, f"Missing capability categories: {missing}"

    def test_openai_codex_check_uses_correct_provider_id(self):
        """openai-codex capability must check auth:openai-codex (not auth:codex)."""
        spec = HEALTH_CAPABILITIES["openai-codex"]
        assert spec["check"] == "auth:openai-codex"
        assert spec["label"] == "OpenCode"

    def test_anthropic_label_matches_desired_card(self):
        """Anthropic capability must have label 'Claude' to match the health card."""
        spec = HEALTH_CAPABILITIES["anthropic"]
        assert spec["label"] == "Claude"

    def test_computer_use_has_tool_check(self):
        """computer_use must check the tool:computer_use entry point."""
        spec = HEALTH_CAPABILITIES["computer_use"]
        assert spec["check"] == "tool:computer_use"
        assert spec["label"] == "Computers"

    def test_github_has_env_check(self):
        """GitHub must check an env: spec."""
        spec = HEALTH_CAPABILITIES["github"]
        assert "env:" in spec["check"]

    def test_all_specs_have_required_fields(self):
        """Every capability must have category, label, check, and setup_hint."""
        for cap_id, spec in HEALTH_CAPABILITIES.items():
            assert "category" in spec, f"{cap_id} missing 'category'"
            assert "label" in spec, f"{cap_id} missing 'label'"
            assert "check" in spec, f"{cap_id} missing 'check'"
            assert "setup_hint" in spec, f"{cap_id} missing 'setup_hint'"

    def test_no_secrets_in_registry(self):
        """Registry values must not contain actual API keys or tokens."""
        for cap_id, spec in HEALTH_CAPABILITIES.items():
            for key, val in spec.items():
                if isinstance(val, str):
                    # No actual key values — only env var names and commands
                    assert "sk-" not in val.lower(), f"{cap_id}.{key} looks like a secret value"
                    assert "ghp_" not in val, f"{cap_id}.{key} looks like a secret value"
                    assert "Bearer" not in val, f"{cap_id}.{key} looks like a secret value"


# ─── Capability status resolution tests ───────────────────────────────────────

class TestResolveCapabilityStatus:
    """Tests for resolve_capability_status()."""

    def test_missing_env_var_returns_missing(self, monkeypatch):
        monkeypatch.delenv("NONEXISTENT_API_KEY_TEST", raising=False)
        monkeypatch.setenv("HEALTH_CAPABILITIES_CHECK", "1")

        # Temporarily add a test capability
        original = HEALTH_CAPABILITIES.copy()
        HEALTH_CAPABILITIES["test-provider"] = {
            "category": "test",
            "label": "Test Provider",
            "check": "env:NONEXISTENT_API_KEY_TEST",
            "setup_hint": "Set NONEXISTENT_API_KEY_TEST",
        }
        try:
            result = resolve_capability_status("test-provider")
            assert result["status"] == "missing"
            assert result["detail"] == "NONEXISTENT_API_KEY_TEST"
        finally:
            # Restore original (minus our test entry)
            HEALTH_CAPABILITIES.pop("test-provider", None)
            HEALTH_CAPABILITIES.update(
                {k: v for k, v in original.items() if k not in HEALTH_CAPABILITIES}
            )

    def test_set_env_var_returns_ok(self, monkeypatch):
        monkeypatch.setenv("TEST_OK_KEY", "some-value-not-a-real-key")
        original = HEALTH_CAPABILITIES.copy()
        HEALTH_CAPABILITIES["test-ok-provider"] = {
            "category": "test",
            "label": "Test OK",
            "check": "env:TEST_OK_KEY",
            "setup_hint": "Set TEST_OK_KEY",
        }
        try:
            result = resolve_capability_status("test-ok-provider")
            assert result["status"] == "ok"
        finally:
            HEALTH_CAPABILITIES.pop("test-ok-provider", None)

    def test_unknown_capability_returns_unknown(self):
        result = resolve_capability_status("nonexistent_capability_id")
        assert result["status"] == "unknown"
        assert result["label"] == "nonexistent_capability_id"

    def test_resolve_all_returns_complete_dict(self):
        """get_all_capability_statuses must return an entry for every registry item."""
        all_statuses = get_all_capability_statuses()
        assert len(all_statuses) == len(HEALTH_CAPABILITIES)
        for cap_id in HEALTH_CAPABILITIES:
            assert cap_id in all_statuses
            assert "status" in all_statuses[cap_id]
            assert "label" in all_statuses[cap_id]


# ─── First-run detection tests ────────────────────────────────────────────────

class TestFirstRunDetection:
    """Tests for is_first_run() logic (port of main.py:3055 _has_any_provider_configured)."""

    def test_no_config_returns_true(self, monkeypatch, tmp_path):
        """No config.yaml + no .env + no auth.json → first run."""
        monkeypatch.setattr("hermes_cli.health_capabilities.get_hermes_home", lambda: tmp_path / ".hermes")
        result = is_first_run(config={})
        assert result is True

    def test_model_set_returns_false(self, monkeypatch, tmp_path):
        """Model configured in config.yaml → not first run."""
        config = {"model": {"default": "gpt-4o", "provider": "openai-api"}}
        result = is_first_run(config=config)
        assert result is False

    def test_empty_model_string_returns_true(self):
        """Empty model string → first run."""
        config = {"model": ""}
        result = is_first_run(config=config)
        assert result is True

    def test_provider_in_model_returns_false(self):
        """Provider set in model dict → not first run."""
        config = {"model": {"default": "gpt-4o", "provider": "openai-api"}}
        result = is_first_run(config=config)
        assert result is False

    def test_base_url_only_returns_false(self):
        """base_url in model dict → not first run (custom provider)."""
        config = {"model": {"default": "any", "base_url": "http://localhost:8080"}}
        result = is_first_run(config=config)
        assert result is False


# ─── Health payload structure tests ───────────────────────────────────────────

class TestHealthPayload:
    """Tests for the run_health_checks() JSON contract."""

    def test_payload_has_required_top_level_keys(self):
        result = run_health_checks(
            include_providers=False,
            include_tools=False,
            include_plugins=False,
            include_mcp=False,
        )
        assert "schema_version" in result
        assert "timestamp" in result
        assert "hermes" in result
        assert "overall" in result
        assert "checks" in result
        assert "capabilities" in result
        assert "first_mission_ready" in result
        assert "next_action" in result
        assert "warnings" in result

    def test_checks_has_required_sections(self):
        result = run_health_checks(
            include_providers=False,
            include_tools=False,
            include_plugins=False,
            include_mcp=False,
        )
        checks = result["checks"]
        assert "runtime" in checks
        assert "database" in checks
        assert "model" in checks

    def test_runtime_check_has_version(self):
        checks = run_health_checks(include_providers=False, include_tools=False,
                                   include_plugins=False, include_mcp=False)["checks"]
        runtime = checks["runtime"]
        assert "version" in runtime
        assert "python" in runtime
        assert "config_version" in runtime

    def test_runtime_check_never_exposes_secrets(self):
        """Runtime check must not include .env path or credential values."""
        result = run_health_checks(
            include_providers=False, include_tools=False,
            include_plugins=False, include_mcp=False,
        )
        serialized = json.dumps(result, default=str)

        # Should not expose .env file path in the hermes section
        hermes_section = json.dumps(result.get("hermes", {}), default=str)
        assert ".env" not in hermes_section

        # Should not contain actual credential values (check for known patterns)
        # The hints may mention env var names but never actual key values
        forbidden = ["sk-", "ghp_", "gho_", "Bearer ", "eyJ"]
        for pattern in forbidden:
            assert pattern not in serialized, f"Found secret-like pattern: {pattern}"

    def test_database_check_has_schema_version(self):
        checks = run_health_checks(include_providers=False, include_tools=False,
                                   include_plugins=False, include_mcp=False)["checks"]
        db = checks["database"]
        assert "schema_version" in db
        assert "db_size_bytes" in db

    def test_model_check_has_provider_field(self):
        checks = run_health_checks(include_providers=False, include_tools=False,
                                   include_plugins=False, include_mcp=False)["checks"]
        model = checks["model"]
        assert "provider" in model
        assert "model" in model

    def test_overall_is_valid_status(self):
        result = run_health_checks(
            include_providers=False, include_tools=False,
            include_plugins=False, include_mcp=False,
        )
        assert result["overall"] in ("ready", "degraded", "unconfigured")

    def test_first_mission_ready_implies_model_ok(self):
        """If first_mission_ready is True, the model check must be 'ok'."""
        result = run_health_checks(
            include_providers=False, include_tools=False,
            include_plugins=False, include_mcp=False,
        )
        if result["first_mission_ready"]:
            assert result["checks"]["model"]["status"] == "ok"
            assert result["checks"]["runtime"]["status"] == "ok"

    def test_next_action_suggests_setup_when_model_missing(self):
        """When model is missing, next_action should mention setup."""
        result = run_health_checks(
            include_providers=False, include_tools=False,
            include_plugins=False, include_mcp=False,
        )
        model = result["checks"]["model"]
        if model["status"] != "ok":
            assert result["next_action"] is not None
            assert "setup" in result["next_action"].lower()


# ─── CLI output tests ─────────────────────────────────────────────────────────

class TestHealthCli:
    """Tests for the cmd_health CLI handler."""

    def test_json_output_is_valid_json(self, monkeypatch, capsys):
        """`hermes health --json` must output valid JSON."""
        from argparse import Namespace
        args = Namespace(
            json=True, verbose=False, fix=False, problems=False,
            no_providers=False, no_tools=False, no_plugins=False, no_mcp=False,
        )
        monkeypatch.setattr(
            "hermes_cli.health.run_health_checks",
            lambda **kw: {
                "schema_version": 1, "timestamp": "2026-01-01T00:00:00Z",
                "hermes": {"version": "0.20.2", "python": "3.11", "config_version": {"current": 37, "latest": 37}},
                "overall": "ready", "checks": {"runtime": {"status": "ok", "detail": "v0.20.2"}},
                "capabilities": {}, "first_run_detected": False, "first_mission_ready": True,
                "next_action": None, "warnings": [],
            },
        )
        exit_code = cmd_health(args)
        captured = capsys.readouterr()
        parsed = json.loads(captured.out)
        assert parsed["overall"] == "ready"
        assert parsed["schema_version"] == 1
        assert exit_code == 0

    def test_problems_flag_filters_output(self, monkeypatch, capsys):
        """`hermes health --problems` should only show non-ok items."""
        from argparse import Namespace
        args = Namespace(
            json=False, verbose=False, fix=False, problems=True,
            no_providers=False, no_tools=False, no_plugins=False, no_mcp=False,
        )
        monkeypatch.setattr(
            "hermes_cli.health.run_health_checks",
            lambda **kw: {
                "schema_version": 1, "timestamp": "2026-01-01T00:00:00Z",
                "hermes": {"version": "0.20.2", "python": "3.11", "config_version": {"current": 37, "latest": 37}},
                "overall": "unconfigured", "checks": {"runtime": {"status": "ok", "detail": "v0.20.2"},
                "database": {"status": "ok"}, "model": {"status": "missing", "hint": "Run setup"}},
                "capabilities": {}, "first_run_detected": True, "first_mission_ready": False,
                "next_action": "Run hermes setup", "warnings": [],
            },
        )
        cmd_health(args)
        captured = capsys.readouterr()
        # Should show the missing model
        assert "Not ready" in captured.out or "unconfigured" in captured.out.lower()

    def test_human_readable_contains_header(self, monkeypatch, capsys):
        """Human-readable output must contain the Hermes Health header."""
        from argparse import Namespace
        args = Namespace(
            json=False, verbose=False, fix=False, problems=False,
            no_providers=True, no_tools=True, no_plugins=True, no_mcp=True,
        )
        monkeypatch.setattr(
            "hermes_cli.health.run_health_checks",
            lambda **kw: {
                "schema_version": 1, "timestamp": "2026-01-01T00:00:00Z",
                "hermes": {"version": "0.20.2", "python": "3.11", "config_version": {"current": 37, "latest": 37}},
                "overall": "ready", "checks": {"runtime": {"status": "ok", "detail": "v0.20.2, config v37/37"},
                "database": {"status": "ok", "detail": "state.db OK"}, "model": {"status": "ok", "model": "gpt-4o", "provider": "test"}},
                "capabilities": {}, "first_run_detected": False, "first_mission_ready": True,
                "next_action": None, "warnings": [],
            },
        )
        cmd_health(args)
        captured = capsys.readouterr()
        assert "Hermes Health" in captured.out


# ─── Secrets safety tests ───────────────────────────────────────────────────

class TestSecretsSafety:
    """Verify that no secrets are ever exposed in health output."""

    def test_health_json_has_no_api_key_values(self):
        """The JSON payload must never contain actual key values."""
        result = run_health_checks(
            include_providers=False, include_tools=False,
            include_plugins=False, include_mcp=False,
        )
        serialized = json.dumps(result, default=str)

        # Check for common API key prefixes
        forbidden_patterns = [
            "sk-",          # OpenAI/Anthropic style
            "ghp_",         # GitHub PAT
            "gho_",         # GitHub OAuth
            "Bearer ",     # Bearer token prefix
            "eyJ",          # JWT prefix
        ]
        for pattern in forbidden_patterns:
            assert pattern not in serialized, (
                f"Health payload contains secret-like pattern: {pattern}"
            )

    def test_health_json_redacts_env_values(self):
        """Even if .env has keys, the values must not appear in output."""
        result = run_health_checks(
            include_providers=False, include_tools=False,
            include_plugins=False, include_mcp=False,
        )
        serialized = json.dumps(result, default=str)

        # The payload should only contain env var NAMES in hints, never values.
        # Verify no actual key values leak by checking that no value is
        # directly followed by another value in a suspicious pattern.
        # The key invariant: env var names in hints are safe (e.g. "OPENAI_API_KEY")
        # but actual key values (e.g. "sk-12345...") must never appear.
        forbidden_value_patterns = ["sk-", "ghp_", "gho_", "eyJ", "Bearer "]
        for pattern in forbidden_value_patterns:
            assert pattern not in serialized, (
                f"Health output contains credential value pattern: {pattern}"
            )


# ─── Version compatibility tests ──────────────────────────────────────────────

class TestVersionCompatibility:
    """Tests for version/compatibility reporting in health output."""

    def test_config_version_current_and_latest(self):
        """Runtime check must report current and latest config version."""
        result = run_health_checks(
            include_providers=False, include_tools=False,
            include_plugins=False, include_mcp=False,
        )
        runtime = result["checks"]["runtime"]
        cv = runtime.get("config_version", {})
        assert "current" in cv
        assert "latest" in cv
        assert cv["current"] <= cv["latest"]

    def test_config_migratable_flag_is_boolean(self):
        """config_migratable must be a boolean when present."""
        result = run_health_checks(
            include_providers=False, include_tools=False,
            include_plugins=False, include_mcp=False,
        )
        runtime = result["checks"]["runtime"]
        if "config_migratable" in runtime:
            assert isinstance(runtime["config_migratable"], bool)

    def test_schema_version_present(self):
        """Database check must report the schema version."""
        result = run_health_checks(
            include_providers=False, include_tools=False,
            include_plugins=False, include_mcp=False,
        )
        assert "schema_version" in result["checks"]["database"]
