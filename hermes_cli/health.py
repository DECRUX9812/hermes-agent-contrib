"""`hermes health` command — consolidated first-run readiness + component health.

This module implements the `hermes health` CLI command and provides the
`run_health_checks()` function used by both the CLI and the
`GET /api/runtime/status` endpoint (in hermes_cli/web_server.py).

Design principles (see FIRST_RUN_CONTRACT.md and PACKAGING_GAPS.md §2):

1. **No secrets in output.** Only status enums, counts, labels, and hinted
   commands are returned. Credential values are never read or surfaced.
2. **No circular imports.** Imports `gateway.readiness` lazily inside the
   function, not at module level, so `hermes_cli.main` can import this module
   without pulling in gateway machinery.
3. **All checks are best-effort.** Each check returns a status dict with
   `"status"` key. A failure returns `{"status": "error"}` rather than raising,
   so the overall payload is always complete.
4. **Deterministic.** No timestamps in status fields that would break diffs;
   the `timestamp` field is ISO-8601 UTC for human reference.
"""

from __future__ import annotations

import json
import os
import sys
import shutil
import sqlite3
import traceback
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from hermes_cli.colors import Colors, color
from hermes_cli.config import (
    check_config_version,
    get_config_path,
    get_env_path,
    get_hermes_home,
    load_config,
)
from hermes_cli.health_capabilities import (
    get_all_capability_statuses,
    is_first_run,
)
from hermes_constants import get_hermes_home as _get_hermes_home
from hermes_state_schema import SCHEMA_VERSION
from hermes_constants import get_optional_skills_dir
from hermes_cli.auth import PROVIDER_REGISTRY


def _safe(fn, *args, **kwargs):
    """Run a check function; return its result or an error dict on failure."""
    try:
        return fn(*args, **kwargs)
    except Exception as exc:
        return {"status": "error", "detail": type(exc).__name__}


def _probe_runtime_version() -> Dict[str, Any]:
    """Check Hermes runtime version, install dir, Python, config version."""
    from hermes_cli import __version__, __release_date__

    current_ver, latest_ver = check_config_version()

    return {
        "status": "ok",
        "detail": f"v{__version__}, config v{current_ver}/{latest_ver}",
        "version": __version__,
        "release_date": __release_date__,
        "install_dir": str(get_hermes_home().parent / "hermes-agent") if (get_hermes_home().parent / "hermes-agent").is_dir() else "unknown",
        "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "config_version": {"current": current_ver, "latest": latest_ver},
        "config_migratable": current_ver < latest_ver,
    }


def _probe_database() -> Dict[str, Any]:
    """Check state.db readability, size, and FTS rebuild status."""
    from hermes_state import SessionDB

    db_path = get_hermes_home() / "state.db"
    if not db_path.exists():
        return {
            "status": "ok",
            "detail": "state.db not initialized (will be created on first use)",
            "schema_version": SCHEMA_VERSION,
            "db_size_bytes": 0,
        }

    size = db_path.stat().st_size

    try:
        uri = f"file:{db_path.as_posix()}?mode=ro"
        with closing(sqlite3.connect(uri, uri=True, timeout=2.0)) as conn:
            conn.execute("PRAGMA query_only = ON")
            conn.execute("SELECT name FROM sqlite_master LIMIT 1").fetchone()

            # Check FTS rebuild status (read-only)
            fts_rebuild = None
            try:
                fts_rebuild = conn.execute(
                    "SELECT value FROM meta WHERE key = 'fts_rebuild_status'"
                ).fetchone()
            except Exception:
                pass

        detail = f"state.db: {size // (1024*1024)} MB, WAL"
        status = "ok"

        if fts_rebuild:
            detail += f", FTS rebuilding"
            # FTS rebuild in progress is not an error

        # Disk pressure check
        disk = shutil.disk_usage(str(get_hermes_home()))
        used_pct = round((disk.used / disk.total) * 100, 1) if disk.total else 0
        if used_pct >= 95.0:
            status = "degraded"
            detail += f", disk {used_pct}% full"
        elif used_pct >= 90.0:
            status = "degraded"
            detail += f", disk {used_pct}% full"

        return {
            "status": status,
            "detail": detail,
            "db_size_bytes": size,
            "schema_version": SCHEMA_VERSION,
            "fts_rebuild_status": fts_rebuild[0] if fts_rebuild else None,
        }
    except Exception as exc:
        return {
            "status": "degraded",
            "detail": f"state.db error: {type(exc).__name__}",
            "schema_version": SCHEMA_VERSION,
            "db_size_bytes": size,
        }


def _probe_model(config: Dict[str, Any]) -> Dict[str, Any]:
    """Check the configured default model + provider."""
    model_cfg = config.get("model")

    if isinstance(model_cfg, str) and model_cfg.strip():
        model_name = model_cfg.strip()
        provider = "custom"
    elif isinstance(model_cfg, dict):
        default = model_cfg.get("default", "")
        if isinstance(default, str):
            model_name = default.strip()
            provider = (model_cfg.get("provider") or "auto").strip()
        elif isinstance(default, dict):
            # {default: {name: ..., provider: ..., base_url: ...}}
            model_name = default.get("name", "").strip() or default.get("model", "").strip()
            provider = (default.get("provider") or "auto").strip()
        else:
            model_name = ""
            provider = "auto"
    else:
        model_name = ""
        provider = "auto"

    if model_name and model_name != DEFAULT_CONFIG_MODEL:
        return {
            "status": "ok",
            "detail": f"{model_name} via {provider}",
            "provider": provider,
            "model": model_name,
        }
    return {
        "status": "missing",
        "detail": "No model configured",
        "provider": provider,
        "model": model_name,
        "hint": "Run `hermes setup` or `hermes portal` to configure a model",
    }


def _probe_tools(config: Dict[str, Any]) -> Dict[str, Any]:
    """Check tool availability via check_fn gates."""
    tool_details: List[Dict[str, Any]] = []
    enabled_count = 0
    disabled_count = 0
    missing_count = 0

    try:
        from tools.registry import registry, discover_builtin_tools

        discover_builtin_tools()
        entries = registry.get_all_entries()
        for entry in entries:
            name = entry.name
            check_fn = getattr(entry, "check_fn", None)
            requires_env = getattr(entry, "requires_env", [])
            requires_env = requires_env if isinstance(requires_env, list) else []

            if check_fn is None and not requires_env:
                status = "ready"
                enabled_count += 1
            else:
                # Check requires_env
                all_env_set = all(_has_usable_secret(os.getenv(v)) for v in requires_env)
                if all_env_set:
                    if check_fn is None or check_fn():
                        status = "ready"
                        enabled_count += 1
                    else:
                        status = "missing"
                        missing_count += 1
                else:
                    status = "missing"
                    missing_count += 1

            detail = {"name": name, "status": status}
            if status == "missing" and requires_env:
                detail["hint"] = f"Set: {', '.join(requires_env)}"
            tool_details.append(detail)

        # Sort: missing first, then by name
        tool_details.sort(key=lambda t: (t["status"] != "missing", t["name"]))
        disabled_count = missing_count

    except Exception as exc:
        return {
            "status": "error",
            "detail": f"Tool discovery failed: {type(exc).__name__}",
            "enabled_count": 0,
            "disabled_count": 0,
            "details": [],
        }

    status = "ok"
    if missing_count > 0:
        status = "degraded"

    return {
        "status": status,
        "enabled_count": enabled_count,
        "disabled_count": disabled_count,
        "missing_count": missing_count,
        "details": tool_details,
    }


def _probe_plugins(config: Dict[str, Any]) -> Dict[str, Any]:
    """Check bundled, user, and entrypoint plugin status."""
    from hermes_cli.plugins import (
        discover_entrypoint_manifests,
        _get_disabled_plugins,
    )

    enabled: List[Dict[str, Any]] = []
    disabled: List[Dict[str, Any]] = []
    total = 0

    # Entry-point plugins
    manifests = discover_entrypoint_manifests()
    total += len(manifests)

    disabled_set = _get_disabled_plugins()

    for manifest in manifests:
        entry = {
            "id": manifest.name,
            "version": manifest.version,
            "source": str(manifest.source),
        }
        if manifest.name in disabled_set:
            entry["status"] = "disabled"
            disabled.append(entry)
        else:
            entry["status"] = "loaded"
            enabled.append(entry)

    # Bundled plugins (directory-based)
    bundled_plugins_dir = get_hermes_home().parent / "hermes-agent" / "plugins"
    if bundled_plugins_dir.exists():
        for plugin_dir in bundled_plugins_dir.iterdir():
            if plugin_dir.is_dir() and (plugin_dir / "plugin.yaml").exists():
                total += 1
                name = plugin_dir.name
                if name not in disabled_set:
                    found = any(e["id"] == name for e in enabled)
                    if not found:
                        enabled.append({
                            "id": name,
                            "version": "1.0.0",
                            "source": "bundled",
                            "status": "loaded",
                        })

    status = "ok"
    # Plugins that are part of core (memory, context_engine) are always loaded
    always_ok = {"memory", "context_engine"}
    if any(e["id"] not in always_ok and e["status"] == "disabled" for e in disabled):
        status = "degraded"

    return {
        "status": status,
        "enabled_count": len(enabled),
        "disabled_count": len(disabled),
        "total": total,
        "details": sorted(enabled + disabled, key=lambda x: x["id"]),
    }


def _probe_mcp_servers(config: Dict[str, Any]) -> Dict[str, Any]:
    """Check MCP server configuration and connection status."""
    configured: List[Dict[str, Any]] = []
    connected_count = 0

    try:
        mcp_servers = config.get("mcp_servers", {})
        if not isinstance(mcp_servers, dict):
            return {"status": "ok", "configured": 0, "connected": 0, "details": []}

        try:
            from tools.mcp_tool import get_mcp_status
            status_list = get_mcp_status()
            status_map = {entry.get("name"): entry for entry in status_list}
        except Exception:
            status_map = {}

        for name, server_config in mcp_servers.items():
            entry = {"name": name, "status": "configured"}
            existing = status_map.get(name, {})
            if existing.get("connected"):
                entry["status"] = "connected"
                connected_count += 1
            elif existing.get("error"):
                entry["status"] = "error"
                entry["detail"] = existing.get("error", "unknown error")
            else:
                entry["status"] = "unconnected"
            configured.append(entry)

    except Exception as exc:
        return {
            "status": "error",
            "detail": f"MCP probe failed: {type(exc).__name__}",
            "configured": 0,
            "connected": 0,
            "details": [],
        }

    status = "ok"
    if any(e["status"] == "error" for e in configured):
        status = "degraded"

    return {
        "status": status,
        "configured": len(configured),
        "connected": connected_count,
        "details": configured,
    }


def _probe_skills() -> Dict[str, Any]:
    """Check skill directory and count."""
    skills_dir = get_optional_skills_dir()
    if not skills_dir.exists():
        return {
            "status": "ok",
            "detail": "skills dir not yet created",
            "count": 0,
        }

    count = sum(1 for d in skills_dir.iterdir() if d.is_dir())
    return {
        "status": "ok",
        "count": count,
        "path": str(skills_dir),
    }


def _probe_providers(config: Dict[str, Any]) -> Dict[str, Any]:
    """Check all configured and available provider auth status."""
    from hermes_cli.auth import get_auth_status

    results: Dict[str, Any] = {}
    for provider_id, pconfig in PROVIDER_REGISTRY.items():
        label = getattr(pconfig, "name", provider_id)
        auth_type = getattr(pconfig, "auth_type", "unknown")

        if auth_type == "api_key":
            env_vars = getattr(pconfig, "api_key_env_vars", ())
            is_set = any(_has_usable_secret(os.getenv(v)) for v in env_vars)
            if is_set:
                results[provider_id] = {"status": "ok", "label": label}
            else:
                results[provider_id] = {
                    "status": "missing",
                    "label": label,
                    "hint": f"Set {', '.join(env_vars)} or run `hermes auth add {provider_id}`",
                }
        elif auth_type in ("oauth_device_code", "oauth_external"):
            try:
                auth_result = get_auth_status(provider_id)
                if auth_result.get("logged_in"):
                    results[provider_id] = {"status": "ok", "label": label}
                elif auth_result.get("configured") or auth_result.get("stored"):
                    results[provider_id] = {
                        "status": "unconfigured",
                        "label": label,
                        "detail": "stored but not logged in",
                    }
                else:
                    results[provider_id] = {
                        "status": "missing",
                        "label": label,
                        "hint": f"Run `hermes auth add {provider_id}` or `hermes portal`",
                    }
            except Exception:
                results[provider_id] = {"status": "unknown", "label": label}
        else:
            results[provider_id] = {"status": "unknown", "label": label}

    return results


def _check_auth_provider_local(
    provider_id: str,
    get_auth_status_fn,
) -> Dict[str, Any]:
    """Check OAuth provider auth status (shared with capabilities module)."""
    auth_file = get_hermes_home() / "auth.json"
    if not auth_file.exists():
        return {"status": "missing"}
    try:
        auth = json.loads(auth_file.read_text(encoding="utf-8-sig"))
        active = auth.get("active_provider")
        if active == provider_id:
            status = get_auth_status_fn(provider_id)
            if status.get("logged_in"):
                return {"status": "ok"}
            return {"status": "unconfigured", "detail": "stored but not logged in"}
        all_provs = auth.get("providers", {})
        if provider_id in all_provs:
            return {"status": "unconfigured", "detail": "stored but not active"}
        return {"status": "missing"}
    except Exception:
        return {"status": "error", "detail": "auth.json unreadable"}


def _probe_gateway(config: Dict[str, Any]) -> Dict[str, Any]:
    """Check gateway process status."""
    try:
        from hermes_cli.gateway import get_gateway_status

        gw_status = get_gateway_status()
        if gw_status and gw_status.get("running"):
            return {
                "status": "ok",
                "detail": f"running (state: {gw_status.get('state', 'unknown')})",
            }
        return {
            "status": "degraded",
            "detail": "not running",
            "hint": "Run `hermes gateway start`",
        }
    except Exception:
        return {"status": "ok", "detail": "not started (normal for CLI-only use)"}


# ─── Main health check runner ──────────────────────────────────────────────────

def run_health_checks(
    *,
    include_providers: bool = True,
    include_tools: bool = True,
    include_plugins: bool = True,
    include_mcp: bool = True,
    include_skills: bool = True,
    include_gateway: bool = True,
) -> Dict[str, Any]:
    """Run all health checks and return the consolidated health payload.

    This is the single function used by both:
    - `hermes health` CLI command
    - `GET /api/runtime/status` endpoint

    All checks are best-effort — a failure returns a degraded/error status,
    never raises.
    """
    from hermes_cli import __version__

    config = _safe(load_config, default={"model": "", "providers": {}}) or {"model": "", "providers": {}}

    # Runtime checks
    runtime = _safe(_probe_runtime_version)
    database = _safe(_probe_database)
    model = _safe(_probe_model, config)

    checks: Dict[str, Any] = {
        "runtime": runtime,
        "database": database,
        "model": model,
    }

    if include_providers:
        checks["providers"] = _safe(_probe_providers, config)
    if include_tools:
        checks["tools"] = _safe(_probe_tools, config)
    if include_plugins:
        checks["plugins"] = _safe(_probe_plugins, config)
    if include_mcp:
        checks["mcp_servers"] = _safe(_probe_mcp_servers, config)
    if include_skills:
        checks["skills"] = _safe(_probe_skills)
    if include_gateway:
        checks["gateway"] = _safe(_probe_gateway, config)

    # Overall status
    statuses = [v.get("status") for v in checks.values() if isinstance(v, dict)]
    if any(s == "error" for s in statuses):
        overall = "degraded"
    elif any(s == "missing" for s in statuses):
        overall = "unconfigured"
    elif any(s == "degraded" for s in statuses):
        overall = "degraded"
    else:
        overall = "ready"

    # First-run detection
    first_run = is_first_run(config)

    # Capabilities card (mapped to user-facing labels)
    capabilities = get_all_capability_statuses(config)

    # First mission readiness: need a model + runtime + database
    model_ok = model.get("status") == "ok"
    runtime_ok = runtime.get("status") == "ok"
    db_ok = database.get("status") in ("ok", "degraded")
    first_mission_ready = model_ok and runtime_ok and db_ok and not first_run

    # Next action suggestion
    next_action = None
    if first_run:
        next_action = "Run `hermes setup` or `hermes portal` to configure a model provider"
    elif not model_ok:
        next_action = model.get("hint", "Run `hermes model` to select a model")
    elif not runtime_ok:
        next_action = "Run `hermes doctor --fix` to repair the installation"
    elif not db_ok:
        next_action = "Check disk space and permissions on ~/.hermes/"

    # Warnings (non-blocking)
    warnings: List[str] = []
    if runtime.get("status") == "degraded":
        warnings.append(f"Runtime issue: {runtime.get('detail', '')}")
    if database.get("fts_rebuild_status"):
        warnings.append(f"Search index is rebuilding: {database['fts_rebuild_status']}")
    if checks.get("tools", {}).get("missing_count", 0) > 0:
        warnings.append(
            f"{checks['tools']['missing_count']} tools are missing — "
            f"some capabilities will be unavailable"
        )

    result = {
        "schema_version": 1,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hermes": {
            "version": __version__,
            "install_dir": str(get_hermes_home().parent / "hermes-agent"),
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "config_version": runtime.get("config_version", {}),
        },
        "overall": overall,
        "checks": checks,
        "capabilities": capabilities,
        "first_run_detected": first_run,
        "first_mission_ready": first_mission_ready,
        "next_action": next_action,
        "warnings": warnings,
    }

    return result


# ─── CLI handler ──────────────────────────────────────────────────────────────

DEFAULT_CONFIG_MODEL = ""


def _has_usable_secret(value: Optional[str]) -> bool:
    """Check if an env var value looks like a real credential."""
    if not value:
        return False
    v = value.strip()
    return bool(v)


def _format_check(name: str, check: Dict[str, Any]) -> str:
    """Format a single check line for human-readable output."""
    status = check.get("status", "unknown")
    if status == "ok":
        icon = color("✓", Colors.GREEN)
    elif status == "missing":
        icon = color("✗", Colors.YELLOW)
    elif status == "degraded":
        icon = color("⚠", Colors.YELLOW)
    elif status == "error":
        icon = color("✗", Colors.RED)
    else:
        icon = color("?", Colors.DIM)

    detail = check.get("detail", "")
    parts = [f"{icon} {name}"]
    if detail:
        parts[0] += f"  {color(detail, Colors.DIM)}"

    # Show hint if there's a setup hint
    hint = check.get("hint")
    if hint and status != "ok":
        parts[0] += f"\n{color('  → ' + hint, Colors.CYAN)}"

    return parts[0]


def cmd_health(args) -> int:
    """Handler for `hermes health`."""
    json_output = getattr(args, "json", False)
    verbose = getattr(args, "verbose", False)
    fix = getattr(args, "fix", False)
    problems_only = getattr(args, "problems", False)
    include_providers = getattr(args, "no_providers", False) is False
    include_tools = getattr(args, "no_tools", False) is False
    include_plugins = getattr(args, "no_plugins", False) is False
    include_mcp = getattr(args, "no_mcp", False) is False

    result = run_health_checks(
        include_providers=include_providers,
        include_tools=include_tools,
        include_plugins=include_plugins,
        include_mcp=include_mcp,
    )

    if json_output:
        # Optionally strip details for non-verbose
        if not verbose:
            for check in result.get("checks", {}).values():
                if isinstance(check, dict):
                    check.pop("detail", None)
                    check.pop("hint", None)
        print(json.dumps(result, indent=2))
        return 0 if result["overall"] in ("ready", "ok") else 1

    # Human-readable output
    if problems_only:
        # Filter to only show issues
        checks_to_show = {}
        for name, check in result["checks"].items():
            if isinstance(check, dict) and check.get("status") != "ok":
                checks_to_show[name] = check
        caps_with_issues = {
            k: v for k, v in result["capabilities"].items()
            if v.get("status") != "ok"
        }
        if not checks_to_show and not caps_with_issues:
            print(color("✓ All checks passed. Hermes is ready to go.", Colors.GREEN))
            return 0

    else:
        checks_to_show = result["checks"]
        caps_with_issues = {}

    # Header
    print()
    print(color("◆ Hermes Health", Colors.CYAN, getattr(Colors, "BOLD", "")))
    print()

    # Overall status
    overall = result["overall"]
    if overall == "ready":
        overall_icon = color("✓", Colors.GREEN)
        overall_label = color("All systems ready", Colors.GREEN)
    elif overall == "degraded":
        overall_icon = color("⚠", Colors.YELLOW)
        overall_label = color("Ready with warnings", Colors.YELLOW)
    else:
        overall_icon = color("✗", Colors.RED)
        overall_label = color("Not ready", Colors.RED)

    print(f"  Overall:     {overall_icon} {overall_label}")
    print()

    # Runtime section
    runtime = result["checks"].get("runtime", {})
    print(f"  Hermes Runtime  {_format_check('', runtime).strip()}")

    # Database section
    database = result["checks"].get("database", {})
    detail = database.get("detail", "")
    db_icon = color("✓", Colors.GREEN) if database.get("status") == "ok" else color("✗", Colors.YELLOW)
    print(f"  Mission Database {db_icon}  {detail}")

    # Model section
    model = result["checks"].get("model", {})
    if model.get("status") == "ok":
        model_detail = f"{model.get('model', '?')} via {model.get('provider', '?')}"
        print(f"  Model           {color('✓', Colors.GREEN)}  {model_detail}")
    else:
        print(f"  Model           {color('✗', Colors.YELLOW)}  {model.get('hint', 'Not configured')}")

    # Capabilities card (the desired health result format)
    print()
    print(color("  Capabilities:", Colors.BOLD))

    # Map capability IDs to the display order from the requested health card
    display_order = [
        ("openrouter", "OpenRouter"),
        ("openai-api", "OpenAI"),
        ("anthropic", "Claude"),
        ("gemini", "Gemini"),
        ("deepseek", "DeepSeek"),
        ("nous", "Nous Portal"),
        ("openai-codex", "OpenCode"),
        ("opencode-zen", "OpenCode Go"),
        ("copilot", "Copilot"),
        ("computer_use", "Computers"),
        ("github", "GitHub"),
        ("telegram", "Telegram"),
        ("discord", "Discord"),
        ("web_search", "Web Search"),
        ("browser_automation", "Browser Automation"),
        ("image_generation", "Image Gen"),
        ("text_to_speech", "TTS"),
        ("long_term_memory", "Memory"),
    ]

    caps = result["capabilities"]
    for cap_id, fallback_label in display_order:
        cap = caps.get(cap_id, {})
        if not cap:
            continue
        status = cap.get("status", "missing")
        if status == "ok":
            icon = color("✓", Colors.GREEN)
            detail_text = ""
        elif status == "missing":
            icon = color("Setup required", Colors.YELLOW)
            detail_text = ""
        elif status == "unconfigured":
            icon = color("Setup required", Colors.YELLOW)
            detail_text = ""
        else:
            # "error" or "unknown" — show a warning but suggest setup
            icon = color("Setup required", Colors.YELLOW)
            detail_text = ""
        print(f"    {cap.get('label', fallback_label):.<30} {icon}{detail_text}")

    # Tools summary
    tools = result["checks"].get("tools", {})
    if tools:
        print()
        t_status = tools.get("status", "ok")
        t_icon = color("✓", Colors.GREEN) if t_status == "ok" else color("⚠", Colors.YELLOW)
        print(f"  Tools:    {t_icon}  {tools.get('enabled_count', 0)} enabled, "
              f"{tools.get('missing_count', 0)} missing")

    # Plugins summary
    plugins = result["checks"].get("plugins", {})
    if plugins:
        p_icon = color("✓", Colors.GREEN) if plugins.get("status") == "ok" else color("⚠", Colors.YELLOW)
        print(f"  Plugins:  {p_icon}  {plugins.get('enabled_count', 0)} loaded, "
              f"{plugins.get('disabled_count', 0)} disabled")

    # Skills summary
    skills = result["checks"].get("skills", {})
    if skills:
        print(f"  Skills:   {color('✓', Colors.GREEN)}  {skills.get('count', 0)} available")

    # Warnings
    if result.get("warnings") and not problems_only:
        print()
        print(color("  Warnings:", Colors.YELLOW))
        for w in result["warnings"]:
            print(f"    {color('⚠', Colors.YELLOW)} {w}")

    # Next action
    if result.get("next_action") and not problems_only:
        print()
        print(f"  {color('→', Colors.CYAN)} {result['next_action']}")

    # First run detection
    if result.get("first_run_detected"):
        print()
        print(color("  ⚠ This looks like a fresh install. No model provider is configured.", Colors.YELLOW))
        print(color("    Run `hermes setup` or `hermes portal` to get started.", Colors.YELLOW))

    print()
    return 0 if result["overall"] in ("ready", "ok") else 1


__all__ = ["run_health_checks", "cmd_health"]
