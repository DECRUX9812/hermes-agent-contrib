#!/usr/bin/env python3
"""Classify each remaining conflict hunk: pure-addition side, or real edit."""
import subprocess
from pathlib import Path

files = subprocess.run(["git", "diff", "--name-only", "--diff-filter=U"],
                       capture_output=True, text=True).stdout.split()

for f in files:
    p = Path(f)
    if not p.exists():
        continue
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    side = None
    ours: list[str] = []
    theirs: list[str] = []
    hunks = []
    for line in lines:
        if line.startswith("<<<<<<<"):
            side, ours, theirs = "ours", [], []
            continue
        if line.startswith("=======") and side:
            side = "theirs"
            continue
        if line.startswith(">>>>>>>"):
            o = [x for x in ours if x.strip()]
            t = [x for x in theirs if x.strip()]
            kind = ("add-theirs" if not o else "add-ours" if not t else "EDIT")
            hunks.append((kind, len(o), len(t)))
            side = None
            continue
        if side == "ours":
            ours.append(line)
        elif side == "theirs":
            theirs.append(line)
    kinds = [h[0] for h in hunks]
    tag = "all-add" if kinds and all(k != "EDIT" for k in kinds) else "MIXED"
    print(f"{tag:8} {len(hunks):2} {f}  {kinds}")
