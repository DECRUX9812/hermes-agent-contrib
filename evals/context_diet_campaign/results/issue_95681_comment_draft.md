## Context-diet A/B evidence (local draft; not posted)

I ran a randomized short-tool A/B suite against exact refs:
- BASELINE `4c1f53be10d0fce1d25aee1975e5149b6c54f25a` (pre-campaign base of #94599)
- DIET `790e1eb6bd576261e6b9e70fcfe4fbdf17f866bb` (fetched upstream `main`)
- BROWSER `b03b3a69342c2da5303f90159d59c5fcf1c5f7ad` (#95620 head; static/contracts only)
- Upstream later advanced to `791e2ae325…` after this frozen run; that 57-file/9,069-line change was not measured.
- Live provider/model: `local` / `/home/decrux/models/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf`; `5` repetitions per task/arm; 8 tasks, 80 total cells.

Results:
- Quality: BASELINE 40/40, DIET 40/40; no malformed tool calls.
- Live total tokens: BASELINE 217,599, DIET 167,909; delta -49,690 (-22.8%).
- Mean wall time: BASELINE 47.38s, DIET 40.40s; delta -6.98s.
- Static measured subset + computer-use prompt component: BASELINE 11,349, DIET 4,778; delta -6,571 (-57.9%). This excludes the conditional Nous entitlement block and counts no billing price.
- Compaction retention: exact refs report legacy 100,000-token tail vs lean 25,000 at a 1M context / 500K threshold; recall was not rerun here.

Session-search reuse: the existing harness was used, but its OpenRouter run stopped after credits exhausted; only 19 non-empty rows are retained as partial evidence, not as a complete n=5 result. Raw partial data: `evals/context_diet_campaign/results/session_search_partial.jsonl`.

Raw local live data: `evals/context_diet_campaign/results/local_live.jsonl`. Full report: `evals/context_diet_campaign/results/decrux_ab_report.md`. Ref/diff artifacts: `evals/context_diet_campaign/results/ref_manifest.json` and `evals/context_diet_campaign/results/diff_audit.md`.

Real GUI/browser and long-context recall cells were blocked by this host (no display/Chrome/Browser Use CLI and no funded compaction provider). No GitHub comment, PR, push, or commit was performed.
