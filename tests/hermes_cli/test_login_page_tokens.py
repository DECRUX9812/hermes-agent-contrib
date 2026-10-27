"""The pre-auth login pages must use the app's design tokens, not their own palette.

The login and "sign-in unavailable" pages render server-side before the SPA
or any theme plugin loads, so they carry a copy of the default (Warm Paper)
tokens.  This test keeps that copy in lock-step with the desktop source.
"""

import re
from pathlib import Path

import pytest

from hermes_cli.dashboard_auth import login_page

ROOT = Path(__file__).resolve().parents[2]
PAPER_TS = ROOT / "apps" / "desktop" / "src" / "themes" / "paper.ts"
TOKENS_CSS = ROOT / "apps" / "desktop" / "src" / "design" / "tokens.css"

ROLES = (
    "background", "foreground", "card", "mutedForeground", "primary",
    "primaryForeground", "accent", "accentForeground", "border", "input",
    "ring", "destructive",
)


def _kebab(name: str) -> str:
    return re.sub(r"[A-Z]", lambda m: "-" + m.group(0).lower(), name)


def _paper_block(name: str) -> dict:
    src = PAPER_TS.read_text(encoding="utf-8")
    m = re.search(name + r"[^{]*\{(.*?)\n\}", src, re.DOTALL)
    assert m, f"{name} not found in paper.ts"
    return dict(re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{3,8})'", m.group(1)))


def _css_block(css: str, selector: str) -> dict:
    m = re.search(re.escape(selector) + r"\s*\{(.*?)\}", css, re.DOTALL)
    assert m, f"{selector} block missing"
    return dict(re.findall(r"(--[\w-]+):\s*([^;]+);", m.group(1)))


@pytest.mark.skipif(not PAPER_TS.exists(), reason="desktop sources not present")
@pytest.mark.parametrize("page", ["login", "empty"])
def test_login_tokens_match_paper(page):
    html = (
        login_page._LOGIN_HTML_TEMPLATE.format(provider_buttons="", password_script="")
        if page == "login" else login_page._EMPTY_HTML
    )
    light, dark = _paper_block("PAPER_LIGHT"), _paper_block("PAPER_DARK")
    css = _css_block(html, ":root")
    for role in ROLES:
        value = css[f"--dt-{_kebab(role)}"].replace(" ", "").lower()
        assert value == f"light-dark({light[role]},{dark[role]})".lower(), role


@pytest.mark.skipif(not TOKENS_CSS.exists(), reason="desktop sources not present")
def test_login_radius_and_motion_match_tokens_css():
    tokens = dict(re.findall(r"(--[\w-]+):\s*([^;]+);", TOKENS_CSS.read_text(encoding="utf-8")))
    css = _css_block(login_page._EMPTY_HTML, ":root")
    for name in ("--radius-control", "--radius-card", "--dur-fast", "--ease-standard"):
        assert css[name].strip() == tokens[name].strip(), name


def test_login_pages_have_no_private_palette():
    for html in (login_page._LOGIN_HTML_TEMPLATE, login_page._EMPTY_HTML):
        for legacy in ("#4f46e5", "#fbfaf8", "#6366f1", "--text-primary", "--card-bg"):
            assert legacy not in html
