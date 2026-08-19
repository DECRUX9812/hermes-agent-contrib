"""``hermes install`` subcommand parser.

Provides install-related subcommands:
  ``hermes install verify`` — lightweight offline install verification
"""

from __future__ import annotations

import argparse
from typing import Callable


def build_install_parser(subparsers, *, cmd_install_verify: Callable) -> None:
    """Attach the ``install`` subcommand group to ``subparsers``."""

    install_parser = subparsers.add_parser(
        "install",
        help="Installation management commands",
        description="Commands for verifying and managing the Hermes installation",
    )
    install_subparsers = install_parser.add_subparsers(
        dest="install_command",
        metavar="<command>",
    )

    # install verify
    verify_parser = install_subparsers.add_parser(
        "verify",
        help="Check installation is functional (offline, no network)",
        description=(
            "Run lightweight, offline checks to verify the Hermes installation "
            "is functional: Python imports, uv, Node, the hermes shim, "
            "config.yaml, .env, and state.db writability."
        ),
    )
    verify_parser.add_argument(
        "--json", action="store_true", default=argparse.SUPPRESS,
        help="Output machine-readable JSON",
    )
    verify_parser.set_defaults(func=cmd_install_verify)
