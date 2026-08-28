"""Resumable randomized A/B runner for context-diet live cells.

The runner starts a fresh worker process for each cell, so imported checkout
modules and ContextVars cannot leak between arms. It never modifies either
checkout; only the JSONL result file is written.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import time
from pathlib import Path

from tasks import TASKS, TASKS_BY_ID


ROOT = Path(__file__).resolve().parents[2]
WORKER = Path(__file__).with_name("worker.py")
MINIMAL_WORKER = Path(__file__).with_name("minimal_worker.py")


def _read_done(path: Path) -> set[tuple[str, str, int, str]]:
    done: set[tuple[str, str, int, str]] = set()
    if not path.exists():
        return done
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
            done.add((row["arm"], row["task"], int(row["rep"]), row["model"]))
        except (KeyError, TypeError, ValueError):
            continue
    return done


def _run_cell(
    tree: str,
    arm: str,
    task: str,
    model: str,
    provider: str,
    base_url: str,
    context_length: int,
    rep: int,
    timeout: int,
    minimal: bool,
) -> dict:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(ROOT)
    command = [
        sys.executable,
        str(MINIMAL_WORKER if minimal else WORKER),
        "--tree", tree,
        "--task", task,
        "--model", model,
        "--provider", provider,
        "--base-url", base_url,
        "--context-length", str(context_length),
        "--rep", str(rep),
        "--arm", arm,
    ]
    started = time.monotonic()
    try:
        proc = subprocess.run(
            command,
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {
            "arm": arm, "task": task, "model": model, "rep": rep,
            "ok": False, "infra_error": f"worker timeout after {timeout}s",
            "wall_s": round(time.monotonic() - started, 3),
        }
    result = None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("RESULT_JSON:"):
            try:
                result = json.loads(line[len("RESULT_JSON:"):])
            except ValueError:
                result = None
    if result is None:
        result = {
            "arm": arm, "task": task, "model": model, "rep": rep,
            "ok": False,
            "infra_error": f"worker returned no JSON (exit={proc.returncode})",
            "stdout_tail": (proc.stdout or "")[-1000:],
            "stderr_tail": (proc.stderr or "")[-1000:],
            "wall_s": round(time.monotonic() - started, 3),
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-tree", required=True)
    parser.add_argument("--diet-tree", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--provider", default="openrouter")
    parser.add_argument("--base-url", default="")
    parser.add_argument("--context-length", type=int, default=65536)
    parser.add_argument("--reps", type=int, default=5)
    parser.add_argument("--tasks", default=", ".join(t.task_id for t in TASKS))
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=95681)
    parser.add_argument("--timeout", type=int, default=420)
    parser.add_argument("--minimal", action="store_true")
    args = parser.parse_args()

    if args.provider != "local" and not os.environ.get("OPENROUTER_API_KEY"):
        raise SystemExit("OPENROUTER_API_KEY must be present in the environment")
    selected = [name.strip() for name in args.tasks.split(",") if name.strip()]
    unknown = sorted(set(selected) - set(TASKS_BY_ID))
    if unknown:
        raise SystemExit(f"unknown task ids: {', '.join(unknown)}")
    if args.reps < 1:
        raise SystemExit("--reps must be positive")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    done = _read_done(out)
    cells = [
        (arm, task, rep)
        for rep in range(1, args.reps + 1)
        for task in selected
        for arm in ("baseline", "diet")
    ]
    random.Random(args.seed).shuffle(cells)
    trees = {"baseline": str(Path(args.baseline_tree).resolve()), "diet": str(Path(args.diet_tree).resolve())}
    total = len(cells)
    with out.open("a", encoding="utf-8") as fh:
        for index, (arm, task, rep) in enumerate(cells, start=1):
            key = (arm, task, rep, args.model)
            if key in done:
                continue
            print(f"[{index}/{total}] {arm} {task} rep{rep}", flush=True)
            result = None
            for attempt in range(2):
                result = _run_cell(
                    trees[arm], arm, task, args.model, args.provider,
                    args.base_url, args.context_length, rep, args.timeout,
                    args.minimal,
                )
                if result.get("infra_error"):
                    if attempt == 0:
                        print(f"  infra retry: {result['infra_error']}", flush=True)
                        time.sleep(2)
                        continue
                    raise SystemExit(f"infra failure in {arm}/{task}/rep{rep}: {result['infra_error']}")
                # Match the existing session-search harness: a blank response
                # with no tool work is provider noise, retrying identically.
                if not result.get("final", "").strip() and not result.get("tool_calls", 0) and attempt == 0:
                    print("  provider-noise retry", flush=True)
                    time.sleep(2)
                    continue
                break
            assert result is not None
            result["runner_seed"] = args.seed
            result["runner_index"] = index
            fh.write(json.dumps(result, ensure_ascii=False) + "\n")
            fh.flush()
            print(
                f"  -> ok={result.get('ok')} api={result.get('api_calls', 0)} "
                f"tools={result.get('tool_calls', 0)} tok={result.get('total_tokens', 0)} "
                f"wall={result.get('wall_s', 0)}s",
                flush=True,
            )
    print(f"COMPLETE -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
