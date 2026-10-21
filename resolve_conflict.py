#!/usr/bin/env python3
"""Resolve conflict markers in a file, per hunk.

Usage: resolve.py FILE ours            # every hunk -> ours
       resolve.py FILE theirs          # every hunk -> theirs
       resolve.py FILE 1:o,2:t,3:b     # per-hunk choice (1-based)

o = ours (HEAD), t = theirs (branch), b = both (ours then theirs).
"""
import sys
from pathlib import Path


def main() -> int:
    path = Path(sys.argv[1])
    spec = sys.argv[2]
    default = None
    picks: dict[int, str] = {}
    if spec in {"ours", "theirs"}:
        default = {"ours": "o", "theirs": "t"}[spec]
    else:
        for part in spec.split(","):
            n, _, choice = part.partition(":")
            picks[int(n)] = choice.strip()

    out: list[str] = []
    state = None          # None | "ours" | "theirs"
    idx = 0
    for line in path.read_text(encoding="utf-8").splitlines(keepends=True):
        if line.startswith("<<<<<<<"):
            idx += 1
            choice = picks.get(idx, default)
            if choice is None:
                raise SystemExit(f"{path}: hunk {idx} has no choice")
            state = "ours" if choice in {"o", "b"} else "theirs"
            continue
        if line.startswith("=======") and state is not None:
            if picks.get(idx, default) == "b":
                state = "theirs"   # both: keep ours then theirs
            else:
                state = "skip"     # drop the losing side
            continue
        if line.startswith(">>>>>>>"):
            state = None
            continue
        if state == "skip":
            continue
        out.append(line)

    path.write_text("".join(out), encoding="utf-8")
    print(f"{path}: resolved {idx} hunk(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
