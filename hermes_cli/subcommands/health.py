"""``hermes health`` subcommand parser.

Extracted from the god-file decomposition pattern. Handler injected to avoid
importing ``main``.
"""

from __future__ import annotations

import argparse
from typing import Callable


def build_health_parser(subparsers, *, cmd_health: Callable) -> None:
    """Attach the ``health`` subcommand to ``subparsers``.

    ``hermes health`` — consolidated first-run readiness + component health.
    Maps to the health contract in FIRST_RUN_CONTRACT.md.
    """
    health_parser = subparsers.add_parser(
        "health",
        help="Check Hermes runtime health and first-run readiness",
        description=(
            "Run consolidated health checks and report whether Hermes is ready "
            "for your first mission. Shows runtime, database, model, provider "
            "auth, tools, plugins, MCP servers, and capabilities."
        ),
    )
    health_parser.add_argument(
        "--json", action="store_true", default=argparse.SUPPRESS,
        help="Output machine-readable JSON instead of human-readable text",
    )
    health_parser.add_argument(
        "--verbose", action="store_true", default=argparse.SUPPRESS,
        help="Include detailed check information (hints, details)",
    )
    health_parser.add_argument(
        "--fix", action="store_true", default=argparse.SUPPRESS,
        help="Attempt to auto-fix issues where possible",
    )
    health_parser.add_argument(
        "--problems", action="store_true", default=argparse.SUPPRESS,
        help="Show only checks with issues (skip passing checks)",
    )
    health_parser.add_argument(
        "--no-providers", action="store_true", default=argparse.SUPPRESS,
        help="Skip provider auth checks",
    )
    health_parser.add_argument(
        "--no-tools", action="store_true", default=argparse.SUPPRESS,
        help="Skip tool availability checks",
    )
    health_parser.add_argument(
        "--no-plugins", action="store_true", default=argparse.SUPPRESS,
        help="Skip plugin status checks",
    )
    health_parser.add_argument(
        "--no-mcp", action="store_true", default=argparse.SUPPRESS,
        help="Skip MCP server checks",
    )
    health_parser.set_defaults(func=cmd_health)
