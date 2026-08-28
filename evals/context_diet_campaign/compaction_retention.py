"""Record deterministic compaction policy values for one checkout ref."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tree")
    parser.add_argument("--model", default="anthropic/claude-fable-5")
    args = parser.parse_args()
    tree = Path(args.tree).resolve()
    home = Path(tempfile.mkdtemp(prefix="context-diet-compaction-home-"))
    os.environ["HERMES_HOME"] = str(home)
    sys.path.insert(0, str(tree))
    os.chdir(tree)

    from agent.context_compressor import ContextCompressor

    comp = ContextCompressor(model=args.model, quiet_mode=True)
    commit = subprocess.run(
        ["git", "-C", str(tree), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    print(json.dumps({
        "tree": str(tree),
        "commit": commit,
        "model": args.model,
        "context_length": getattr(comp, "context_length", None),
        "threshold_tokens": getattr(comp, "threshold_tokens", None),
        "tail_mode": getattr(comp, "tail_mode", None),
        "tail_token_budget": getattr(comp, "tail_token_budget", None),
        "protect_last_n": getattr(comp, "protect_last_n", None),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
