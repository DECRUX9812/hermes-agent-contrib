# Handoff: DECRUX9812/hermes-agent-contrib (Oct 1, 2026)

Read this first, then the repo's root `AGENTS.md` and the area `AGENTS.md` for whatever you touch.

## Where things are

| Ref | What |
|---|---|
| `origin/main` (c8c627cf5b) | Fork main. Last sync with upstream: Sep 30 (merge `c04cdcccdc`). |
| `claude/trusting-euler-pcr2bv` | Working branch: fork main + 4 commits below. **Not yet merged to fork main.** |
| `upstream/main` (NousResearch/hermes-agent) | 409 commits ahead of our merge base as of Oct 1. **Sync pending; see below.** |

Commits on the branch, not yet on fork main:

1. `57c037e583` **gateway: `insights.get {report: true}`** adds the `/insights` token + cost breakdown (`empty`, `overview`, `models`). Contract + generated TS/OpenRPC updated; invariant test in `tests/tui_gateway/test_launch_db_home_override_race.py` (red on base, green with the change).
2. `3d44f78826` **desktop: VS Code pane + Hermes CLI beside the chat.**
   - `electron/vscode-server.ts` (pure ladder: `code serve-web` → `code-insiders` → `openvscode-server`; code-server deliberately excluded because its password auth can't be satisfied safely) and `electron/vscode-ipc.ts` (one shared server per app on `127.0.0.1:<free port>` with a random 48-hex connection token, ready-probe, killed on quit). IPC `hermes:vscode:open(folder)`.
   - Renderer: `src/store/code-pane.ts`, `src/app/right-sidebar/code/index.tsx` (webview in its own `persist:hermes-vscode` partition; states: no project / remote / starting / missing / failed / ready). The pane is registered in `app/contrib/controller.tsx` (keep-alive) with a ⌘K toggle.
   - Panels launcher: "VS Code" row, "Hermes CLI" action, and a **Code** arrangement (VS Code + terminal).
3. `3202521638` **"Continue in Hermes CLI" hands the chat over.** The CLI refuses a chat another surface holds (`hermes_cli/shared_session_attach.py`: live attach is "not available in this build"), so the desktop now calls `session.close` on its runtime and drops to a fresh draft, then types the launcher into the embedded terminal. The pane runs the **classic CLI** (`cliArgs`, no Node build); "Open in terminal" (external emulator) still runs the TUI. Helper: `src/app/right-sidebar/terminal/hermes-cli.ts`; entry points: session ⋯ menu, Panels, ⌘K, the Code pane header.
4. `3d37c44cac` **docs/demo-kit/**: example runtime plugins, the scripted mock model + Electron recorders, and the HyperFrames film sources. Not shipped; see `docs/demo-kit/README.md`.

Verified: typecheck (renderer + electron), lint and Prettier on the touched files, and vitest over the touched areas (842 passing). Everything was also exercised end-to-end in the real Electron app (VS Code served and opened on the project; files Hermes writes appear in it; the CLI resumes the handed-over chat and edits the project).

## Work already on fork main (earlier sessions)

- **Bot Mode** (`plugins/hermes-bots`, `hermes bots` CLI, Team Bots orchestration). Group rooms with a single listener; lead-only team rooms; bot topics in a project folder; plan mode with a live checklist; group chat redesign (speaker runs, faces, continuation lines keep Reply/Copy). **Team retro**: `hermes bots lesson add|list|remove [--team]` + skill `skills/autonomous-ai-agents/bot-team-retro`.
- **MCP Apps host** in desktop (`tools/mcp_apps.py`, `mcp_apps.*` RPCs, inline app render in tool rows). Proposal: `docs/desktop-mcp-apps-host-proposal.md`.
- **Desktop UX**: Chat Background picker (scenes, own image, strength; Nous art Cyanotype/Ink), Today home, icon rail, Panels launcher, ⌘P Quick Open, file tree as project map, review pane with diff-line comments, worktree-per-session, rail multi-select, menu-bar status icon, quick-entry frontmost-app context chip, pinned/favorite models, and others (see `git log origin/main`).
- Docs: `docs/bot-mode-feedback-digest.md`, `docs/bot-mode-topics-proposal.md`, `docs/competitive-deepseek-harness-v0.2.md`, `docs/interop-user-agent.md`.

## Launch films (outside the repo)

Rendered films (scratch, not committed): Bot Mode, Desktop plugins (v1), "We heard you" (v2, complaint wall → six live fixes → Mission Control), and the Teknium special (VS Code + Hermes CLI, terminal style). The private download page holding all four is a claude.ai artifact owned by the user. Sources and the recording harness are in `docs/demo-kit/`.

## Pending, in priority order

1. **Upstream sync (409 commits).** Attempted and aborted on Oct 1: the fork decomposed god files that upstream keeps editing, so a plain merge leaves about 65 conflict hunks in 34 files, and the hard ones need hand-porting:
   - `apps/desktop/src/app/session/hooks/use-session-actions/index.ts`: the fork split it into `archive.ts`, `create.ts`, `fork.ts`, `resume.ts` and others; upstream added about 394 lines to the god file (branch-at-message, create-guard release, stored-session pins, and more). **Do not fuzz-apply hunks** (`patch -F3` misplaces them, including appends at EOF). Port each upstream commit by hand into the owning sibling: `git log <mb>..upstream/main -- <file>`.
   - `apps/desktop/src/store/session-states.ts`: the fork split it into `session-states-*.ts`. Upstream's 94 lines apply cleanly hunk by hunk except three: `TILE_PANE_PREFIX`, `$focusedSessionIsTile` and `$focusedStoredSessionId` moved to `session-focus.ts` upstream. Re-export them from `session-states-tiles-core.ts`.
   - `apps/desktop/src/store/quick-entry.ts` (+ app, bridge, tests, preload, `global.d.ts`): upstream rewrote quick entry around a delivery-confirmed submit relay (`createQuickEntrySubmitRelay`, ack by correlation id, `onLateResult`). The fork's frontmost-app **context chip** (`c9cf7dfa14`) must be re-ported onto the relay: carry `context` in the submit payload through `quickEntrySubmitRelay.begin`, keep `onContext`.
   - `apps/desktop/src/app/chat/sidebar/session-row.tsx`: the fork's card layout vs upstream's #38072 a11y restructure (row body is a div; the title is the `RowButton`) and #68119 density. Merge by hand; keep both.
   - `apps/desktop/src/store/review.ts` and `right-sidebar/review/index.tsx` (upstream +217/+57: `refreshReview` returns boolean, queued-debounce supersede, `$sessionStates` import) vs the fork's session-scoped review (`review-session.ts`).
   - Straight unions: `tui_gateway/contracts/sessions.py` (keep `bot_topic`/`team_room*` + add `idempotency_key`), `hermes_cli/web_server.py` (mobile + shared_metrics routers), `tests/tools/test_bot_relay.py`, `electron/preload.ts` (`onContext` + `onLateResult`), `electron/minimize-to-tray.ts` (status IPC + upstream `quitting` flag), `electron/main.ts` (keep `appName`, use upstream `rendererBaseUrl()`, keep `installRegionCapture`), `external-terminal.ts` (our `tuiArgs`/`cliArgs` + upstream `backendProfileArg`; rename `tuiResumeArgs` in tests), voice conversation (both refs/effects; deps `[consumePendingResponse, focusInput, onTranscribeAudio, parkText, speakStatusReply, voiceCopy.transcriptionFailed]`), i18n `ar`/`zh-hant` (union).
   - Keep ours: `styles.css` (the Soft-look block is fork-only), `plugins/hermes-bots/group-chat-view.tsx` (already has attachments).
   - Regenerate generated files afterwards (`scripts/gen_gateway_contracts.py`, `npm run fix`) instead of hand-merging them. Merge base is single now (`f848940560`), so a plain `git merge upstream/main` is the right starting point.
2. **Merge the branch into fork main** (PR from `claude/trusting-euler-pcr2bv`). The `ci-reviewed` label is a human gate; never apply it yourself.
3. Desktop test hygiene: one broad local vitest run (`src/i18n src/app/shell src/app/contrib src/app/chat/sidebar src/app/right-sidebar src/store`) showed 2 failing tests in one file. Not yet identified whether they come from this branch.
4. i18n: `codePane.*`, `panels.items.{code,cli}`, `panels.arrangements.code` and `continueInCli` exist only in `en.ts`; add the other locales.
5. Product follow-ups:
   - Live attach (two surfaces on one live session) needs an owner that advertises `metadata.shared_runtime_url` and serves `/api/session-attach`. The handoff in item 3 above is the stopgap.
   - Plain-words approval cards (app-derived effect), and a selection-menu plugin area ("select → ask/chart"). Both are ideas from reviewing ANDRETRIPOL/OpenGhost.
   - Publish `docs/demo-kit/plugins` to `hermes-example-plugins`.

## Gotchas learned the hard way

- `pkill -f "<pattern>"` from the agent shell kills the shell itself (the pattern is in its own cmdline). Use `pgrep -f "foo[b]ar"` or match by port.
- The TUI's first run does `npm ci` at the repo root. If it's interrupted, it wipes root `node_modules` (Playwright included); restore with `npm ci` at the root.
- When recording with a focused terminal, never send Escape: readline treats ESC plus the next keys as a meta sequence and eats injected characters.
- The fork once had two merge bases; if conflicts look absurd, check `git merge-base --all` and merge against the right one.
- Write tests per root `AGENTS.md`: behavior contracts, red on base, use `scripts/run_tests.sh` (never bare pytest), and no change-detectors.
