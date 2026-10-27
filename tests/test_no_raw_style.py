"""no-raw-style ratchet: desktop plugins may not add hard-coded colours, sizes or motion.

Old debt is recorded per file and rule in tools/no-raw-style.baseline.json; this fails only
when a plugin grows a new raw value. Use theme vars (--ui-*, --hx-*, --ds-*, --color-*) and SDK
components instead, or end the line with `raw-style-ok: <reason>`.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_desktop_plugins_add_no_raw_style():
    tool = ROOT / "tools" / "no-raw-style.py"
    run = subprocess.run(
        [sys.executable, str(tool), "plugins", str(ROOT / "desktop-plugins"), "--baseline", str(ROOT / "tools" / "no-raw-style.baseline.json")],
        capture_output=True,
        text=True,
    )
    assert run.returncode == 0, run.stdout + run.stderr


def _scan(tmp_path, body):
    plugin = tmp_path / "p"
    plugin.mkdir()
    (plugin / "plugin.js").write_text(body)
    tool = ROOT / "tools" / "no-raw-style.py"
    base = tmp_path / "base.json"
    base.write_text("{}")
    return subprocess.run(
        [sys.executable, str(tool), "plugins", str(tmp_path), "--baseline", str(base)],
        capture_output=True,
        text=True,
    )


def test_theme_palette_fence_allows_colour_values(tmp_path):
    body = "// no-raw-style: palette-start\nconst c = { background: '#f6f1e7' }\n// no-raw-style: palette-end\n"
    run = _scan(tmp_path, body)
    assert run.returncode == 0, run.stdout + run.stderr


def test_colour_outside_palette_fence_still_fails(tmp_path):
    body = "// no-raw-style: palette-start\n// no-raw-style: palette-end\nconst c = { color: '#f6f1e7' }\n"
    run = _scan(tmp_path, body)
    assert run.returncode != 0
