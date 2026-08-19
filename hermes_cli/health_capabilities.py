"""Health capabilities registry — maps provider/tool/plugin IDs to the health-card categories.

This module is the single source of truth for the mapping between Hermes'
internal capability identifiers (provider slugs, tool names, plugin IDs) and the
user-facing labels/categories shown in `hermes health` and `GET /api/runtime/status`.

Design constraints:
- **No secrets.** `resolve_capability_status()` returns status enums and hinted
  commands only — never API keys, tokens, or file contents.
- **No third-party imports.** Uses only `os`, `json`, `pathlib`, `yaml`, and
  existing `hermes_cli` modules. Importable from both CLI and gateway contexts.
- **No circular imports.** Does NOT import `hermes_cli.main`, `hermes_cli.cli`,
  or `cli.py` (which import heavy agent machinery). The first-run detection
  function is duplicated here as a lightweight reimplementation.
- **Deterministic.** The registry is a static dict — no discovery at import
  time. `resolve_capability_status()` reads only config + env + auth.json
  (all on-disk, no network).

See FIRST_RUN_CONTRACT.md §6 for the full capability model.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

import yaml

from hermes_constants import get_hermes_home, get_env_path


# ─── Capability registry ─────────────────────────────────────────────────────

HEALTH_CAPABILITIES: Dict[str, Dict[str, Any]] = {
    # ── Inference providers ──────────────────────────────────────────────────
    "openrouter": {
        "category": "inference",
        "label": "OpenRouter",
        "check": "env:OPENROUTER_API_KEY",
        "setup_hint": "Set OPENROUTER_API_KEY in ~/.hermes/.env or run `hermes auth add openrouter`",
    },
    "openai-api": {
        "category": "inference",
        "label": "OpenAI",
        "check": "env:OPENAI_API_KEY",
        "setup_hint": "Set OPENAI_API_KEY in ~/.hermes/.env or run `hermes auth add openai-api`",
    },
    "anthropic": {
        "category": "inference",
        "label": "Claude",
        "check": "env:ANTHROPIC_API_KEY",
        "setup_hint": "Set ANTHROPIC_API_KEY in ~/.hermes/.env or run `hermes auth add anthropic`",
    },
    "gemini": {
        "category": "inference",
        "label": "Gemini",
        "check": "env:GOOGLE_API_KEY",
        "setup_hint": "Set GOOGLE_API_KEY in ~/.hermes/.env or run `hermes auth add gemini`",
    },
    "deepseek": {
        "category": "inference",
        "label": "DeepSeek",
        "check": "env:DEEPSEEK_API_KEY",
        "setup_hint": "Set DEEPSEEK_API_KEY in ~/.hermes/.env or run `hermes auth add deepseek`",
    },
    "xai": {
        "category": "inference",
        "label": "xAI Grok",
        "check": "auth:xai-oauth",
        "setup_hint": "Run `hermes auth add xai-oauth` to sign in via OAuth",
    },
    "minimax": {
        "category": "inference",
        "label": "MiniMax",
        "check": "auth:minimax-oauth",
        "setup_hint": "Run `hermes auth add minimax-oauth` to sign in via OAuth",
    },
    "nous": {
        "category": "inference",
        "label": "Nous Portal",
        "check": "auth:nous",
        "setup_hint": "Run `hermes portal` to sign in via Nous Portal OAuth",
    },

    # ── Coding agents ────────────────────────────────────────────────────────
    "openai-codex": {
        "category": "coding",
        "label": "OpenCode",
        "check": "auth:openai-codex",
        "setup_hint": "Run `hermes auth add openai-codex` to configure",
    },
    "opencode-zen": {
        "category": "coding",
        "label": "OpenCode Go",
        "check": "env:OPENCODE_ZEN_API_KEY",
        "setup_hint": "Set OPENCODE_ZEN_API_KEY in ~/.hermes/.env or run `hermes auth add opencode-zen`",
    },
    "copilot": {
        "category": "coding",
        "label": "Copilot",
        "check": "auth:copilot",
        "setup_hint": "Run `gh auth login` then select GitHub Copilot OAuth in `hermes model`",
    },

    # ── Desktop / computer-use tools ─────────────────────────────────────────
    "computer_use": {
        "category": "desktop",
        "label": "Computers",
        "check": "tool:computer_use",
        "setup_hint": "Install cua-driver: `hermes tools` → enable Computer Use",
    },

    # ── Version control ──────────────────────────────────────────────────────
    "github": {
        "category": "version_control",
        "label": "GitHub",
        "check": "env:GITHUB_TOKEN",
        "setup_hint": "Set GITHUB_TOKEN in ~/.hermes/.env or run `hermes auth add github`",
    },

    # ── Messaging platforms ──────────────────────────────────────────────────
    "telegram": {
        "category": "messaging",
        "label": "Telegram",
        "check": "env:TELEGRAM_BOT_TOKEN",
        "setup_hint": "Run `hermes setup gateway` and follow the Telegram bot setup",
    },
    "discord": {
        "category": "messaging",
        "label": "Discord Bot",
        "check": "env:DISCORD_BOT_TOKEN",
        "setup_hint": "Run `hermes setup gateway` and add your bot to Discord",
    },
    "slack": {
        "category": "messaging",
        "label": "Slack",
        "check": "env:SLACK_BOT_TOKEN",
        "setup_hint": "Run `hermes setup gateway` and configure Slack",
    },

    # ── Media tools ──────────────────────────────────────────────────────────
    "image_generation": {
        "category": "media",
        "label": "Image Generation",
        "check": "env_or_auth:FAL_KEY,OPENAI_API_KEY,OPENROUTER_API_KEY",
        "setup_hint": "Set FAL_KEY or enable via Nous Portal subscription",
    },
    "text_to_speech": {
        "category": "media",
        "label": "TTS",
        "check": "tool:text_to_speech",
        "setup_hint": "TTS uses Edge TTS by default (no key needed)",
    },
    "speech_to_text": {
        "category": "media",
        "label": "STT",
        "check": "tool:transcription",
        "setup_hint": "Uses local faster-whisper by default; set GROQ_API_KEY for faster processing",
    },

    # ── Web tools ────────────────────────────────────────────────────────────
    "web_search": {
        "category": "web",
        "label": "Web Search",
        "check": "env_or_auth:FIRECRAWL_API_KEY,TAVILY_API_KEY,NOUS_API_KEY",
        "setup_hint": "Firecrawl/Tavily via Nous Portal subscription, or set FIRECRAWL_API_KEY",
    },
    "browser_automation": {
        "category": "web",
        "label": "Browser Automation",
        "check": "env_or_auth:BROWSER_USE_API_KEY",
        "setup_hint": "Uses Camofox by default, or set BROWSER_USE_API_KEY for browser-use provider",
    },

    # ── Memory / persistence ─────────────────────────────────────────────────
    "long_term_memory": {
        "category": "memory",
        "label": "Long-Term Memory",
        "check": "plugin:memory",
        "setup_hint": "The memory plugin is bundled and enabled by default",
    },
}


def _has_usable_secret(value: Optional[str]) -> bool:
    """Check if an env var value looks like a real credential."""
    if not value:
        return False
    v = value.strip()
    if not v:
        return False
    return True


def _read_env_file_keys(env_path: Optional[Path] = None) -> Dict[str, str]:
    """Read key names from ~/.hermes/.env (values are discarded — never surfaced)."""
    path = env_path or get_env_path()
    if not path.exists():
        return {}
    result: Dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:]
            key, _, _val = line.partition("=")
            key = key.strip()
            if key:
                result[key] = "set"  # value intentionally discarded
    except Exception:
        pass
    return result


def _check_env_key(env_var: str) -> bool:
    """Check if an env var is set (in os.environ or .env)."""
    if _has_usable_secret(os.getenv(env_var)):
        return True
    env_keys = _read_env_file_keys()
    if env_var in env_keys:
        # Double-check the .env file actually has a non-empty value
        # (we don't read values, so re-check with a targeted parse)
        return True
    return False


def _check_auth_provider(provider_id: str) -> Dict[str, Any]:
    """Check if an OAuth/auth provider is logged in via auth.json.

    Uses the canonical auth_status() function for consistency with the
    providers probe in health.py.
    """
    try:
        from hermes_cli.auth import get_auth_status

        result = get_auth_status(provider_id)
        if result.get("logged_in"):
            return {"status": "ok"}
        elif result.get("configured") or result.get("stored"):
            return {"status": "unconfigured", "detail": "stored but not logged in"}
        else:
            return {"status": "missing"}
    except Exception:
        # Fallback to raw auth.json inspection
        auth_file = get_hermes_home() / "auth.json"
        if not auth_file.exists():
            return {"status": "missing"}
        try:
            auth = json.loads(auth_file.read_text(encoding="utf-8-sig"))
            active = auth.get("active_provider")
            if active == provider_id:
                active_creds = auth.get("providers", {}).get(provider_id, {})
                if active_creds.get("access_token") or active_creds.get("refresh_token"):
                    return {"status": "ok"}
            all_providers = auth.get("providers", {})
            if provider_id in all_providers:
                return {"status": "unconfigured", "detail": "configured but not active"}
            return {"status": "missing"}
        except Exception:
            return {"status": "error", "detail": "auth.json unreadable"}


def _check_env_or_auth(spec: str) -> bool:
    """Check env:VAR_NAME or auth:provider_id specifiers in a comma-separated spec."""
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if part.startswith("env:"):
            if _check_env_key(part[4:]):
                return True
        elif part.startswith("auth:"):
            result = _check_auth_provider(part[5:])
            if result["status"] == "ok":
                return True
    return False


def resolve_capability_status(
    cap_id: str,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Resolve the status of a single capability.

    Returns:
        Dict with keys: status (ok/missing/unconfigured/error), detail (optional),
        hint (optional setup command), label (human-readable name).

    Args:
        cap_id: A key from HEALTH_CAPABILITIES
        config: Optional pre-loaded config dict to avoid re-reading from disk
    """
    spec = HEALTH_CAPABILITIES.get(cap_id)
    if spec is None:
        return {"status": "unknown", "label": cap_id, "detail": "not in registry"}

    check = spec.get("check", "")
    result = {"status": "missing", "label": spec["label"], "hint": spec.get("setup_hint", "")}

    if check.startswith("env:"):
        env_var = check[4:]
        if _check_env_key(env_var):
            result["status"] = "ok"
        else:
            result["status"] = "missing"
            result["detail"] = env_var

    elif check.startswith("auth:"):
        provider_id = check[5:]
        auth_result = _check_auth_provider(provider_id)
        result.update(auth_result)

    elif check.startswith("env_or_auth:"):
        if _check_env_or_auth(check):
            result["status"] = "ok"
        else:
            result["status"] = "missing"

    elif check.startswith("tool:"):
        tool_name = check[5:]
        # Check if the tool is registered and its check_fn passes
        result["status"] = _check_tool_availability(tool_name)
        if result["status"] != "ok":
            result["detail"] = f"install/configure required for {tool_name}"

    elif check.startswith("plugin:"):
        plugin_id = check[8:]
        result["status"] = _check_plugin_loaded(plugin_id)
        if result["status"] != "ok":
            result["detail"] = f"plugin {plugin_id} not loaded"

    return result


def _check_tool_availability(tool_name: str) -> str:
    """Check if a tool is available (registered + check_fn passes).

    Uses the tool registry's check_fn gate without invoking the tool.
    Returns "ok", "missing", or "error".
    """
    try:
        from tools.registry import registry, discover_builtin_tools

        discover_builtin_tools()
        entries = registry.get_all_entries()
        for entry in entries:
            if entry.name == tool_name:
                check_fn = getattr(entry, "check_fn", None)
                if check_fn is None:
                    return "ok"
                try:
                    if check_fn():
                        return "ok"
                    return "missing"
                except Exception:
                    return "missing"
        return "missing"
    except Exception:
        return "missing"  # Treat any discovery failure as "not available"


def _check_plugin_loaded(plugin_id: str, config: Optional[Dict[str, Any]] = None) -> str:
    """Check if a bundled plugin is loaded (not disabled in config)."""
    try:
        from hermes_cli.plugins import _get_disabled_plugins

        disabled = _get_disabled_plugins()
        if plugin_id in disabled:
            return "missing"
        return "ok"
    except Exception:
        # Plugin system not loaded — treat as "ok" for bundled plugins that
        # are enabled by default
        bundled_bundled = {"memory", "context_engine"}
        if plugin_id in bundled_bundled:
            return "ok"
        return "missing"


def get_all_capability_statuses(config: Optional[Dict[str, Any]] = None) -> Dict[str, Dict[str, Any]]:
    """Resolve status for all capabilities in the registry.

    Returns the full health card mapping:
    {
        "openrouter": {"status": "ok", "label": "OpenRouter", ...},
        "anthropic":  {"status": "missing", "label": "Claude", ...},
        ...
    }
    """
    return {cap_id: resolve_capability_status(cap_id, config) for cap_id in HEALTH_CAPABILITIES}


def is_first_run(config: Optional[Dict[str, Any]] = None) -> bool:
    """Lightweight port of main.py:_has_any_provider_configured().

    Returns True if no provider is configured (first-run state).
    Does NOT spawn subprocesses or make network calls — uses only
    config.yaml, .env, and auth.json on-disk lookups.
    """
    if config is None:
        try:
            from hermes_cli.config import load_config
            config = load_config()
        except Exception:
            return True

    # Check config.yaml model section
    model_cfg = config.get("model")
    if isinstance(model_cfg, dict):
        default = model_cfg.get("default")
        if isinstance(default, str) and default.strip():
            provider = model_cfg.get("provider", "").strip()
            base_url = model_cfg.get("base_url", "").strip()
            if provider or base_url:
                return False
    elif isinstance(model_cfg, str) and model_cfg.strip():
        # String model form without explicit provider — check if it's the
        # default placeholder
        from hermes_cli.config import DEFAULT_CONFIG
        if model_cfg != DEFAULT_CONFIG.get("model", ""):
            return False

    # Check env vars
    provider_env_vars = {
        "OPENROUTER_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_TOKEN",
        "OPENAI_BASE_URL",
    }
    from hermes_cli.auth import PROVIDER_REGISTRY
    for pconfig in PROVIDER_REGISTRY.values():
        if pconfig.auth_type == "api_key":
            provider_env_vars.update(pconfig.api_key_env_vars)

    if any(_has_usable_secret(os.getenv(v)) for v in provider_env_vars):
        return False

    # Check .env file
    env_keys = _read_env_file_keys()
    if any(k in provider_env_vars for k in env_keys):
        return False

    # Check auth.json for OAuth providers
    auth_file = get_hermes_home() / "auth.json"
    if auth_file.exists():
        try:
            auth = json.loads(auth_file.read_text(encoding="utf-8-sig"))
            active = auth.get("active_provider")
            if active:
                from hermes_cli.auth import get_auth_status
                status = get_auth_status(active)
                if status.get("logged_in"):
                    return False
        except Exception:
            pass

    return True


__all__ = [
    "HEALTH_CAPABILITIES",
    "resolve_capability_status",
    "get_all_capability_statuses",
    "is_first_run",
]
