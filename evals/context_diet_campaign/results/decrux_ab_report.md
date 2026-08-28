# Hermes Context-Diet Campaign A/B Report

> Local, uncommitted evidence for NousResearch/hermes-agent issue #95681. No GitHub comment or PR was published.

## Environment

- Host: Linux kernel `7.0.0-29-generic`, x86_64, 6 logical CPUs; approximately 13.31 GB free disk at capture.
- Python: 3.11.15 shared project virtualenv for the live harness; repository host Python is 3.14.4.
- Provider/model: `local` / `/home/decrux/models/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf`.
- Live harness settings: temperature `0.2`; minimal local cells cap output at `400` tokens because the local server enforces a `4096`-token context; full AIAgent mode uses `1500`; memory/context files disabled; fresh temporary Hermes home per cell.
- Live cells: `80` result rows; expected `80` for the supplied task set and `5` repetitions per arm. Missing cells are a hard failure, not silently dropped.

## Arms

| Arm | Commit | Description |
| --- | --- | --- |
| BASELINE | `4c1f53be10d0fce1d25aee1975e5149b6c54f25a` | Main immediately before the campaign, the declared base of PR #94599. |
| DIET | `790e1eb6bd576261e6b9e70fcfe4fbdf17f866bb` | Latest fetched upstream `main` at benchmark setup; frozen for all live/static measurements. |
| LATER UPSTREAM | `791e2ae3257e211d14ca77e654dfe10ee1976a1c` | Advanced after the frozen run; 57 files/9,069 lines changed and not included in results. |
| BROWSER | `b03b3a69342c2da5303f90159d59c5fcf1c5f7ad` | PR #95620 head `feat/real-profile-cdp`; browser-specific contract/static arm, based on `7a7a371c59…`. |

The BASELINE→DIET whole-agent comparison includes unrelated upstream commits merged during the same window. The per-PR diff audit and targeted contract suites reduce, but do not eliminate, that confounding; conclusions are phrased accordingly.

The complete issue/PR base/head/merge SHA inventory is in `evals/context_diet_campaign/results/ref_manifest.json`.

### Static token measurement

Compact JSON schemas were measured with `o200k_base`; this is wire-size evidence, not provider billing evidence.

| Arm | Commit | Campaign schema tokens | Bridge tokens | Prompt component | Prompt tokens |
| --- | --- | ---: | ---: | --- | ---: |
| BASELINE | `4c1f53be10d0fce1d25aee1975e5149b6c54f25a` | 10,150 | 322 | computer_use_guidance | 1,199 |

Per-component: `cronjob` 2231, `computer_use` 2227, `session_search` 1577, `skill_manage` 926, `clarify` 887, `tool_search` 141, `tool_describe` 77, `tool_call` 104, `bfl_flux3_text_to_video` 417, `bfl_flux3_image_to_video` 458, `bfl_flux3_keyframes_to_video` 597, `bfl_flux3_video_continuation` 527, `bfl_flux3_get_result` 209, `bfl_flux3_prompting_guide` 94
| DIET | `790e1eb6bd576261e6b9e70fcfe4fbdf17f866bb` | 4,778 | 422 | absent | 0 |

Per-component: `cronjob` 1148, `computer_use` 2071, `session_search` 702, `skill_manage` 520, `clarify` 337, `tool_search` 215, `tool_describe` 103, `tool_call` 104
| BROWSER | `b03b3a69342c2da5303f90159d59c5fcf1c5f7ad` | 4,591 | 422 | absent | 0 |

Per-component: `cronjob` 1148, `computer_use` 1334, `session_search` 702, `skill_manage` 520, `clarify` 887, `tool_search` 215, `tool_describe` 103, `tool_call` 104

Token results:

| Test | Baseline | Diet | Delta | Delta % |
| --- | ---: | ---: | ---: | ---: |
| campaign-target schema subset | 10,150 | 4,778 | -5,372 | -52.9% |
| computer-use prompt component | 1,199 | 0 | -1,199 | -100.0% |
| measured subset + prompt component | 11,349 | 4,778 | -6,571 | -57.9% |

### Compaction retention

Deterministic policy probe; it does not score recall and does not call a provider.

| Arm | Commit | Context | Threshold | Mode | Tail budget |
| --- | --- | ---: | ---: | --- | ---: |
| `hermes-context-diet-baseline` | `4c1f53be10d0fce1d25aee1975e5149b6c54f25a` | 1,000,000 | 500,000 | legacy | 100,000 |
| `hermes-context-diet-browser` | `b03b3a69342c2da5303f90159d59c5fcf1c5f7ad` | 1,000,000 | 500,000 | lean | 25,000 |
| `hermes-context-diet-diet` | `790e1eb6bd576261e6b9e70fcfe4fbdf17f866bb` | 1,000,000 | 500,000 | lean | 25,000 |

### Live quality and reliability

| Test | Baseline success | Diet success | Result |
| --- | ---: | ---: | --- |
| `clarify_batch` | 5/5 (100.0%) | 5/5 (100.0%) | held |
| `clarify_single` | 5/5 (100.0%) | 5/5 (100.0%) | held |
| `cron_create` | 5/5 (100.0%) | 5/5 (100.0%) | held |
| `cron_malformed_recovery` | 5/5 (100.0%) | 5/5 (100.0%) | held |
| `cron_mutate_delete` | 5/5 (100.0%) | 5/5 (100.0%) | held |
| `deferred_discover` | 5/5 (100.0%) | 5/5 (100.0%) | held |
| `deferred_error_recovery` | 5/5 (100.0%) | 5/5 (100.0%) | held |
| `skill_patch` | 5/5 (100.0%) | 5/5 (100.0%) | held |

| Test | Arm | Tokens mean / median / p95 | Wall mean / median / p95 (s) | TTFA mean (s; observed n) | API mean | Tool mean | Errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `clarify_batch` | baseline | 2800 / 2800 / 2800 | 26.64 / 26.68 / 26.72 | 20.54 (n=5) | 1.00 | 2.00 | 0 |
| `clarify_batch` | diet | 1615 / 1613 / 1618 | 23.27 / 23.24 / 23.36 | 16.52 (n=5) | 1.00 | 1.00 | 0 |
| `clarify_single` | baseline | 2613 / 2610 / 2623 | 18.60 / 18.31 / 19.64 | 14.77 (n=3) | 1.00 | 1.00 | 0 |
| `clarify_single` | diet | 1480 / 1480 / 1482 | 17.84 / 17.71 / 18.53 | 14.13 (n=5) | 1.00 | 1.00 | 0 |
| `cron_create` | baseline | 6055 / 6058 / 6089 | 81.84 / 82.64 / 85.97 | 55.06 (n=5) | 1.00 | 1.00 | 0 |
| `cron_create` | diet | 3815 / 3815 / 3820 | 60.93 / 61.03 / 61.09 | 36.10 (n=5) | 1.00 | 1.00 | 0 |
| `cron_malformed_recovery` | baseline | 9040 / 9054 / 9057 | 83.25 / 83.65 / 84.31 | 51.54 (n=5) | 2.00 | 2.00 | 5 |
| `cron_malformed_recovery` | diet | 5304 / 5659 / 5772 | 62.37 / 61.22 / 73.85 | 33.48 (n=4) | 1.80 | 1.80 | 4 |
| `cron_mutate_delete` | baseline | 9731 / 10688 / 10734 | 66.20 / 67.36 / 69.02 | 28.43 (n=4) | 3.60 | 3.60 | 0 |
| `cron_mutate_delete` | diet | 9220 / 8261 / 10693 | 64.76 / 63.34 / 68.01 | 28.39 (n=3) | 3.40 | 3.40 | 0 |
| `deferred_discover` | baseline | 4341 / 4325 / 4373 | 29.46 / 29.39 / 30.64 | 13.10 (n=4) | 3.00 | 3.00 | 0 |
| `deferred_discover` | diet | 4355 / 4364 / 4365 | 29.40 / 29.67 / 29.79 | 13.62 (n=3) | 3.00 | 3.00 | 0 |
| `deferred_error_recovery` | baseline | 6044 / 5741 / 7247 | 37.84 / 36.17 / 44.22 | 12.53 (n=3) | 4.20 | 4.20 | 5 |
| `deferred_error_recovery` | diet | 5741 / 5741 / 5741 | 36.03 / 36.10 / 36.18 | 12.47 (n=4) | 4.00 | 4.00 | 5 |
| `skill_patch` | baseline | 2895 / 2897 / 2897 | 35.25 / 35.11 / 35.77 | 29.54 (n=3) | 1.00 | 1.00 | 0 |
| `skill_patch` | diet | 2053 / 2051 / 2057 | 28.62 / 28.39 / 29.02 | 22.96 (n=5) | 1.00 | 1.00 | 0 |

Overall:
- **baseline:** 40/40 success (100.0%), tokens mean 5440, wall mean 47.38s, cache-read tokens 0.
- **diet:** 40/40 success (100.0%), tokens mean 4198, wall mean 40.40s, cache-read tokens 0.

### Paired performance differences (Diet − Baseline)

| Test | Complete pairs | Total tokens Δ mean | Wall Δ mean (s) | TTFA Δ mean (s; complete pairs) | Tool calls Δ mean | Tool errors Δ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `clarify_batch` | 5 | -1185 | -3.37 | -4.02 (n=5) | -1.00 | +0 |
| `clarify_single` | 5 | -1133 | -0.77 | -0.61 (n=3) | +0.00 | +0 |
| `cron_create` | 5 | -2240 | -20.91 | -18.95 (n=5) | +0.00 | +0 |
| `cron_malformed_recovery` | 5 | -3736 | -20.88 | -18.08 (n=4) | -0.20 | -1 |
| `cron_mutate_delete` | 5 | -511 | -1.44 | -0.01 (n=3) | -0.20 | +0 |
| `deferred_discover` | 5 | +14 | -0.06 | +0.74 (n=3) | +0.00 | +0 |
| `deferred_error_recovery` | 5 | -303 | -1.81 | -0.07 (n=3) | -0.20 | +0 |
| `skill_patch` | 5 | -843 | -6.63 | -6.59 (n=3) | +0.00 | +0 |

### Session-search reuse

This section reuses `evals/session_search_schema/runner.py`; it is not a duplicate harness.

| Arm | Success | Total tokens mean / median / p95 | First prompt tokens mean | Tool calls mean | Wall mean (s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 8/8 (100.0%) | 6264 / 4776 / 17077 | 1993 | 1.50 | 4.62 |
| diet | 11/11 (100.0%) | 4400 / 3157 / 8813 | 1148 | 1.55 | 3.88 |

## Provider-blocked attempt

The OpenRouter session-search attempt requested 60 cells and wrote 47 rows. Only 19 non-empty rows were usable; 28 rows were excluded after `HTTP 402 Insufficient credits`. This partial attempt is not used as a complete n=5 result or as a quality regression.

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
python3 evals/context_diet_campaign/runner.py \
  --baseline-tree /tmp/hermes-context-diet-baseline \
  --diet-tree /tmp/hermes-context-diet-diet \
  --model /home/decrux/models/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf --provider local --base-url http://127.0.0.1:8080/v1 \
  --context-length 65536 --minimal --reps 5 \
  --out results/live.jsonl
```
