# HANDOFF: fork sync onto upstream, then hermes-ux-plan

Read this first. It is the complete state of the work as of 2026-10-13. Detailed onboarding
inventory and verification checklist: `ONBOARDING_PORT.md` (section 6 is the running port log).

## 1. Goal

Sync the fork `DECRUX9812/hermes-agent-contrib` onto `NousResearch/hermes-agent` `main` so the
fork **builds on top of upstream**:

- Upstream architecture wins. Where upstream rewrote a subsystem, the fork's version is dropped
  and the fork's behaviour is re-ported onto upstream's API.
- Fork-only features are ported on top: as upstream-style RPCs under a `fork.*` namespace
  (e.g. `fork.onboarding.*`), as plugin hooks, or in `src/fork/` / a plugin package on desktop.
- Fork-only code stays isolated. Edits to upstream core files are minimised and each one is
  logged under "Core touchpoints" in `SYNC_REPORT.md`.
- After the sync is green: execute `hermes-ux-plan.pdf` (Phase 0 quick wins, Phases 1-6, one
  branch `ux/phase-N` per phase, screenshots in `docs/ux-progress/`, running `PROGRESS.md`).
  **The PDF was not found at any path checked in this session** (`/home/decrux/Code/hermes-webapp`,
  `/home/decrux/Code/hermes-nous-sync`, `~/Downloads`, depth 4). Ask the user for its location
  before starting Phase 0.

## 2. Branches, worktrees, refs

| Item | Value |
|---|---|
| Sync worktree | `/home/decrux/Code/hermes-nous-sync` |
| Sync branch | `sync/nous-2026-10-13` |
| Fork remote | `fork` = `https://github.com/DECRUX9812/hermes-agent-contrib.git` |
| Upstream remote | `upstream` = `https://github.com/NousResearch/hermes-agent.git` |
| **`origin` remote** | **Points at NousResearch upstream, not the fork. Do not push to `origin`.** Push to `fork`. |
| Upstream SHA merged | `601b550b4b5addecc0b6dacf9a472a54dd8c6799` (`MERGE_HEAD` during the merge) |
| Merge base | `46d7718a52` |
| Fork HEAD before the sync commit | `fd16d50fee` (`feat(desktop): consensus voting cards for team decisions`) |
| Sync WIP commit | `3c77cf762c` (`WIP: sync fork onto upstream main 601b550b4b (not green yet)`), merge closed, on `fork/sync/nous-2026-10-13` |
| Backup branch | `backup/pre-sync-2026-10-13` = `4e05564517`, on `fork` remote as well |
| Backup tag | `pre-sync-2026-10-13` = `ea08c2e1e0` (commit object), on `fork` remote |
| Stale local main | `main` at `8ac5c74432`; the live install at `/home/decrux/.hermes/hermes-agent` tracks it. Changing it needs the user's go-ahead. |

Other worktrees with unsaved work (do not touch without asking): `hd-wt/catchup-1003` (1849
files), `hermes-product-convergence` (40), `hermes-bot-mode-product` (11), `pr150-test` (12),
`factory/77212add` (25), loose files in `hermes-webapp` (5). `devloop/sandbox/` holds secrets
(`state.db`, `auth.lock`, `secure-token-storage.json`): never commit it.

## 3. Decisions made and why

- **Upstream onboarding is the base.** `setup_beat`, `onboarding.start/skip/set_run/state`,
  `agent/onboarding*.py`, `hermes_cli/onboarding_run.py`, `onboarding_due.py`, and
  `store/setup-beat.ts`, `store/onboarding-run.ts`, `store/onboarding-phase.ts`,
  `store/onboarding-session.ts` are upstream's. The user explicitly chose this ("take upstream's
  onboarding system as the base").
- **Fork onboarding moves to `fork.onboarding.*`.** Its RPC names (`onboarding.ensure_setup_profile`,
  `onboarding.state` with a different shape, `onboarding.reset_setup_profile`, ...) collide with
  upstream's `onboarding.state`, so they are renamed. Python side is done for F04-F09 (see §4).
- **Retired names stay retired.** `setup_choose` and `start_chat` are in
  `RETIRED_TOOL_NAMES` (`hermes_cli/observability/shared_metrics_contract.py:161`). Fork behaviour
  using them is re-expressed as `setup_beat` steps and a `fork.start_chat` RPC/tool.
- **Locale files: full union, never `--ours` or `--theirs`.** Every upstream key and every fork
  key must be present in `en`, `ar`, `ar_settings`, `ja`, `ru`, `zh-hant`, `zh-hant_settings`,
  `zh`, plus `overlay-gaps.json`. Regenerate `apps/desktop/locales/_keys.desktop.json` after.
- **Per-file rules for the ~70 fork-kept files** (decision logged per file in `SYNC_REPORT.md`
  as *took upstream* / *ported* / *kept fork + why*):
  1. Fork copy is an older copy of an upstream file, or upstream rewrote the architecture: take
     upstream.
  2. UI-heavy files (pane-shell, `use-session-actions`, room/Bots/sidebar): keep the fork's
     behaviour, rebuilt on upstream's current APIs. Do not revert to fork's old structure.
  3. `web_server` facade: upstream, with fork routes re-added as an extension module.
  4. Uncertain: keep both and mark the spot `// SYNC-REVIEW:` (Python: `# SYNC-REVIEW:`).
- **`ONBOARDING_PORT.md` before any deletion.** It inventories fork behaviours F01-F21 and
  screens/copy S01-S19 with coverage status. Nothing is deleted without an inventory entry.

## 4. Done so far

Python / gateway:
- Restored upstream `tui_gateway/methods_onboarding.py` and contract modules `contracts/sessions.py`,
  `events.py`, `server_requests.py`, `profiles_vault_complete_foreign_subagents.py`.
- Removed fork-only `tui_gateway/methods_start_chat.py`, `tui_gateway/start_chat.py`,
  `tools/start_chat_tool.py`, `tools/setup_choose_tool.py` (recoverable from `HEAD`).
- `tui_gateway/server.py`: import + register loop reconciled (`_methods_fork_onboarding` added to both);
  `_LONG_HANDLERS` has `onboarding.start`, `onboarding.state`, and the three `fork.onboarding.*`
  I/O RPCs; `_TOOL_LIFECYCLE_UI_TOOLS` matches upstream plus `create_visualization`.
- **New** `tui_gateway/methods_fork_onboarding.py`: `fork.onboarding.ensure_setup_profile`,
  `ensure_setup_session`, `state`, `record_failed_start`, `mark_seen`, `reset_setup_profile`
  (ports F04-F09). Verified registered, no collision with `onboarding.*`.
- Gateway contract regenerated: `apps/shared/src/gateway-contract.generated.ts` and
  `.openrpc.json` (no `SetupChooseKind` / `start_chat` left in the TS).
- `agent/initiate_setup_facts.py`: Spark check uses upstream `products.nvidia_platform()`
  (upstream removed `is_nvidia_arm_soc`). Core-ish: logged under Core touchpoints.
- `hermes_cli/profiles.py` (**core touchpoints**): restored the `clear_named_profile_deleted`
  import from `hermes_constants` (was a `NameError` on profile delete) and the fork constant
  `SETUP_PROFILE_MARKER = ".setup-profile.json"` (HEAD `hermes_cli/profiles.py:111`).

Verified green (run via `scripts/run_tests.sh`):
- `tests/hermes_cli/test_onboarding_run.py`
- `tests/tui_gateway/test_onboarding_run_rpc.py`
- `tests/hermes_cli/test_setup_profile_answers.py`
- `tests/agent/test_onboarding*.py`, `test_setup_beat_card_round.py`, `tests/hermes_cli/test_onboarding_due.py`
  (these passed in the 124-test batch; re-verify after the sync commit)

## 5. Open items (ordered checklist)

- [ ] **1. `/initiate-setup` home.** Slash builtin was in fork `methods_onboarding.py` (`_cmd_initiate_setup`),
      dropped by the upstream restore. `methods_tools._SLASH_BUILTINS` in upstream has no entry.
      Decide: re-register from `methods_fork_onboarding.py` via a registry hook, or a
      `fork.onboarding.initiate_setup` RPC plus a desktop caller. `prompt_turn.py` in the fork
      still imports `agent.initiate_setup_prompt.initiate_setup_prelude`; check that path.
- [ ] **2. Rebuild F01 `setup_choose`** as `setup_beat` steps (nine kinds, 12-option cap, skip ladder,
      follow-up, handoff). Source: HEAD `tools/setup_choose_tool.py` (348 lines).
- [ ] **3. Rebuild F02/F03 `start_chat`** as `fork.start_chat` (title cap 40, from_setup, retry,
      mark_completed) and the start-chat handoff card (starting / retry / superseded / open / failure).
      Source: HEAD `tui_gateway/start_chat.py`, `methods_start_chat.py`, `tools/start_chat_tool.py`.
- [ ] **4. Remaining retired-name references** (grep `setup_choose|start_chat|SetupChoose|StartChat`):
  - `agent/initiate_setup_prompt.py` (lines 51, 88, 110-121: `setup_choose` tool checks/cards)
  - `agent/initiate_setup_facts.py` (docstrings and the `start_chat` machine line, ~line 304)
  - `agent/first_task_prompt.py` (line 3 docstring)
  - `hermes_cli/setup_profile.py:28` `_SETUP_TOOLSETS = ["setup", "start_chat", "connections", "no_mcp"]`
  - `run_agent.py:260` and `agent/agent_init.py:2354` `setup_choose_callback` (marked `# SYNC-REVIEW`):
    remove if F01 moves to setup_beat, or port onto `setup_beat_callback`.
  - `agent/agent_init_params.py:30` lists `setup_choose_callback`.
- [ ] **5. Stale fork tests** that reference fork names, to port to `fork.onboarding.*` or setup_beat or delete with a logged reason:
  `tests/tui_gateway/test_first_contact_onboarding.py`, `tests/hermes_cli/test_stream_json.py`,
  `tests/hermes_cli/test_tui_first_run_routing.py`, `tests/tools/test_setup_choose_name_card.py`
  (currently **collection error**: imports deleted `setup_choose_tool`), `tests/agent/test_onboarding.py`.
- [ ] **6. Profile delete race failure:** `tests/tui_gateway/test_profiles_list_delete_race.py::test_concurrent_profile_use_cannot_restore_retired_name`
  (2s `finishing.wait` timeout). Not investigated against HEAD yet. Check whether the fence code in
  `hermes_cli/profiles.py` (upstream `profile_lifecycle` imports) is complete after the merge.
- [ ] **7. Missing `ProfileDB.get_session_model_config_value`:** `session.delete` with params fails
  with 5036 (`tests/tui_gateway/test_tui_gateway_server.py::test_session_delete_honors_params_profile_sessions_dir`
  and others). A fork DB method was likely lost in the merge. Compare `hermes_state*.py` and the
  `ProfileDB` class in HEAD vs MERGE_HEAD.
- [ ] **8. `tests/tui_gateway/contracts/test_generated.py`** failed in the earlier batch. Re-run after
  the contract regeneration; if it asserts the generated files, the regenerated output is the truth.
- [ ] **9. Desktop typecheck:** `cd apps/desktop && npm run typecheck`. Last known: **77 errors across 40 files**
  (setup-beat.ts 9, onboarding-run.ts 5, plus fork files importing deleted modules). Not re-run since.
- [ ] **10. Desktop port of fork onboarding UI:** keep the look and copy (S01-S19), drive upstream state
  (`onboarding.state` / `onboarding.start` / `onboarding.skip` / `onboarding.set_run`), and rename fork's
  desktop calls to `fork.onboarding.*`. Move hardcoded English into i18n (S12, S13, S16).
  Fork-only desktop files to move under `apps/desktop/src/fork/` or a plugin: `store/onboarding-gate.ts`,
  `onboarding-answers.ts`, `onboarding-intro.ts`, `onboarding-plugins.ts`, `onboarding-presence.ts`,
  `onboarding-scope.ts`, `start-chat.ts`, `onboarding.ts`; `app/contrib/onboarding-kickoff.ts`,
  `onboarding-kickoff-machine.ts`, `hooks/desktop-onboarding-metrics.ts`; `components/onboarding-chat/*`;
  `components/onboarding/{index,flow,providers,free-tier-setup-notice,glyph}.tsx`;
  `components/assistant-ui/clarify/setup-pickers.tsx`; `components/assistant-ui/start-chat-tool.tsx`;
  `lib/onboarding-enabled.ts`; `i18n/en_onboarding.ts`, `types_onboarding.ts`; `electron/guest-onboarding.ts`
  (decide `stay_alive`, F18); `ui-tui/src/app/setupHandoff.ts` (F19); e2e `onboarding.spec.ts`,
  `core/onboarding-first-chat.spec.ts`.
- [ ] **11. Locale union** for all nine locale files and `overlay-gaps.json` (see §3). Current state
  was merged with `--ours` earlier; redo as a union. Then `node apps/desktop/scripts/i18n-keys.mjs`.
- [ ] **12. Per-file pass over the other ~70 fork-kept files** with a SYNC_REPORT.md decision for each.
  Known ones: `web_server` facade, `use-session-actions/{index,create,create-overrides}.ts`,
  `pane-shell/tree/store.ts` + `store-panes.ts` (anchorsFirst ported), `command-palette/index.tsx`,
  `contrib/wiring.tsx`, `components/assistant-ui/thread/user-message.tsx`, `lib/chat-messages/tool-parts.ts`,
  `sdk/index.ts`, `about-settings.tsx`, `themes/context.tsx`, `hermes-bots/i18n.ts`,
  `website/docs/developer-guide/desktop-plugin-sdk.md`, `.github/workflows/desktop-bundled-release.yml`,
  `apps/desktop/package-lock.json`.
- [ ] **13. Write `SYNC_REPORT.md`:** per-file decision log plus a "Core touchpoints" section (currently
  missing: at least `hermes_cli/profiles.py`, `agent/initiate_setup_facts.py`, `tui_gateway/server.py`,
  `toolsets.py:153`, `agent/agent_init.py`, `run_agent.py`).
- [ ] **14. Full checks** (all must be green before merging to main):
  `python scripts/check` (lint), `cd apps/desktop && npm run lint && npm test && npm run build`,
  `scripts/run_tests.sh tests/tui_gateway/ tests/agent/ tests/hermes_cli/ tests/tools/` (no bare pytest),
  and smoke tests: first-run onboarding, reset onboarding, chat, rooms, Bots.
- [ ] **15. Tick every item in `ONBOARDING_PORT.md` section 5 only after it is verified** (currently all unticked).
- [ ] **16. Merge to main** only when 14 and 15 are done, with a rebase onto current `main` first
  (a squash from a stale branch silently reverts newer fixes). Ask the user before merging.
- [ ] **17. UX plan** (after the sync): read `hermes-ux-plan.pdf` (location unknown, see §1), Phase 0
  quick wins, then Phases 1-6 each on `ux/phase-N`, screenshots in `docs/ux-progress/`, `PROGRESS.md`.
  Plan-vs-reality notes: repo is `/home/decrux/Code/hermes-webapp`, not `/workspace/hermes-fork`;
  the room UI is pushed to `fork/claude/cool-cannon-cx2rw7`; the conflict count was 50 files, not 151.

## 6. Setup and check commands

```bash
# Worktree
cd /home/decrux/Code/hermes-nous-sync
git status --short | head

# Python env (provisions the PM environment; prints "Tools + dependencies installed")
scripts/run-in-hermes-env python3 -c "import tui_gateway.server, tui_gateway.contracts; print('ok')"

# Gateway contract regeneration (writes apps/shared/src/gateway-contract.generated.ts and .openrpc.json)
scripts/run-in-hermes-env python3 scripts/gen_gateway_contracts.py

# Python tests: always scripts/run_tests.sh, never bare pytest. Run in background if long (>10 min).
scripts/run_tests.sh tests/agent/test_onboarding.py tests/hermes_cli/test_onboarding_run.py \
  tests/tui_gateway/test_onboarding_run_rpc.py tests/hermes_cli/test_setup_profile_answers.py -q

# Full Python suite for the touched areas
scripts/run_tests.sh tests/tui_gateway/ tests/agent/ tests/hermes_cli/ tests/tools/

# Lint (all blocking checks CI runs)
scripts/check

# Desktop (node: export PATH="$HOME/.hermes/tools/node-26.7.0-linux-x64/bin:$PATH")
cd apps/desktop && npm ci
npm run typecheck      # tsc -p . && tsconfig.electron && tsconfig.e2e && electron-builder config
npm run lint
npm test               # vitest run
npm run build          # node scripts/build.mjs
node scripts/i18n-keys.mjs   # regenerates locales/_keys.desktop.json from src/i18n/en.ts
```

Status at hand-off (last run per check):

| Check | Status |
|---|---|
| Upstream onboarding/run/RPC tests (4 files) | **green** after fixes |
| `tests/agent/test_onboarding*` batch | green in the 124-test batch; re-verify |
| `tests/tui_gateway/test_profiles_list_delete_race.py` | **1 failing** (concurrent use) |
| `tests/tui_gateway/test_tui_gateway_server.py::test_session_delete_honors_params_profile_sessions_dir` | **failing** (ProfileDB method missing) |
| `tests/tools/test_setup_choose_name_card.py` | **collection error** (deleted module) |
| `tests/tui_gateway/contracts/test_generated.py` | failing in an earlier run; re-verify after regen |
| `tests/tui_gateway/` full (no `-x`) | **not run** |
| `scripts/check` | **not run** on the sync tree |
| `npm run typecheck` | **last known 77 errors** (not re-run) |
| `npm run lint`, `npm test`, `npm run build` | **not run** |
| Smoke tests (onboarding, reset, chat, rooms, Bots) | **not run** |

## 7. Gotchas

- **The merge drops fork constants and imports silently.** Clean three-way merges removed
  `SETUP_PROFILE_MARKER`, `clear_named_profile_deleted`, and the `start_chat` contracts without
  conflict markers. After any merge, grep for every name the fork's tests and modules use
  (`git grep -n <name> HEAD -- <path>` vs the working tree) instead of trusting a clean merge.
- **Upstream deleted what it replaced.** Upstream removed `methods_onboarding.py` RPCs and the
  `hermes_platform` `is_nvidia_arm_soc`. Fork callers fail at import or first call, not at merge time.
- **Sort comparisons need `LC_ALL=C`** (i18n key ordering, `_keys.desktop.json` generation). Without
  it, the key order and the diff noise change between machines.
- **A union merge broke `previewVerify`** on an earlier attempt (reported by the user; re-check the
  preview verification path after any locale or desktop merge).
- **Locale `--ours` silently drops upstream keys.** Always union. The WIP commit fixed duplicate `connectors` keys in `ar.ts` and `zh-hant.ts` (merged into one object) and spread `enConnectorCard` / `zhConnectorCard` into `en.ts` / `zh.ts`.
- **`eslint --fix` on the whole desktop tree touched ~30 files** (import order, curly, unused imports). Behaviour-preserving, but review them in the per-file pass.
- **Lefthook pre-commit needs `ruff` and `npx` on PATH.** Without them the hook fails (exit 127) and the commit does not happen. Use `export PATH=<scratchpad>/lintenv/bin:$HOME/.hermes/tools/node-26.7.0-linux-x64/bin:$PATH` (ruff 0.15.10). Lint errors in desktop (`eslint`, 0 errors left after the WIP commit, 272 warnings) and Python (`ruff check --config ruff.pre-commit.toml`) block commits.
  Put the pinned ruff (0.15.10, `scratchpad/lintenv`) on PATH before committing, or the hook may pass vacuously.
  Never use `--no-verify`.
- **`origin` is NousResearch.** Pushing there is wrong for this work; use `fork`.
- **Facade + sibling layout.** Fork files like `use-session-actions/index.ts` and `pane-shell/tree/store.ts`
  are facades. Port behaviour into the sibling, not the facade. Upstream keeps monoliths; do not
  copy the facade shape back into upstream files.
- **Patch where production reads** (Python). Tests that patch the defining module pass silently when
  the sibling imports from the facade.
- **No `sleep` in tool calls** longer than the tool policy allows. Use background tasks and notifications.
- **`tsc` takes more than 120s.** Run it in the background and read the output file.
- **Do not touch** `devloop/sandbox/`, `apps/desktop/dist-webapp-backup-oct02/`, or the dirty worktrees in §2.

## 8. Rules

- Never merge to `main` until every check in §5 item 14 is green and the user agrees.
- Never force-push. Never `git stash` bare; set work aside with a WIP commit or
  `git stash push -u -m <tag>`.
- Ask the user before deleting a user-facing feature without a replacement, changing stored data
  formats without migration, or doing any destructive git operation.
- Commits end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`. PR bodies end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. No model identifiers in commits or PRs.
- Only create a PR when the user asks for one.
- Take upstream only for core code the fork has not meaningfully changed; otherwise port the
  fork's behaviour onto upstream's API and log it.

## 9. Pointers

- `ONBOARDING_PORT.md`: fork behaviour inventory (F01-F21), screens and copy (S01-S19), upstream
  capabilities, verification checklist (section 5, unticked), port log (section 6).
- `SYNC_REPORT.md`: not yet written. Required by §5 item 13.
- `AGENTS.md` (repo root) and the area `AGENTS.md` files: the upstream rules for contributions,
  facade layout, profile scope (`gateway/AGENTS.md`), tests (`tests/AGENTS.md`), and the desktop
  TypeScript conventions.
