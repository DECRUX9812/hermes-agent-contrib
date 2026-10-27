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
