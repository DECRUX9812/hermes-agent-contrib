# Context-Diet Campaign Eval

A local, randomized A/B harness for issue [#95681](https://github.com/NousResearch/hermes-agent/issues/95681).
It measures wire-schema size and runs real provider-backed task cells against clean
BASELINE and DIET worktrees. Each live cell uses a fresh temporary Hermes home;
the harness never writes to a checkout except its result JSONL.

## Exact refs used in the current run

| Arm | Ref |
| --- | --- |
| BASELINE | `4c1f53be10d0fce1d25aee1975e5149b6c54f25a` |
| DIET | `790e1eb6bd576261e6b9e70fcfe4fbdf17f866bb` |
| BROWSER | `b03b3a69342c2da5303f90159d59c5fcf1c5f7ad` |

The BASELINE ref is the declared base of the first campaign PR (#94599).
DIET is the latest fetched `origin/main` at benchmark setup. BROWSER is the
head of PR #95620 (`feat/real-profile-cdp`) and is evaluated separately because
it is based on `7a7a371c59…`, not the current upstream tip.

## Run

Use the shared project virtualenv and supply the provider credential through the
normal environment mechanism. The harness does not print or persist it.

```bash
/home/decrux/.hermes/hermes-agent/.venv/bin/python \
  evals/context_diet_campaign/static_schema.py \
  /tmp/hermes-context-diet-baseline > results/static-baseline.json

# Current host's funded local-model mode (minimal real tool loop).
/home/decrux/.hermes/hermes-agent/.venv/bin/python \
  evals/context_diet_campaign/runner.py \
  --baseline-tree /tmp/hermes-context-diet-baseline \
  --diet-tree /tmp/hermes-context-diet-diet \
  --model /home/decrux/models/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf \
  --provider local --base-url http://127.0.0.1:8080/v1 \
  --context-length 65536 --minimal \
  --reps 5 \
  --out results/live.jsonl
```

The runner randomizes cell order with a recorded seed, resumes completed
`(arm, task, rep, model)` cells, retries provider-noise cells identically, and
aborts on infrastructure/configuration failures rather than turning them into
zero-score model results.

## Covered live tasks

- `cronjob`: create, modify/delete, and malformed-schedule recovery.
- `skill_manage`: create, targeted patch, full rewrite, and compatibility update.
- `clarify`: single-question and two-question callback interactions.
- Deferred tools: discovery/invocation and error-hint recovery through the
  tool-search bridge.

The graders are deterministic and read only temporary persisted state, callback
records, tool traces, and final responses. There is no LLM judge in this suite.

## Existing harnesses reused

- `evals/session_search_schema/runner.py`: existing six-task session-search A/B
  harness; use it for session-search rather than duplicating it.
- `evals/compaction/runner.py`: existing compaction recall harness; point it at
  a copied lineage and use one shared question bank for both refs.
- `evals/browser_use/orchestrate.py`: existing browser battery; it needs a real
  Chrome/CDP endpoint and Browser Use CLI.
- `scripts/toolperf_abeval/ab_eval.py`: existing full-agent error-recovery A/B
  harness for terminal/file-style tasks.

## Limitations of the current host run

This host has `cua-driver 0.22.1` but no `DISPLAY`; Chrome, `browser-use`, and
`agent-browser` are absent. The local llama-server exposes Qwen3.5-4B but
enforces a 4096-token context; the temporary Hermes `context_length` override
does not change that server limit. Therefore real GUI/browser cells and
long-context local cells remain blocked, while short minimal tool cells and
deterministic contracts can run. A blocked cell is never reported as a
successful or failed model trial.

Long-context compaction recall requires a configured auxiliary provider and a
copied long lineage transcript. Do not point it at a live `state.db`.

## Report generation

```bash
/home/decrux/.hermes/hermes-agent/.venv/bin/python \
  evals/context_diet_campaign/report.py \
  --live results/live.jsonl \
  --static results/static.json \
  --compaction results/compaction-baseline.json \
  --session-search results/session_search.jsonl \
  --out results/decrux_ab_report.md \
  --comment-out results/issue_95681_comment_draft.md \
  --baseline-sha 4c1f53be10d0fce1d25aee1975e5149b6c54f25a \
  --diet-sha 790e1eb6bd576261e6b9e70fcfe4fbdf17f866bb \
  --browser-sha b03b3a69342c2da5303f90159d59c5fcf1c5f7ad \
  --model /home/decrux/models/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf \
  --provider local \
  --reps 5
```

The issue comment is deliberately written to a local draft file only. No commit,
push, PR, or GitHub comment is performed by these commands.
