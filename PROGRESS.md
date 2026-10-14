# PROGRESS — sync/nous-2026-10-13

Owner: DECRUX9812. Resume from this file after every restart. Read `HANDOFF.md` and
`ONBOARDING_PORT.md` for the full background; this file is the running state.

## Status at session start (2026-10-13)

- Branch `sync/nous-2026-10-13`; fork remote only (never `origin`).
- `SYNC_REPORT.md` was never written. `PROGRESS.md` created here.
- The sync is a WIP (`3c77cf762c`) on top of upstream `601b550b4b`; **not green**:
  - Desktop `npm run typecheck`: ~77 errors (last known, not re-run).
  - Python: some failing tests (profile delete race; `ProfileDB.get_session_model_config_value`;
    stale fork tests referencing deleted modules).
  - `scripts/check` not yet run on this tree.
- After the sync is green: execute `~/Code/hermes-ux-plan.md` (Phase 0 quick wins, Phases 1–6),
  one task per commit, screenshots in `docs/ux-progress/`.
- Then Phase 7 (interactive generative UI) — see the bottom of this file.

## Plan / checklist

### A. Sync to green
- [x] A1. Re-run desktop typecheck, capture the real error list.
- [x] A2. Fix desktop typecheck errors — i18n keys added (handoffTour, catalogPinned, developerTitle, resetOnboarding*, setupChoose, startChat, securityHeading, gitCloneLabel), core type errors fixed (lifecycle.ts, submit.ts, browser-bridge-stubs.ts, profile-rail-prefs.test.tsx), many @/ imports updated to @/fork/.
- [x] A2b. Fork import rewrite done: 151 tsc errors → 0. All fork modules repointed to `@/fork/...`;
  flattened relative names in `src/fork/components/`; clarify core resolves to upstream
  `@/components/assistant-ui/clarify/core/*`; `StartChatArgs.title` widened to `null | string`;
  fork-subject tests moved next to their subjects (onboarding.test.ts, onboarding-owner.test.ts,
  onboarding-kickoff.test.ts, desktop-onboarding-metrics.test.ts); electron/main.ts imports
  `../src/fork/electron/guest-onboarding` (added to tsconfig.electron.json include).
- [x] A4. Fix `ProfileDB.get_session_model_config_value` (added to test mock in test_tui_gateway_server.py).
- [x] A5. Fix profile-delete race test (timeout in test_profiles_list_delete_race.py).
  Root cause (verified, not a product bug): `rename_profile` probes gateway
  liveness + drains profile resources before reaching `_finish_profile_rename`
  (measured 1.6–3.2s, varies with load); the fork-only test's
  `finishing.wait(timeout=2)` was too tight. Raised to event-based 30s bounds
  (`finishing.wait` + both joins). Test passes.
- [x] A2c. Full desktop typecheck verified green 2026-10-14: `tsc -p .`,
  `tsconfig.electron.json`, `tsconfig.e2e.json`, electron-builder config —
  all 0 errors.
- [x] A6. Re-run `tests/tui_gateway/` full (no `-x`).
  First full run 2026-10-14: 2782 passed, 32 failed across 14 files. All triaged
  to merge fallout, all fixed (see log below); targeted re-runs green per file.
- [x] A7. Regenerate gateway contract; re-run `tests/tui_gateway/contracts/test_generated.py`.
  Declared contracts for 8 registered-but-undeclared methods
  (`fork.onboarding.*` ×6 in new `tui_gateway/contracts/fork_onboarding.py`,
  `session.ask` + `session.predict_next` in `contracts/sessions.py`), restored
  fork's `bot_topic`/`team_room`/`team_room_lead` + `user_originated` fields the
  merge dropped, added `layout.apply` event + `preview.verify` server request.
  Regenerated TS + OpenRPC; contract test green.
- [ ] A8. `scripts/check` green; `npm run lint`, `npm test`, `npm run build` green.
- [ ] A9. Write `SYNC_REPORT.md` (per-file decisions + Core touchpoints).
- [x] A10. Locale union pass + `i18n-keys.mjs`.
  `locales/_keys.desktop.json` was stale vs `src/i18n/en.ts`; regenerated
  (+46 keys). en.ts already a union (67 top-level keys vs upstream 52).

### B. UX plan (`~/Code/hermes-ux-plan.md`)
- [x] B0. Read the plan; listed 3 quick wins and Phase 1–6 tasks.
  - Quick wins: 1) Stop rooms interrupting + sentinel filter, 2) Calm chrome (Simple mode, tier:advanced), 3) Recap card in-flow.
  - Phase 1: 10 tasks (1.1-1.10) — reliability guardrails, calm shell.
  - Phase 2: 10 tasks (2.1-2.10) — IA consolidation.
  - Phase 3: 9 tasks (3.1-3.9) — conversation surface, inline cards.
  - Phase 3: 9 tasks (3.1-3.9) — conversation surface, inline cards.
  - Phase 4: 7 tasks (4.1-4.7) — design system enforcement.
  - Phase 5: 7 tasks (5.1-5.7) — rooms v2, computer panel, background tasks.
  - Phase 6: 6 tasks (6.1-6.6) — onboarding, telemetry, upstream reconciliation.

### C. Phase 7 — Interactive answers (generative UI)
- [ ] C1. Declarative component schema + ` ```hermes-ui ` fenced-block parser (Python + TS).
- [ ] C2. Sandboxed renderer under `src/fork/` (desktop + web), markdown fallback.
- [ ] C3. Button/form interactions send a structured follow-up message.
- [ ] C4. System-prompt hint + example.
- [ ] C5. Parser + renderer tests.
- [ ] C6. Demo screenshot in `docs/ux-progress/`.
- [ ] C7. Add `PHASE7_DONE` to PROGRESS.md.

## Blockers / needs owner

- Fork onboarding integration: main codebase imports fork onboarding stores from old paths; fork directory internal imports broken due to file renaming during move to `src/fork/`. Requires either restoring original fork directory structure or updating all imports.
- Profile delete race test timeout (test_profiles_list_delete_race.py::test_concurrent_profile_use_cannot_restore_retired_name) — known issue, needs investigation.

## Log

- Session start: read HANDOFF.md / ONBOARDING_PORT.md / .oc-prompt.txt; created PROGRESS.md.
- Fixed all i18n type errors: added missing keys to types and locale files (handoffTour, catalogPinned, developerTitle, resetOnboarding*, setupChoose, startChat, securityHeading, gitCloneLabel).
- Fixed core type errors: lifecycle.ts (normalizeProfileKey cast), submit.ts (createBackendSessionForSend param order), browser-bridge-stubs.ts (getBranch/setBranch in updates type), profile-rail-prefs.test.tsx (changeSessionCwd mock).
- Updated ~47 main codebase files to import fork onboarding from @/fork/ paths.
- Python tests: upstream onboarding tests PASS (test_onboarding_run.py, test_onboarding_run_rpc.py, test_setup_profile_answers.py).
- Fixed ProfileDB mock in test_tui_gateway_server.py (added get_session_model_config_value).
- test_session_delete_honors_params_profile_sessions_dir now PASSES.
- Remaining: fork onboarding import resolution, profile delete race test, gateway contract, full test suite runs.
- 2026-10-14: verified desktop typecheck fully green (main + electron + e2e +
  electron-builder configs, 0 errors). A5 fixed (test-only timeout bump, passes).
  Committed fork onboarding port (A2b) + A5 fix as separate commits; pushed to fork.
- 2026-10-14 (cont.): A7 done — contract test green after declaring 8 missing
  method contracts + layout.apply/preview.verify; regen clean. A6 triage done:
  32 failures = merge fallout in 6 classes, all fixed and re-verified per file:
  (1) dropped fork contract fields (bot_topic/team_room/user_originated);
  (2) upstream rename `_session_default_model`→`_session_default_route` broke a
  fork test patch; (3) resume lambdas missing 3rd incarnation arg;
  (4) merge hybrid `_profile_workspace_cwd` vs upstream `_profile_default_cwd`
  in resume repair (took upstream's line); (5) profiles.list fence needs
  Path.home isolation in 3 fork fixtures; (6) stale test fakes (acquire kwarg,
  kanban mock home). compute_host timeout was flaky (passes alone).
  A10 done (keys regen). Remaining: A8 (scripts/check, npm lanes, desktop
  build), A9 (SYNC_REPORT.md), then full-suite re-run to confirm zero.

(End of file - total 150 lines)
- 2026-10-14 (sync 2): `git fetch upstream --tags`; merged tag `v0.22.0` (`e06df9c2ea`)
  with `--no-ff` (no rebase). Delta since sync 1 = 2 upstream commits, 4 test/e2e files,
  0 conflicts, no fork file touched. Desktop `npm run typecheck` 0 errors, `npm run build`
  green, `vitest --project ui` 1459/1460 files green (pre-existing upstream-identical
  `voice-prefs.test.ts` env failure, see SYNC_REPORT "Sync 2"). Real app smoke via the
  launch-video capture: onboarding chat (name, accent, layout steps), Home, streamed
  markdown answer, clarify card, manual approval, Bots (New bot, New group chat, room
  reply), right-sidebar Panels presets, layout editor — all working.
