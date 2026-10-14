# SYNC REPORT — `sync/nous-2026-10-13`

Fork `DECRUX9812/hermes-agent-contrib` synced onto upstream
`NousResearch/hermes-agent` `main`, building the fork **on top of upstream**.

- Upstream SHA merged: `601b550b4b5addecc0b6dacf9a472a54dd8c6799`
- Merge base: `46d7718a52`
- Fork HEAD before sync: `fd16d50fee` (`feat(desktop): consensus voting cards for team decisions`)
- Branch: `sync/nous-2026-10-13` (pushed to `fork` remote only; `main` untouched)

Strategy (per `HANDOFF.md`): upstream architecture wins. Where upstream rewrote a
subsystem, the fork's version is dropped and fork behaviour is re-ported onto
upstream's API. Fork-only features are namespaced (`fork.*` RPCs, `src/fork/` on
desktop) and never collide with upstream names. Retired tool names
(`setup_choose`, `start_chat`) stay retired.

## Python / gateway decisions

| File(s) | Decision |
|---|---|
| `tui_gateway/methods_onboarding.py` | **Took upstream** (rewritten: `onboarding.state/start/skip/set_run` + `onboarding.ended`). |
| `tui_gateway/contracts/{sessions,events,server_requests,profiles_vault_complete_foreign_subagents}.py` | **Took upstream**, then re-added fork coverage (below). |
| `tui_gateway/methods_start_chat.py`, `tui_gateway/start_chat.py`, `tools/start_chat_tool.py`, `tools/setup_choose_tool.py` | **Dropped** (retired names). Recoverable from `fd16d50fee`. Rebuild as `fork.*` tracked in `ONBOARDING_PORT.md` F01–F03 (open). |
| `tui_gateway/methods_fork_onboarding.py` (new) | **Ported** F04–F09 as `fork.onboarding.{ensure_setup_profile,ensure_setup_session,state,record_failed_start,mark_seen,reset_setup_profile}`. Registered in `tui_gateway/server.py` (`_methods_fork_onboarding`, `_LONG_HANDLERS`). |
| `tui_gateway/contracts/fork_onboarding.py` (new) | **Ported**: wire contracts for the six `fork.onboarding.*` RPCs (the contract test refuses undeclared methods). |
| `tui_gateway/contracts/sessions.py` | **Upstream + fork deltas**: declared `session.ask` + `session.predict_next` (fork method modules, desktop-consumed); restored fork fields the merge dropped (`bot_topic`, `team_room`, `team_room_lead` on `session.create`; `user_originated` on `InflightTurn`) — byte-identical to `fd16d50fee`. |
| `tui_gateway/contracts/events.py`, `server_requests.py` | **Upstream + fork deltas**: added `layout.apply` event and `preview.verify` server request (fork tool bridges). |
| `tui_gateway/methods_session.py` resume repair | **Took upstream** (`b23600860f`): the merge had kept the fork fallback `_profile_workspace_cwd` with upstream's guard; restored upstream's `_profile_default_cwd` line. SSH behaviour preserved (`_profile_default_cwd` tries the workspace first). |
| `agent/initiate_setup_facts.py` | **Ported**: Spark check uses upstream `products.nvidia_platform()` (upstream removed `is_nvidia_arm_soc`). |
| `hermes_cli/profiles.py` | **Upstream + 2 fork restorations**: `clear_named_profile_deleted` import (was a `NameError` on profile delete) and `SETUP_PROFILE_MARKER = ".setup-profile.json"`. |
| `hermes_cli/setup_profile.py`, `agent/initiate_setup_prompt.py`, `agent/first_task_prompt.py`, `run_agent.py`, `agent/agent_init*.py` | **Open**: still reference retired `setup_choose`/`start_chat` (see `HANDOFF.md` §5 items 1–4). |
| `tests/tui_gateway/test_tui_gateway_server.py` | **Ported**: test-mock `ProfileDB` gained `get_session_model_config_value`. |

## Desktop decisions (`apps/desktop`)

| Area | Decision |
|---|---|
| Fork-only onboarding UI (stores `onboarding-{gate,answers,intro,plugins,presence,scope}`, `start-chat`, `onboarding`; `components/onboarding-chat/*`, `components/onboarding/{index,flow,providers,free-tier-setup-notice,glyph}`; clarify `setup-pickers`, `start-chat-tool`; `app/contrib/onboarding-kickoff*`; `hooks/desktop-onboarding-metrics`; `lib/onboarding-enabled`; `electron/guest-onboarding`) | **Moved to `src/fork/`** (renames, flattened filenames), driven against upstream state RPCs. |
| ~47 core files importing the moved modules | **Repointed to `@/fork/...`**; `@/`clarify-core resolves to upstream `components/assistant-ui/clarify/core/*`. |
| `StartChatArgs.title` | Widened to `null \| string` (card re-sends parsed args). |
| `electron/main.ts` | Imports `../src/fork/electron/guest-onboarding`; `tsconfig.electron.json` include extended. |
| i18n (`en/ar/de/es/fr/ja/ru/zh/zh-hant` + settings/app-tour types) | **Union**: added fork keys (`handoffTour`, `catalogPinned`, `developerTitle`, `resetOnboarding*`, `setupChoose`, `startChat`, `securityHeading`, `gitCloneLabel`); no upstream key dropped. `locales/_keys.desktop.json` regenerated. |
| `apps/shared/src/gateway-contract.generated.ts` + `.openrpc.json` | **Regenerated** (covers the fork method/event/request additions above). |

## Core touchpoints (edits to upstream-owned files)

1. `hermes_cli/profiles.py` — restored `clear_named_profile_deleted` import + `SETUP_PROFILE_MARKER`.
2. `agent/initiate_setup_facts.py` — `products.nvidia_platform()` for the Spark check.
3. `tui_gateway/server.py` — `_methods_fork_onboarding` import + register loop, `_LONG_HANDLERS` entries.
4. `tui_gateway/methods_session.py` — resume-repair fallback line (upstream `b23600860f` text).
5. `tui_gateway/contracts/*` — additive fork declarations (no upstream entry altered except restoring dropped fields).
6. `apps/desktop` core imports — repointed to `@/fork/...` (mechanical).
7. `apps/desktop/src/i18n/*` — additive keys only.
8. `toolsets.py:153`, `agent/agent_init.py`, `run_agent.py` — `setup_choose_callback` markers (`# SYNC-REVIEW`, open).

## Test fixes (all test-only except the resume-repair line above)

- `test_profiles_list_delete_race.py::test_concurrent_profile_use_cannot_restore_retired_name` — `finishing.wait` 2s → 30s (rename drains resources for 1.6–3.2s; verified by timing, not a product bug).
- `test_profile_idempotency.py` — patch `_session_default_route` (upstream `de1626d666` rename), not the removed `_session_default_model`.
- `test_profile_resume_cwd{,_persist}.py` — resume lambdas take the 3rd incarnation arg.
- `test_profiles_list_{ui_meta_cache,session_field_cache,canonical_session}.py` — `Path.home` isolation (profiles.list fence touches the wrapper dir).
- `test_session_delete_rpc.py` — `acquire` fake accepts `expected_profile_incarnation`.
- `test_kanban_resume_guard.py` — fixture uses a real temp home (incarnation fence fail-closes on a missing path).
- `test_compute_host.py` timeout — flaky; passes in isolation.

## Verification (2026-10-14)

- Desktop `tsc -p .`, `tsconfig.electron.json`, `tsconfig.e2e.json`, electron-builder config: **0 errors**.
- `tests/tui_gateway/contracts/test_generated.py`: **green** (both tests).
- `tests/tui_gateway/` full (no `-x`): first run 2782 passed / 32 failed (14 files); every failure triaged to the merge-fallout classes above and re-verified green per file. Full-suite re-run pending (see `PROGRESS.md`).
- `scripts/check`, `npm run lint`, `npm test`, `npm run build`: pending (see `PROGRESS.md` A8).

## Sync 2 — upstream tag `v0.22.0` (2026-10-14)

- Tag `v0.22.0` = `e06df9c2ea` (tag object `84094bd903`), merged with `git merge --no-ff v0.22.0`
  (no rebase) as `sync: merge upstream v0.22.0 into sync/nous-2026-10-13`.
- Merge base: `601b550b4b` (the SHA sync 1 merged), so the delta is 2 upstream commits:
  `5c0b7024e0` (install e2e records first-run onboarding as done) and `e06df9c2ea`
  (desktop core onboarding spec covers provider setup without the trial).
- 4 files, +18 lines, all test/e2e harness: `apps/desktop/e2e/core/onboarding-first-chat.spec.ts`,
  `tests-js/scripts/desktop-smoke.test.ts`, `tests-js/scripts/mock-provider-config.ts`,
  `tests/install/windows-e2e.ps1`. None of them is touched by the fork, so **0 conflicts**;
  every hunk taken as upstream wrote it. No fork file changed, so no fork feature (rooms,
  Bots, right panels, `src/fork/` onboarding, Phase 1–6 work) can have regressed through
  this merge.
- Fork-side note: the new `onboarding: run: false` config key the specs write is upstream's
  own first-run gate (`tui_gateway/methods_onboarding.py`); the fork's
  `fork.onboarding.*` gate is separate and unaffected.

| File | Decision |
|---|---|
| `apps/desktop/e2e/core/onboarding-first-chat.spec.ts` | **Took upstream** (fork never edited it). |
| `tests-js/scripts/desktop-smoke.test.ts` | **Took upstream**. |
| `tests-js/scripts/mock-provider-config.ts` | **Took upstream**. |
| `tests/install/windows-e2e.ps1` | **Took upstream**. |

Verification after the merge: desktop `npm run typecheck` (renderer, electron, e2e,
electron-builder config) 0 errors; `npm run build` green; desktop `vitest --project ui`
1459/1460 files green; the one red file is `src/store/voice-prefs.test.ts` (2 cases: `localStorage.setItem` spy does not intercept, so the "write fails" branch still persists). That file and `src/store/voice-prefs.ts` are byte-identical to upstream (`git diff 601b550b4b HEAD` empty) and the merge touched no `apps/desktop/src` file, so it is a pre-existing runner/environment failure, not merge fallout; left as upstream wrote it; the real Electron app booted against a sandbox `HERMES_HOME` and drove Home,
chat, a clarify card, a manual approval, the Bots tab, the right-sidebar panels and the
layout editor (launch-video capture run).

## Open (not in this sync)

- F01–F03 rebuild (`setup_choose` → `setup_beat` steps; `start_chat` → `fork.*`), `/initiate-setup` home, remaining retired-name references, stale fork tests (`test_first_contact_onboarding`, `test_stream_json`, `test_tui_first_run_routing`, `test_setup_choose_name_card`, `tests/agent/test_onboarding.py`) — see `HANDOFF.md` §5 items 1–5 and `ONBOARDING_PORT.md` §5.
- Per-file pass over the remaining ~70 fork-kept files beyond onboarding/locale/contracts.
