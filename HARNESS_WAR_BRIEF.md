# Hermes Bot Mode Product Convergence — Harness War Brief

## Mission

Converge the last two weeks of Bot Mode, Hermes Squad, Mission prototype, Workbench research, archived-plugin, and Desktop UX work into **one coherent, upstream-quality Hermes product** based on current `NousResearch/hermes-agent` `origin/main`.

The goal is not to preserve every prototype. The goal is to ship the smallest set of real improvements that makes Hermes feel like a trustworthy, polished AI coworker for this user and for upstream users.

## Product hierarchy

```text
Hermes Desktop
  ├── Chat: the primary relationship and steering surface
  ├── Projects: workspace/cwd authority
  ├── Bots: named profile roster — who does the work
  ├── Tasks/Activity: honest progress and attention, only where backed by durable truth
  └── Panes: Browser, Computer, Files, Review, Terminal — contextual work surfaces

Bot → user request → existing Hermes session/delegation/kanban execution → verified result
```

A **Bot is a Hermes profile**. A bot row always opens the one canonical `(profile, session titled exactly "Bot Chat")` forever-chat. Do not reintroduce session-id pins, recency selection, per-bot embedded session browsers, or side-chat adoption.

Execution harness names, runtime ids, raw ACP details, process ids, and backend internals stay in diagnostics. They do not become the normal product vocabulary.

## Current authoritative base

- Worktree: `/home/decrux/Code/hermes-product-convergence`
- Branch: `feat/bots-product-convergence`
- Base: `origin/main` at `4621a2d699daeaa92efb93dae9db076308cbe823`
- Bundled Bot Mode: `apps/desktop/src/plugins/hermes-bots/`
- Root rules: `AGENTS.md`, especially Bot Mode lines 923–987
- Desktop architecture: `apps/desktop/AGENTS.md`
- Desktop design contract: `apps/desktop/DESIGN.md`

## Evidence sources to inventory, not blindly merge

1. Current bundled Bot Mode on `origin/main` — the only implementation base.
2. Archived standalone plugin at `/home/decrux/.hermes/desktop-plugins/hermes-bots`, branch `pr56-vr`, commit `72e6e80` — source of control-surface and guardrail ideas, not a merge target.
3. Hermes Squad prototype at `/home/decrux/Code/hermes-squad`, branch `demo/contact-sheet`, commit `f69100a` — source of verified UX, performance, routing, attention, and demo findings; it is a separate web app, not upstream architecture.
4. Mission/Bot Mode prototype at `/home/decrux/Code/hermes-final-merge2` — source of contracts and acceptance evidence only; it is thousands of commits divergent and not a cherry-pick target.
5. Workbench V2 research at `/home/decrux/.hermes/projects/workbench-v2/` — source of information-architecture ideas only. Current upstream Desktop explicitly remains chat-first; no shell rewrite or speculative `bot.*`/`task.*` platform is authorized in this pass.
6. Consolidated swarm findings at `/home/decrux/Code/hermes-squad/sprint/SWARM-FINDINGS.md`.
7. Historical PRs: merged `hermes-agent#87886`; archived-plugin PRs `#56` and `#106`.

## Hard constraints

- Preserve current upstream behavior and contributor authorship where code can be salvaged.
- Do not modify the live installed checkout, gateway, packaged Desktop, user config, real profiles, sessions, crons, or plugin storage during investigation/build.
- Work only in the convergence worktree until a fully verified candidate exists.
- No fake/demo presence, progress, tasks, replies, citations, or success states.
- No second scheduler, Mission engine, task database, event bus, connection registry, or execution harness abstraction.
- Renderer owns presentation only; backend owns shared truth; Electron owns machine facts.
- Background events may update badges/cache but must never steal focus or navigate.
- Use current Desktop primitives/tokens/i18n; update all locales together.
- Every bug fix needs a behavior regression test. VM tests are necessary but live Desktop proof is a separate gate.
- No upstream push/PR until local gates and live acceptance pass.

## Desired product outcomes

1. **Five-second attention answer:** with several bots active, the user can see who is working, waiting, failed, paused, or needs them — without opening three surfaces. Status precedence must be centralized and truthful.
2. **Reliable Bot setup:** New Agent results in a usable profile, canonical Bot Chat, model/config readiness, and stable Bot Mode messaging protocol without requiring hand-edited SOUL files.
3. **Team awareness without prompt-cache breakage:** bots discover the current roster and teammate capabilities/status on demand from authoritative APIs/CLI. Never inject a mutable roster into a long-lived system prompt. Static protocol may explain how to discover and message teammates; dynamic roster/work state stays out of the cached prompt.
4. **Human bot-to-bot flow:** handoffs, group chat, open loops, failures, and replies have clear attribution and completion semantics. No parallel-monologue masquerading as collaboration.
5. **Calm, premium UX:** flat hierarchy, existing tokens/primitives, strong empty/error/reconnect states, keyboard-first, reduced motion, no card-in-card dashboard slop.
6. **Fast under real load:** realistic multi-bot/session data, bounded rendering, no polling storms, no stale-response clobbering.
7. **Contributor-ready delivery:** small coherent commits/PR slices, current-main tests/build, exact before/after evidence, no prototype archaeology in the final user experience.

## Initial swarm lanes (read-only investigation first)

- A — provenance and branch/commit inventory
- B — current bundled Bot Mode correctness and UX audit
- C — archived-plugin delta/security salvage audit
- D — Hermes Squad finding/code salvage map
- E — Mission prototype salvage/rejection map
- F — Workbench/frontend research reality-check against current Desktop contracts
- G — Bot setup, roster discovery, teammate-awareness, and prompt-cache-safe protocol audit
- H — automated baseline: plugin tests, Desktop typecheck/lint/build feasibility
- I — accessibility/performance/visual-system audit
- J — upstream duplicate/PR slicing and contributor strategy

Investigators modify no files. The parent consolidates their evidence into ranked implementation cells. Writer cells receive strict file ownership only after the ranked plan is complete.

## Acceptance gate

A candidate is not done until all are true:

- focused regression tests pass;
- full bundled Bot Mode suite passes;
- Desktop typecheck/lint/build pass;
- diff-check and source-contract checks pass;
- isolated current-source Desktop launches with a separate app identity/home;
- real Bot setup/open/chat/handoff/attention/reload flows are exercised without touching the user's live state;
- screenshots/contact sheet prove the main states, with no fixture presented as live;
- final report lists exact files, commits, tests, live evidence, remaining limits, and upstream-ready PR boundaries.
