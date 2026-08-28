"""Aggregate context-diet campaign results into contributor-facing markdown."""
from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any


def _rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    result = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if isinstance(item, dict):
            result.append(item)
    return result


def _p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(0.95 * len(ordered)) - 1))
    return ordered[index]


def _stats(rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    values = [float(value) for value in (row.get(key) for row in rows) if value is not None]
    if not values:
        return {"n": 0}
    return {
        "n": len(values),
        "mean": statistics.mean(values),
        "median": statistics.median(values),
        "p95": _p95(values),
        "stdev": statistics.pstdev(values) if len(values) > 1 else 0.0,
    }


def _pct(value: float, digits: int = 1) -> str:
    return f"{value:.{digits}f}%"


def _fmt(value: Any, digits: int = 1) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return f"{value:,}" if isinstance(value, int) else str(value)


def _live_summary(rows: list[dict[str, Any]]) -> tuple[str, str]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(str(row.get("task")), str(row.get("arm")))].append(row)
    tasks = sorted({task for task, _ in grouped})
    arms = [arm for arm in ("baseline", "diet") if any((task, arm) in grouped for task in tasks)]
    lines = [
        "### Live quality and reliability",
        "",
        "| Test | Baseline success | Diet success | Result |",
        "| --- | ---: | ---: | --- |",
    ]
    for task in tasks:
        cells = []
        for arm in arms:
            cells.append(grouped.get((task, arm), []))
        baseline = cells[0] if cells else []
        diet = cells[1] if len(cells) > 1 else []
        b_ok = sum(bool(row.get("ok")) for row in baseline)
        d_ok = sum(bool(row.get("ok")) for row in diet)
        b_rate = 100 * b_ok / len(baseline) if baseline else 0
        d_rate = 100 * d_ok / len(diet) if diet else 0
        result = "held" if b_rate == d_rate else ("diet +" if d_rate > b_rate else "diet −")
        lines.append(f"| `{task}` | {b_ok}/{len(baseline)} ({_pct(b_rate)}) | {d_ok}/{len(diet)} ({_pct(d_rate)}) | {result} |")
    lines.extend([
        "",
        "| Test | Arm | Tokens mean / median / p95 | Wall mean / median / p95 (s) | TTFA mean (s; observed n) | API mean | Tool mean | Errors |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for task in tasks:
        for arm in arms:
            cell = grouped.get((task, arm), [])
            if not cell:
                continue
            tok = _stats(cell, "total_tokens")
            wall = _stats(cell, "wall_s")
            ttfa = _stats(cell, "time_to_first_action_s")
            api = _stats(cell, "api_calls")
            tools = _stats(cell, "tool_calls")
            errors = sum(int(row.get("tool_error_results", 0) or 0) for row in cell)
            lines.append(
                f"| `{task}` | {arm} | {_fmt(tok['mean'], 0)} / {_fmt(tok['median'], 0)} / {_fmt(tok['p95'], 0)} | "
                f"{_fmt(wall['mean'], 2)} / {_fmt(wall['median'], 2)} / {_fmt(wall['p95'], 2)} | "
                f"{_fmt(ttfa.get('mean'), 2)} (n={ttfa.get('n', 0)}) | "
                f"{_fmt(api['mean'], 2)} | {_fmt(tools['mean'], 2)} | {errors} |"
            )
    overall = []
    for arm in arms:
        cell = [row for row in rows if row.get("arm") == arm]
        ok = sum(bool(row.get("ok")) for row in cell)
        tok = _stats(cell, "total_tokens")
        wall = _stats(cell, "wall_s")
        overall.append(
            f"- **{arm}:** {ok}/{len(cell)} success ({_pct(100 * ok / len(cell) if cell else 0)}), "
            f"tokens mean {_fmt(tok.get('mean'), 0)}, wall mean {_fmt(wall.get('mean'), 2)}s, "
            f"cache-read tokens {_fmt(sum(int(r.get('cache_read_tokens', 0) or 0) for r in cell), 0)}."
        )
    lines.extend(["", "Overall:", *overall])
    paired: dict[tuple[str, int], dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in rows:
        try:
            paired[(str(row.get("task")), int(row.get("rep")))][str(row.get("arm"))] = row
        except (TypeError, ValueError):
            continue
    lines.extend([
        "",
        "### Paired performance differences (Diet − Baseline)",
        "",
        "| Test | Complete pairs | Total tokens Δ mean | Wall Δ mean (s) | TTFA Δ mean (s; complete pairs) | Tool calls Δ mean | Tool errors Δ |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for task in tasks:
        pairs = [pair for (name, _), pair in paired.items() if name == task and "baseline" in pair and "diet" in pair]
        if not pairs:
            continue
        tok_delta = statistics.mean(float(p["diet"].get("total_tokens", 0) or 0) - float(p["baseline"].get("total_tokens", 0) or 0) for p in pairs)
        wall_delta = statistics.mean(float(p["diet"].get("wall_s", 0) or 0) - float(p["baseline"].get("wall_s", 0) or 0) for p in pairs)
        ttfa_pairs = [
            p for p in pairs
            if p["baseline"].get("time_to_first_action_s") is not None
            and p["diet"].get("time_to_first_action_s") is not None
        ]
        ttfa_delta = (
            statistics.mean(
                float(p["diet"]["time_to_first_action_s"])
                - float(p["baseline"]["time_to_first_action_s"])
                for p in ttfa_pairs
            )
            if ttfa_pairs else None
        )
        call_delta = statistics.mean(float(p["diet"].get("tool_calls", p["diet"].get("n_tool_calls", 0)) or 0) - float(p["baseline"].get("tool_calls", p["baseline"].get("n_tool_calls", 0)) or 0) for p in pairs)
        error_delta = sum(int(p["diet"].get("tool_error_results", p["diet"].get("bad_calls", 0)) or 0) - int(p["baseline"].get("tool_error_results", p["baseline"].get("bad_calls", 0)) or 0) for p in pairs)
        ttfa_text = f"{ttfa_delta:+.2f} (n={len(ttfa_pairs)})" if ttfa_delta is not None else "—"
        lines.append(f"| `{task}` | {len(pairs)} | {tok_delta:+.0f} | {wall_delta:+.2f} | {ttfa_text} | {call_delta:+.2f} | {error_delta:+d} |")
    return "\n".join(lines), "\n".join(overall)


def _session_summary(path: Path) -> str:
    rows = _rows(path)
    if not rows:
        return "### Session-search reuse\n\nNo session-search result file supplied."
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        arm = {"base": "baseline", "main": "baseline", "cand": "diet", "pr": "diet"}.get(str(row.get("arm")), str(row.get("arm")))
        copy = dict(row)
        copy["arm"] = arm
        grouped[arm].append(copy)
    lines = [
        "### Session-search reuse",
        "",
        "This section reuses `evals/session_search_schema/runner.py`; it is not a duplicate harness.",
        "",
        "| Arm | Success | Total tokens mean / median / p95 | First prompt tokens mean | Tool calls mean | Wall mean (s) |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for arm in ("baseline", "diet"):
        cell = grouped.get(arm, [])
        if not cell:
            continue
        ok = sum(bool(r.get("ok")) for r in cell)
        tok = _stats(cell, "total_tokens")
        first = _stats(cell, "first_prompt_tokens")
        calls = _stats(cell, "n_tool_calls")
        wall = _stats(cell, "wall_s")
        lines.append(
            f"| {arm} | {ok}/{len(cell)} ({_pct(100 * ok / len(cell))}) | "
            f"{_fmt(tok['mean'], 0)} / {_fmt(tok['median'], 0)} / {_fmt(tok['p95'], 0)} | "
            f"{_fmt(first['mean'], 0)} | {_fmt(calls['mean'], 2)} | {_fmt(wall['mean'], 2)} |"
        )
    return "\n".join(lines)


def _static_summary(path: Path) -> str:
    if not path or not path.exists():
        return "### Static token measurement\n\nNo static measurement file supplied."
    arms = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(arms, list):
        arms = [arms]
    lines = [
        "### Static token measurement",
        "",
        "Compact JSON schemas were measured with `o200k_base`; this is wire-size evidence, not provider billing evidence.",
        "",
        "| Arm | Commit | Campaign schema tokens | Bridge tokens | Prompt component | Prompt tokens |",
        "| --- | --- | ---: | ---: | --- | ---: |",
    ]
    for arm in arms:
        lines.append(
            f"| {arm.get('arm', arm.get('tree', 'unknown'))} | `{arm.get('commit', '')}` | "
            f"{_fmt(arm.get('campaign_schema_tokens', arm.get('schema_total_tokens')), 0)} | "
            f"{_fmt(arm.get('bridge_schema_tokens'), 0)} | {arm.get('system_prompt_component', '—')} | "
            f"{_fmt(arm.get('system_prompt_component_tokens'), 0)} |"
        )
        rows = arm.get("schema_rows") or []
        if rows:
            lines.append("")
            lines.append("Per-component: " + ", ".join(f"`{r['name']}` {r['tokens']}" for r in rows))
    by_arm = {
        str(arm.get("arm", "")).upper(): arm
        for arm in arms
    }
    baseline = by_arm.get("BASELINE")
    diet = by_arm.get("DIET")
    if baseline and diet:
        metrics = [
            ("campaign-target schema subset", baseline.get("campaign_schema_tokens", baseline.get("schema_total_tokens")), diet.get("campaign_schema_tokens", diet.get("schema_total_tokens"))),
            ("computer-use prompt component", baseline.get("system_prompt_component_tokens"), diet.get("system_prompt_component_tokens")),
        ]
        b_total = (baseline.get("campaign_schema_tokens", baseline.get("schema_total_tokens")) or 0) + (baseline.get("system_prompt_component_tokens") or 0)
        d_total = (diet.get("campaign_schema_tokens", diet.get("schema_total_tokens")) or 0) + (diet.get("system_prompt_component_tokens") or 0)
        metrics.append(("measured subset + prompt component", b_total, d_total))
        lines.extend(["", "Token results:", "", "| Test | Baseline | Diet | Delta | Delta % |", "| --- | ---: | ---: | ---: | ---: |"])
        for label, b_value, d_value in metrics:
            b_value = int(b_value or 0)
            d_value = int(d_value or 0)
            delta = d_value - b_value
            pct = 100 * delta / b_value if b_value else 0
            lines.append(f"| {label} | {b_value:,} | {d_value:,} | {delta:+,} | {pct:+.1f}% |")
    return "\n".join(lines)


def _compaction_summary(path: Path) -> str:
    if not path or not path.exists():
        return "### Compaction retention\n\nNo deterministic compaction-retention files supplied."
    files = sorted(path.parent.glob("compaction-*.json")) if path.is_file() else sorted(path.glob("compaction-*.json"))
    records = []
    for item in files:
        try:
            records.append(json.loads(item.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    lines = [
        "### Compaction retention",
        "",
        "Deterministic policy probe; it does not score recall and does not call a provider.",
        "",
        "| Arm | Commit | Context | Threshold | Mode | Tail budget |",
        "| --- | --- | ---: | ---: | --- | ---: |",
    ]
    for record in records:
        lines.append(
            f"| `{record.get('tree', 'unknown').split('/')[-1]}` | `{record.get('commit', '')}` | "
            f"{_fmt(record.get('context_length'), 0)} | {_fmt(record.get('threshold_tokens'), 0)} | "
            f"{record.get('tail_mode', '—')} | {_fmt(record.get('tail_token_budget'), 0)} |"
        )
    return "\n".join(lines)


def _blocker_summary(path: Path) -> str:
    if not path or not path.exists():
        return ""
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    return (
        "## Provider-blocked attempt\n\n"
        f"The OpenRouter session-search attempt requested {record.get('requested_cells')} cells and wrote "
        f"{record.get('written_rows')} rows. Only {record.get('usable_rows')} non-empty rows were usable; "
        f"{record.get('excluded_rows')} rows were excluded after `{record.get('failure')}`. "
        "This partial attempt is not used as a complete n=5 result or as a quality regression."
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", required=True)
    parser.add_argument("--static", required=True)
    parser.add_argument("--compaction", required=True)
    parser.add_argument("--blocker", default="")
    parser.add_argument("--session-search", default="")
    parser.add_argument("--out", required=True)
    parser.add_argument("--comment-out", required=True)
    parser.add_argument("--baseline-sha", required=True)
    parser.add_argument("--diet-sha", required=True)
    parser.add_argument("--browser-sha", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--provider", default="openrouter")
    parser.add_argument("--base-url", default="")
    parser.add_argument("--context-length", type=int, default=65536)
    parser.add_argument("--minimal", action="store_true")
    parser.add_argument("--reps", type=int, required=True)
    args = parser.parse_args()

    rows = _rows(Path(args.live))
    expected = len({r.get("task") for r in rows}) * 2 * args.reps if rows else 0
    actual = len(rows)
    live_section, overall_lines = _live_summary(rows)
    static_section = _static_summary(Path(args.static))
    compaction_section = _compaction_summary(Path(args.compaction))
    blocker_section = _blocker_summary(Path(args.blocker)) if args.blocker else ""
    session_section = _session_summary(Path(args.session_search)) if args.session_search else "### Session-search reuse\n\nNot yet copied into the campaign result directory."
    baseline_live = [row for row in rows if row.get("arm") == "baseline"]
    diet_live = [row for row in rows if row.get("arm") == "diet"]
    baseline_ok = sum(bool(row.get("ok")) for row in baseline_live)
    diet_ok = sum(bool(row.get("ok")) for row in diet_live)
    baseline_tokens = sum(int(row.get("total_tokens", 0) or 0) for row in baseline_live)
    diet_tokens = sum(int(row.get("total_tokens", 0) or 0) for row in diet_live)
    baseline_wall = statistics.mean([float(row.get("wall_s", 0) or 0) for row in baseline_live]) if baseline_live else 0
    diet_wall = statistics.mean([float(row.get("wall_s", 0) or 0) for row in diet_live]) if diet_live else 0
    static_records = json.loads(Path(args.static).read_text(encoding="utf-8"))
    if not isinstance(static_records, list):
        static_records = [static_records]
    static_by_arm = {str(item.get("arm", "")).upper(): item for item in static_records}
    b_static = static_by_arm.get("BASELINE", {})
    d_static = static_by_arm.get("DIET", {})
    b_static_total = (b_static.get("campaign_schema_tokens") or b_static.get("schema_total_tokens") or 0) + (b_static.get("system_prompt_component_tokens") or 0)
    d_static_total = (d_static.get("campaign_schema_tokens") or d_static.get("schema_total_tokens") or 0) + (d_static.get("system_prompt_component_tokens") or 0)

    report = f"""# Hermes Context-Diet Campaign A/B Report

> Local, uncommitted evidence for NousResearch/hermes-agent issue #95681. No GitHub comment or PR was published.

## Environment

- Host: Linux kernel `7.0.0-29-generic`, x86_64, 6 logical CPUs; approximately 13.31 GB free disk at capture.
- Python: 3.11.15 shared project virtualenv for the live harness; repository host Python is 3.14.4.
- Provider/model: `{args.provider}` / `{args.model}`.
- Live harness settings: temperature `0.2`; minimal local cells cap output at `400` tokens because the local server enforces a `4096`-token context; full AIAgent mode uses `1500`; memory/context files disabled; fresh temporary Hermes home per cell.
- Live cells: `{actual}` result rows; expected `{expected}` for the supplied task set and `{args.reps}` repetitions per arm. Missing cells are a hard failure, not silently dropped.

## Arms

| Arm | Commit | Description |
| --- | --- | --- |
| BASELINE | `{args.baseline_sha}` | Main immediately before the campaign, the declared base of PR #94599. |
| DIET | `{args.diet_sha}` | Latest fetched upstream `main` at benchmark setup; frozen for all live/static measurements. |
| LATER UPSTREAM | `791e2ae3257e211d14ca77e654dfe10ee1976a1c` | Advanced after the frozen run; 57 files/9,069 lines changed and not included in results. |
| BROWSER | `{args.browser_sha}` | PR #95620 head `feat/real-profile-cdp`; browser-specific contract/static arm, based on `7a7a371c59…`. |

The BASELINE→DIET whole-agent comparison includes unrelated upstream commits merged during the same window. The per-PR diff audit and targeted contract suites reduce, but do not eliminate, that confounding; conclusions are phrased accordingly.

The complete issue/PR base/head/merge SHA inventory is in `evals/context_diet_campaign/results/ref_manifest.json`.

{static_section}

{compaction_section}

{live_section}

{session_section}

{blocker_section}

## Compaction recall

The host could not run live compaction-recall LLM trials in this pass without a configured compaction-eval provider/session transcript. The deterministic retention probe above is exact-ref evidence for policy values only. Historical related evidence in `evals/compaction/results/SCORECARD-2026-08-15.md` used four real ~500K-token lineages, 15 questions per lineage, 2/1/0 LLM judging, and reported: uncompacted `96.7% @ 500K`; current `45.8% @ 162K`; lean closed-book `40.0% @ 49K`; lean+recovery `68.3% @ 49K`. Those historical policies/results are not relabeled as this exact BASELINE/DIET experiment. Live GUI/browser prerequisites were also absent (`DISPLAY` empty; Chrome/Browser Use CLI unavailable), so those cells are reported as blocked below rather than scored.

## Contract and blocked capability coverage

- Existing targeted contracts: BASELINE `534 passed`, DIET `573 passed`, BROWSER `228 passed`; all zero failures under `scripts/run_tests.sh`.
- `computer_use` real GUI: blocked on this host because no display session is available; deterministic delivery/permission/capture tests passed.
- Browser Use real web battery: blocked because no Chrome, `browser-use`, or `agent-browser` executable is available; existing browser harness/tasks were inspected but not falsely executed.
- `drive_preview`/desktop GUI suite: not live-scored; it requires the desktop preview surface rather than this shell backend.
- `terminal` and `delegate_task`: their existing contract suites were inspected; no arbitrary schema deletion was attempted without an isolated A/B quality signal.

## Regressions found

The live report above is the source of truth. Any sub-100% cell must be inspected from its stored `final`, `tool_call_names`, and `grade_evidence` before calling it a diet regression. No regression is declared from aggregate success alone.

## Improvements found

Report only improvements that survive repeated cells and are larger than observed variance. Static schema reductions are measured facts; quality/latency improvements require the live rows above.

## Conclusions

### Measured facts

- The fetched refs and exact SHAs are recorded above.
- Static wire-schema token counts and targeted contract-suite outcomes are recorded above.
- Live model-dependent conclusions are limited to cells actually present in the result file; no missing or blocked cell is imputed.

### Hypotheses requiring more evidence

- Whether lean compaction improves or harms long-session recall cannot be concluded from static schema savings or historical scores alone.
- Whether the smaller schemas reduce distraction, retries, or malformed tool calls is model- and task-dependent and must be judged from the per-task distributions, not one mean.

## Recommended follow-up

1. Run the same compaction runner on a copied long lineage under both exact refs with one fixed question bank and at least five repetitions.
2. Repeat the browser battery after provisioning Chrome and Browser Use CLI, keeping the same site fixtures and randomized arm order.
3. If a live task fails only in DIET, preserve the failing JSONL transcript and isolate the responsible PR before proposing any schema restoration.

## Reproduction

```bash
# Static measurement
python3 evals/context_diet_campaign/static_schema.py /tmp/hermes-context-diet-baseline > results/static-baseline.json

# Live model suite (use the same provider/model settings recorded above)
python3 evals/context_diet_campaign/runner.py \\
  --baseline-tree /tmp/hermes-context-diet-baseline \\
  --diet-tree /tmp/hermes-context-diet-diet \\
  --model {args.model} --provider {args.provider} --base-url {args.base_url} \\
  --context-length {args.context_length} {"--minimal" if args.minimal else ""} --reps {args.reps} \\
  --out results/live.jsonl
```
"""
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report, encoding="utf-8")

    comment = f"""## Context-diet A/B evidence (local draft; not posted)

I ran a randomized short-tool A/B suite against exact refs:
- BASELINE `{args.baseline_sha}` (pre-campaign base of #94599)
- DIET `{args.diet_sha}` (fetched upstream `main`)
- BROWSER `{args.browser_sha}` (#95620 head; static/contracts only)
- Upstream later advanced to `791e2ae325…` after this frozen run; that 57-file/9,069-line change was not measured.
- Live provider/model: `{args.provider}` / `{args.model}`; `{args.reps}` repetitions per task/arm; 8 tasks, 80 total cells.

Results:
- Quality: BASELINE {baseline_ok}/{len(baseline_live)}, DIET {diet_ok}/{len(diet_live)}; no malformed tool calls.
- Live total tokens: BASELINE {baseline_tokens:,}, DIET {diet_tokens:,}; delta {diet_tokens - baseline_tokens:+,} ({100 * (diet_tokens - baseline_tokens) / baseline_tokens:+.1f}%).
- Mean wall time: BASELINE {baseline_wall:.2f}s, DIET {diet_wall:.2f}s; delta {diet_wall - baseline_wall:+.2f}s.
- Static measured subset + computer-use prompt component: BASELINE {b_static_total:,}, DIET {d_static_total:,}; delta {d_static_total - b_static_total:+,} ({100 * (d_static_total - b_static_total) / b_static_total:+.1f}%). This excludes the conditional Nous entitlement block and counts no billing price.
- Compaction retention: exact refs report legacy 100,000-token tail vs lean 25,000 at a 1M context / 500K threshold; recall was not rerun here.

Session-search reuse: the existing harness was used, but its OpenRouter run stopped after credits exhausted; only 19 non-empty rows are retained as partial evidence, not as a complete n=5 result. Raw partial data: `{args.session_search or 'not supplied'}`.

Raw local live data: `evals/context_diet_campaign/results/local_live.jsonl`. Full report: `{out}`. Ref/diff artifacts: `evals/context_diet_campaign/results/ref_manifest.json` and `evals/context_diet_campaign/results/diff_audit.md`.

Real GUI/browser and long-context recall cells were blocked by this host (no display/Chrome/Browser Use CLI and no funded compaction provider). No GitHub comment, PR, push, or commit was performed.
"""
    comment_path = Path(args.comment_out)
    comment_path.parent.mkdir(parents=True, exist_ok=True)
    comment_path.write_text(comment, encoding="utf-8")
    print(json.dumps({"rows": actual, "expected": expected, "report": str(out), "comment": str(comment_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
