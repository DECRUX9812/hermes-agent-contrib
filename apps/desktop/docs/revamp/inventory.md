# Revamp Wave 0 — Feature inventory (roadmap #1–#51)

Wave-0 item 0.1: an as-built inventory of every feature in
`docs/agentic-desktop-roadmap.md` §3, feeding the UX simplification pass. All 51
items are implemented on `main` (PRs ~#26–#81, week of 2026-09-20..26). Each
entry lists **Entry points** (UI surfaces + file paths, relative to
`apps/desktop/`), **Default state** (on/off/setting, plus Simple-mode gates),
**Owning store** (`src/store/*` atoms + persisted keys), and a **Verdict** —
one of `default-on` / `surface-in-context` / `keep advanced` / `retire` — with a
one-line reason. The verdicts are the simplification recommendation, not a
quality judgment.

## How the gates work

The mode system is `src/store/interface-mode.ts`. `$interfaceMode`
(`'simple' | 'advanced'`, default `advanced`, persisted key
`hermes.desktop.interfaceMode.v1`) drives three mechanisms:

- **`SIMPLE_POLICY`** shadows a fixed list of panel/pref atoms in Simple mode:
  `artifactsOpen`, `fileBrowserOpen`, `hideCodeDiffs`, `profileRailVisible`,
  `reasoningCollapsedByDefault`, `reviewOpen`, `sidebarRowMeta` (→
  `['preview','updated']`), `statusbarVisible`, `terminalOpen`,
  `toolViewMode` (→ `'product'`).
- **`tier: 'advanced'`** on nav/palette items + `shownInMode(mode)` hides them
  in Simple mode.
- **`modeBound(key, $pref, setter)`** lets a Simple-mode shadow read as the
  policy value while the persisted pref stays untouched underneath.
- `$showsAdvancedChrome` is the computed boolean most chrome reads.

Persistence shapes used below: `persistentAtom(KEY, …)` = one global
localStorage key; `connectionScopedAtom(KEY, …)` = one key per
connection/profile (`{KEY}:{profile}`); `storedString`/`persistString` = raw
localStorage. Every profile-keyed family is registered in both
`migrateTilesForProfile` and `dropTilesForProfile` (`store/session-states-profile.ts`).

## Verification

Booted `npm run dev:fake-boot` (`HERMES_DESKTOP_BOOT_FAKE=1`, fake backend, no
provider) and drove the running app via the Electron renderer CDP endpoint.
Entries marked **[runtime]** were seen on the live surface; entries marked
**[code]** exist in source but need state a fake boot cannot produce (an
active run, a provider, a populated transcript, a git-repo workspace) — called
out honestly per item.

Runtime-verified this session: rail nav (Capabilities, Messaging, Artifacts,
Scheduled jobs, Kanban); titlebar buttons (Open settings, Layout editor, HUD
mode, sidebars); ⌘K palette GO TO entries (Search sessions ⌘⇧F, Memory Graph,
Cron, Spawn tree, Profiles); session-row ⋯ menu (New window, Open in terminal,
Open on another device, Rename…, Tags, Pin, Mark as unread, Mute notifications,
Watch, Appearance, Copy ID, Ask about this session, Branch, Export, Export as
Markdown, Artifacts, Export deliverable, Copy as Markdown, Move to project,
Continue on phone, Archive, Delete); composer "Add context" menu (Files…,
Folder…, Images…, Paste image, URL…, Screenshot region…, Prompt snippets…, Run
on a schedule…, Slash commands…); composer controls (Voice dictation, Start
voice conversation, Voice chat engine, Effort, Approval mode); goal chips on
the empty draft; Settings sections (Notifications incl. Quiet hours + Hourly
digest + Per-session overrides; Chat → Proactive nudges; Advanced → Quick
Entry; Keyboard Shortcuts → Key bindings / HUD gesture / Screen capture;
Appearance → Window & layout incl. Interface mode, Session List Density,
Minimize to tray, Menu-bar status); roster "N run(s)" pill; Kanban board page;
Messaging page; Webhooks page ("Enable webhooks", "New subscription").

---

## Phase 1 — Everyday flow wins

### 1. ⌘K frecency

- **Entry points**: the command palette itself, `app/command-palette/`
  (⌘K / `nav.commandPalette`); ranking applied in palette ordering.
  **[runtime]**
- **Default state**: always on — no setting. No Advanced gate (⌘K is core
  chrome).
- **Owning store**: `store/command-palette-frecency.ts` — `$paletteFrecency`,
  `connectionScopedAtom` key `hermes.desktop.commandPaletteFrecency`.
- **Verdict**: `default-on` — invisible ranking signal; nothing to simplify.

### 2. Session tags

- **Entry points**: session-row ⋯ menu → "Tags" (`chat/sidebar/session-actions-menu.tsx`);
  color chips on rows (`chat/sidebar/session-row-slots.tsx`); filter facet in
  the sidebar "Filters" popover (`chat/sidebar/filter-menu.tsx`).
  **[runtime]** (menu item + Filters button verified).
- **Default state**: always available; tags exist only once the user creates
  them. Sidebar row meta is Simple-shadowed but tags chip survives via slots.
- **Owning store**: `store/session-tags.ts` — `$sessionTags`,
  `connectionScopedAtom` key `hermes.desktop.sessionTags` (joins
  rename/drop migrations).
- **Verdict**: `keep advanced` — Linear-style labeling is an organizer's tool;
  hide tag affordances from Simple rows, keep them in Advanced.

### 3. Global history search

- **Entry points**: ⌘K GO TO → "Search sessions ⌘⇧F" (`nav.commandPalette` →
  `session.focusSearch`); the transcript find bar's "Search all history"
  toggle (`components/find-bar.tsx`, aria-pressed `history` mode).
  **[runtime]** (palette entry verified).
- **Default state**: always on via ⌘⇧F; history mode is a toggle inside the
  in-transcript find bar.
- **Owning store**: `store/transcript-find.ts` + `store/find-in-page.ts` —
  `$transcriptSearchJumps` (in-memory); results navigate via
  `history.revealRow` (PR #23 seam). No persisted pref.
- **Verdict**: `default-on` — search is table stakes; one keyboard path is
  enough (consider dropping the find-bar toggle in favor of ⌘⇧F only).

### 4. Shortcut editor

- **Entry points**: Settings → Keyboard Shortcuts → "Key bindings" (list,
  rebind-by-capture, conflict warning, "Reset all", ⌘/ reopens the panel);
  subpages "HUD gesture", "Screen capture". `app/settings/keybind-settings.tsx`.
  **[runtime]**
- **Default state**: all actions carry default combos; user remaps only
  through this page. Page is available in both modes (Settings is core).
- **Owning store**: `store/keybinds.ts` — `$bindings`, `$capture`; persisted
  key `hermes.desktop.keybinds`. Action registry:
  `lib/keybinds/actions.ts`.
- **Verdict**: `keep advanced` — rebindable keys are a power feature; Simple
  mode should show read-only shortcut hints, not the editor.

### 5. Compact rail density

- **Entry points**: Settings → Appearance → Window & layout → "Session List
  Density" (Condensed / Compact / Comfortable / Detailed);
  `chat/sidebar/session-row.tsx` + `row-geometry.ts` render it.
  **[runtime]**
- **Default state**: `compact` out of the box; four densities, per-window
  persisted.
- **Owning store**: `store/session-list-density.ts` — `$sessionListDensity`,
  `persistentAtom` key `hermes.desktop.sessionListDensity`.
- **Verdict**: `keep advanced` — four densities is preference sprawl; Simple
  gets the default and the setting lives under Advanced chrome.

### 6. Drag-to-attach

- **Entry points**: drop files onto a sidebar session row or tile → chips
  stage in that session's composer with an "N attached" badge
  (`chat/session-drop-attach.ts`, `new-session-drag.ts`,
  `composer/attachments.tsx`). **[code]** — drag needs real files/OS DnD,
  unverifiable in CDP.
- **Default state**: always on; explicit user gesture, no focus steal.
- **Owning store**: composer's per-session attachment staging; no dedicated
  persisted key.
- **Verdict**: `default-on` — gesture-only feature, zero chrome cost.

### 7. Locale completion

- **Entry points**: none (infrastructure) — filled `ar`, `ja`, `zh-hant`
  overlays in `src/i18n/*.ts`; `catalog-completeness.test.ts` CI check.
  Language selection follows the existing locale picker.
- **Default state**: locales ship; per-locale coverage complete for shipped
  strings.
- **Owning store**: i18n state in `src/i18n/` (locale pref follows the
  app's existing language setting).
- **Verdict**: `default-on` — hygiene, not a surface.

### 8. Transcript export

- **Entry points**: session-row ⋯ → "Export as Markdown" / "Copy as
  Markdown" (`chat/sidebar/session-actions-menu.tsx`); per-message copy;
  helpers `lib/session-markdown.ts`. **[runtime]** (menu items verified).
- **Default state**: always on, menu-only.
- **Owning store**: none — pure export helper reading transcript state.
- **Verdict**: `default-on` — already context-scoped to the ⋯ menu; ideal
  "in-context" cost.

### 9. Queue inspector

- **Entry points**: queue panel above the composer when prompts are pending —
  reorder, edit, remove (`composer/queue-panel.tsx`). **[code]** — panel only
  renders when the queue is non-empty (needs a running turn).
- **Default state**: appears in-context while a queue exists; hidden
  otherwise.
- **Owning store**: `store/composer-queue.ts` — queued prompts, persisted key
  `hermes.desktop.composerQueue.v1`.
- **Verdict**: `surface-in-context` — correct as-is: visible only when a
  queue exists; keep it out of Simple chrome lists.

## Phase 2 — Session legibility

### 10. Live digest line

- **Entry points**: session-row secondary line ("what it's doing now":
  current tool, todo progress, elapsed) + hover peek card
  (`chat/sidebar/session-row-details.ts`, `session-peek.tsx`,
  `store/todos.ts`). **[code]** — needs a live run to populate.
- **Default state**: on for every row; Simple mode shadows `sidebarRowMeta`
  to `['preview','updated']`, dropping the digest line in Simple.
- **Owning store**: derived — `$sessionDigestById` in
  `store/session-digest.ts` (computed from todos/dot-state stores); row meta
  pref itself is `sidebarRowMeta` (SIMPLE_POLICY-shadowed).
- **Verdict**: `surface-in-context` — this is the core "inspect without
  entering" win; keep on Advanced rows, keep peek on hover.

### 11. Report cards

- **Entry points**: attention fold at the top of the Sessions sidebar — a
  card when a background session settles (outcome, duration, files, CTA);
  `store/delegation-reports.ts` + attention fold in
  `chat/sidebar/index.tsx`. **[code]** — needs a settled background run.
- **Default state**: on; cards stack in the fold until dismissed; never
  auto-opens the session.
- **Owning store**: `$delegationReportsBySession` (in-memory) +
  `$dismissedDelegationReports`, `persistentAtom` key
  `hermes.desktop.dismissedDelegationReports`.
- **Verdict**: `default-on` — the fold is the right home; this is the
  attention model, not clutter.

### 12. PR + CI chips

- **Entry points**: chip on session rows for branches with a linked PR —
  state + CI rollup, click opens the PR (`chat/pr-tag.tsx`,
  `session-row-slots.tsx`). **[code]** — needs a session with a PR branch.
- **Default state**: on when a PR link exists (scan once per session,
  remembered); invisible otherwise.
- **Owning store**: `store/pull-requests.ts` — `$pullRequestsByBranch`,
  `$prBranchBySession` (`hermes.desktop.prBranchBySession`),
  `$prScannedSessions` (`hermes.desktop.prScannedSessions`).
- **Verdict**: `surface-in-context` — only renders when a PR exists; zero
  ambient cost.

### 13. Session recap

- **Entry points**: inline "where it left off" banner when resuming a stale
  session (`chat/session-recap.tsx`, driven by `route-session-state.ts` +
  `transcript-tail-cache.ts`). **[code]** — needs a stale session with a
  stored tail.
- **Default state**: on; shows once per stale resume, dismissible.
- **Owning store**: `store/session-recap.ts` — `$sessionRecapDismissedIds`,
  `connectionScopedAtom` key `chat.recapDismissedSessionIds`.
- **Verdict**: `default-on` — appears exactly when context is stale; textbook
  in-context surface.

### 14. Timeline scrubber

- **Entry points**: minimap inside the transcript scrollbar — user/tool/
  approval markers, click/drag to jump (`store/thread-timeline.ts` +
  scrollbar host). **[code]** — needs a transcript long enough to scroll.
- **Default state**: shown; user-hidable via `hideThreadTimeline`.
- **Owning store**: `store/thread-timeline.ts` — timeline model; pref
  `hermes.desktop.hideThreadTimeline` (bool, default false).
- **Verdict**: `keep advanced` — dense-power-user navigation; Simple
  transcripts stay clean without it.

### 15. Capability chip

- **Entry points**: chat-header chip — active skills/toolset count + model,
  opens Capabilities filtered to the session (`chat/skill-tag.tsx`,
  `/capabilities` route). **[code]** — chip only renders on a session with
  catalog data.
- **Default state**: on for session headers; degrades to model-only when
  counts are empty.
- **Owning store**: read-through from `commands.catalog` + capability stores;
  no dedicated pref.
- **Verdict**: `surface-in-context` — useful exactly when you wonder "what
  can this session do"; keep.

### 16. Attention inbox

- **Entry points**: `/inbox` overlay route (INBOX_ROUTE) —
  `app/attention-inbox/index.tsx`; statusbar item `attention-inbox`
  (`use-statusbar-items.tsx`, hidden unless `attentionCount > 0`, pinnable);
  sidebar attention fold feeds the same store. **[code]** — inbox empties in
  a fake boot (no approvals/errors).
- **Default state**: aggregate surface exists; statusbar badge only appears
  when something needs attention.
- **Owning store**: `store/attention-inbox.ts` — `$attentionItems`,
  `$pendingAttentionReveal`.
- **Verdict**: `default-on` — the approval-aggregation queue is the heart of
  the multi-agent UX; keep the badge conditional.

### 17. Watch chip

- **Entry points**: session-row ⋯ → "Watch"; watched sessions render compact
  live chips in the rail's watch strip (`chat/sidebar/watch-strip.tsx`).
  **[runtime]** (menu item verified; strip only renders with watches set).
- **Default state**: off until the user watches a session; per-profile.
- **Owning store**: `store/session-watch.ts` — `$watchedSessionKeys`,
  `connectionScopedAtom` key `hermes.desktop.sessionWatch`.
- **Verdict**: `surface-in-context` — opt-in per session via the ⋯ menu;
  correct as shipped.

### 18. Rail multi-select

- **Entry points**: ⌘/⇧-click in the Sessions list → bulk pin/mute/archive/
  tag via the shared actions menu (`virtual-session-list.tsx`,
  `session-actions-menu.tsx`). **[code]** — needs multiple sessions.
- **Default state**: always on; selection is ephemeral.
- **Owning store**: `store/session-selection.ts` — `$selectedSessionKeys`
  (in-memory Set).
- **Verdict**: `keep advanced` — bulk ops are power tooling; hide in Simple
  (selection keyboard model stays, affordances drop).

## Phase 3 — Delegation & oversight

### 19. Delegation roster

- **Entry points**: `/roster` route (`app/roster/index.tsx`); rail "N run(s)"
  pill in `profile-switcher.tsx` — only while runs are active. **[runtime]**
  (pill verified; page needs live runs for content).
- **Default state**: page always reachable in Advanced nav; pill is
  conditional on active runs.
- **Owning store**: `store/fleet-roster.ts` (`$fleetRoster`) +
  `store/fleet-runs.ts`; polled backend data, no persisted pref.
- **Verdict**: `keep advanced` — fleet oversight is the Advanced value prop;
  `tier: 'advanced'` already applies to the nav item.

### 20. Goal-first draft

- **Entry points**: empty-draft composer framing "What can you do?" + goal
  chips ("Plan a new feature", …); `store/composer-suggestions.ts` +
  suggestion pills. **[runtime]**
- **Default state**: on for empty drafts only.
- **Owning store**: `store/composer-suggestions.ts` — suggestion sets;
  ephemeral.
- **Verdict**: `default-on` — shapes the first-run experience; keep chip
  count small in Simple.

### 21. Parallel fan-out

- **Entry points**: roster page → fan-out picker (`app/roster/fan-out.tsx`);
  sibling tiles per picked profile. **[code]** — needs ≥2 profiles/runs.
- **Default state**: explicit-pick only; islands preserved by design.
- **Owning store**: `session-tile-actions.ts` + tile-zone stores; ephemeral.
- **Verdict**: `keep advanced` — multi-agent dispatch is definitionally
  Advanced.

### 22. Plan→build handoff

- **Entry points**: plan artifact card → "Build with this" → new session
  seeded with the plan as a context file (`app/artifacts/plan-artifacts.ts`,
  `open-session.ts`). **[code]** — needs a plan artifact.
- **Default state**: appears on plan artifacts only.
- **Owning store**: artifacts store + composer attachment staging; no new
  persisted key.
- **Verdict**: `surface-in-context` — right place, right time; keep.

### 23. Agent review pass

- **Entry points**: review pane → "Have ‹bot/profile› review this diff" →
  seeds a review session, lands results as a report card
  (`store/agent-review.ts`, `right-sidebar/review/`). **[code]** — needs a
  diff + a reviewer profile.
- **Default state**: available in the review pane when a diff exists.
- **Owning store**: `$agentReviewReportsBySession` (in-memory); draft seeding
  via `NEW_SESSION_DRAFT_KEY` prefix.
- **Verdict**: `keep advanced` — multi-agent review orchestration; the review
  pane itself is already Simple-shadowed (`reviewOpen` in SIMPLE_POLICY).

### 24. Delegation pill in transcript

- **Entry points**: inline pill in the transcript when a bot delegates
  (group round / subagent) — worker name + state, expands to the subagent
  tree (`components/assistant-ui/thread/delegation-pill.tsx`,
  `store/subagents.ts`). **[code]** — needs a delegating bot turn.
- **Default state**: renders in-context only during delegation.
- **Owning store**: `store/subagents.ts` (existing subagent tree state).
- **Verdict**: `default-on` — a transcript row, not chrome.

### 25. Secure-field ask

- **Entry points**: masked-input card in the transcript when the agent asks
  for a credential/2FA (`components/prompt-overlays.tsx`); writes to the
  secret store via IPC, never to the transcript. **[code]** — needs an agent
  secret request.
- **Default state**: replaces the normal clarify card whenever the request is
  credential-shaped.
- **Owning store**: secrets IPC + clarify-card family; no transcript-side
  state persisted.
- **Verdict**: `default-on` — security-critical; hiding it would leak
  credentials into chat.

### 26. Team board lanes

- **Entry points**: rail BROWSE → Kanban (`/kanban`, plugin route via
  `ROUTES_AREA`); lanes per profile/bot, drag card to lane = delegate
  (`plugins/kanban/board.tsx`, `team-lanes.ts`, `transfer.ts`). **[runtime]**
  (board page verified).
- **Default state**: Kanban page present in Advanced browse; lane delegation
  is drag-driven.
- **Owning store**: kanban plugin api (`plugins/kanban/api.ts`), backend
  boards; no renderer pref.
- **Verdict**: `keep advanced` — board orchestration is a power surface.

### 27. Starmap live mode

- **Entry points**: ⌘K → "Memory Graph" / `/starmap` route
  (`app/starmap/star-map.tsx`, `store/starmap.ts`); live mode animates state
  + settle events, replay scrubs the day (`store/starmap-live.ts`).
  **[runtime]** (palette entry + route verified; live graph needs data).
- **Default state**: live updates on while the page is open; replay is
  on-page.
- **Owning store**: `$starmapGraph`/`$starmapLoading`/`$starmapError`,
  `$starmapLive`, `$starmapSettles` — all in-memory.
- **Verdict**: `keep advanced` — ambient fleet viz is a power toy; Simple
  never shows it.

## Phase 4 — Review & deliverables

### 28. Unified session diff

- **Entry points**: right-sidebar Review pane — one tree + unified diff of
  everything the session touched, open-in-editor per file
  (`right-sidebar/review/*`). **[code]** — needs a dirty workspace (the
  statusbar did show "1 changed" for the repo, but the pane needs a session
  scope).
- **Default state**: pane closed until opened; scope mode defaults to
  `uncommitted`.
- **Owning store**: `store/review.ts` / `store/review-session.ts` —
  `$reviewScopeMode` (`hermes.desktop.reviewOpen` +
  `hermes.desktop.reviewCommitDefault` + `hermes.desktop.reviewTreeMode` +
  `hermes.desktop.reviewSelectedPath`); `reviewOpen` is SIMPLE_POLICY-shadowed
  (closed in Simple).
- **Verdict**: `default-on` — the diff-as-conversation is a flagship surface;
  keep gated to Advanced chrome via `reviewOpen`.

### 29. Diff comments → feedback

- **Entry points**: comment on a diff line in the review pane → sends
  structured feedback into the composer as a draft
  (`components/chat/diff-lines.tsx`). **[code]**
- **Default state**: on wherever the diff view renders.
- **Owning store**: review pane state + composer draft; no persisted key.
- **Verdict**: `surface-in-context` — a gesture inside a power pane; keep.

### 30. Agent self-review

- **Entry points**: review pane → "Review changes" runs a utility-model pass;
  findings land as inline comments on the diff (`store/self-review.ts`).
  **[code]** — needs a diff + provider.
- **Default state**: on-demand button; never automatic.
- **Owning store**: `$selfReview` (in-memory state machine, `IDLE` default).
- **Verdict**: `keep advanced` — a second model pass is a deliberate power
  action; keep it inside the review pane.

### 31. Turn checkpoints

- **Entry points**: hover a user message → "revert to before this prompt"
  affordance (`user-message.tsx`); snapshots per turn via
  `electron/git-worktree-ops.ts` backend records. **[code]** — needs turns +
  a git workspace.
- **Default state**: snapshots recorded automatically when the workspace is a
  repo; the affordance only appears on hover.
- **Owning store**: `store/checkpoints.ts` — `$checkpointsBySession`
  (in-memory cache of backend records).
- **Verdict**: `keep advanced` — destructive-adjacent revert belongs to the
  Advanced diff workflow; row affordance can stay but gated.

### 32. Artifact rail

- **Entry points**: per-session artifact rail in the right sidebar
  (`right-sidebar/artifacts/`); session-row ⋯ → "Artifacts"; Artifacts page
  (`/artifacts`). **[runtime]** (route + menu item verified).
- **Default state**: rail closed by default; `artifactsOpen` is
  SIMPLE_POLICY-shadowed (Simple hides it).
- **Owning store**: `store/artifact-rail.ts` — `$artifactsOpen` modeBound on
  `hermes.desktop.artifactsOpen`.
- **Verdict**: `default-on` — previews/deliverables are core value; Simple
  gating already exists.

### 33. Preview verify loop

- **Entry points**: preview pane → "Verify in preview" — agent step opens the
  built app, reads console errors, iterates; pass/fail card
  (`right-rail/preview-pane.tsx`, `store/preview-verify.ts`,
  `lib/preview-verify.ts`). **[code]** — needs a preview-able build.
- **Default state**: on-demand from the preview pane; agent-callable via the
  `desktop_ui` toolset seam.
- **Owning store**: `store/preview-verify.ts` + `preview-console-store.ts`.
- **Verdict**: `keep advanced` — verification loops are power workflow;
  preview pane is already advanced chrome.

### 34. Screenshot annotate → composer

- **Entry points**: composer "Add context" (+) → "Screenshot region…"
  (`composer/context-menu.tsx`, gated on
  `window.hermesDesktop?.regionCapture`); Settings → Keyboard Shortcuts →
  Screen capture ("Screenshot shortcut" — press both Command keys to capture
  the frontmost window). `store/region-capture.ts`. **[runtime]** (both
  verified).
- **Default state**: menu item always present under Electron; global shortcut
  off by default, per-device.
- **Owning store**: `$regionCapture` capture state; the OS-level shortcut is
  Electron-side (`electron/`), not a localStorage pref.
- **Verdict**: `default-on` — lives entirely inside the attach menu; zero
  chrome.

### 35. Deliverable export

- **Entry points**: session-row ⋯ → "Export deliverable" — bundles summary +
  diff stat + artifacts + PR link into Markdown/PDF
  (`lib/session-deliverable.ts`). **[runtime]** (menu item verified).
- **Default state**: menu action, always available.
- **Owning store**: none — pure export helper.
- **Verdict**: `default-on` — context-menu-scoped, no ambient cost.

## Phase 5 — Ambient presence & input

### 36. In-task voice

- **Entry points**: composer controls — "Voice dictation", "Start voice
  conversation", "Voice chat engine" picker (`composer/voice-fan.tsx`,
  `controls.tsx`); ⌃B on mac (`composer.voice` action);
  `store/voice-live.ts` + `lib/voice-status.ts`. **[runtime]**
- **Default state**: controls visible on the composer; live conversation is
  user-started; auto-speak replies opt-in
  (`hermes.desktop.autoSpeakReplies`).
- **Owning store**: `$voiceLiveStatus` (in-memory) + `store/voice-prefs.ts`
  (`hermes.desktop.autoSpeakReplies`).
- **Verdict**: `surface-in-context` — composer buttons are one icon-row;
  keep engine picker under settings/overflow.

### 37. Context-aware quick entry

- **Entry points**: global hotkey `CommandOrControl+Shift+Space` opens the
  quick-entry window (`electron/quick-entry.ts`,
  `DEFAULT_QUICK_ENTRY_SHORTCUT`); frontmost-app context chip; Settings →
  Advanced → "Quick Entry" + shortcut field
  (`app/settings/quick-entry-settings.tsx`,
  `store/quick-entry.ts` — `$quickEntry`, `quickEntryContextBlock`).
  **[runtime]** (settings verified; window itself needs the OS hotkey).
- **Default state**: installed with a default global shortcut; configurable
  in Advanced settings; per-device (Electron main).
- **Owning store**: renderer `$quickEntry` mirror; settings live in Electron
  (`window.hermesDesktop.quickEntry.getSettings/setSettings`).
- **Verdict**: `keep advanced` — a second always-on window is power chrome;
  Simple users shouldn't meet it accidentally.

### 38. Menu-bar status

- **Entry points**: macOS menu bar / tray icon with live badge, recent
  sessions, quick actions (`electron/` tray, `store/menu-bar-status.ts`);
  Settings → Appearance → Window & layout → "Menu-bar status" +
  "Minimize to tray" (`app/settings/menu-bar-status-setting.tsx`,
  SETTING_IDS `menuBarStatus`, gated on
  `window.hermesDesktop?.menuBarStatus`). **[runtime]** (settings rows
  verified).
- **Default state**: **off by default**, per-device opt-in.
- **Owning store**: Electron-side tray state; renderer store mirrors
  availability.
- **Verdict**: `keep advanced` — ambient presence is an explicit opt-in;
  correctly defaulted off.

### 39. Notification rules

- **Entry points**: Settings → Notifications → Desktop alerts: per-kind
  toggles (Approval needed, Input needed, Response ready, Turn failed,
  Background task finished, Credit alerts, Plugin notifications), Quiet
  hours, Hourly digest, Per-session overrides; session-row ⋯ → "Mute
  notifications". `app/settings/notifications-settings.tsx`,
  `store/notification-rules.ts`. **[runtime]**
- **Default state**: notifications on per-kind; rules off until configured.
- **Owning store**: `hermes:notification-rules` (`persistentAtom`) +
  `store/native-notifications.ts` (`hermes:native-notifications`).
- **Verdict**: `keep advanced` — per-kind rule matrix is preference depth;
  Simple can ship with sane defaults and the single mute row.

### 40. Phone parity links

- **Entry points**: session-row ⋯ → "Continue on phone"; bot-row menu →
  continue-on-Telegram/Slack deep link + QR; Messaging page gateway presence
  (`app/messaging/phone-parity.tsx`, `lib/session-handoff.ts`).
  **[runtime]** (menu item verified).
- **Default state**: menu items present; links only work when a gateway
  platform is configured.
- **Owning store**: gateway API state; `store/*` mirrors pairing — no
  dedicated pref.
- **Verdict**: `surface-in-context` — exactly where it belongs (session ⋯
  menu); no dedicated surface needed.

### 41. Tile status strip

- **Entry points**: every open session tile's strip — live dot + elapsed +
  current tool (`chat/session-tab-status.tsx`). **[code]** — needs a running
  session with tiles.
- **Default state**: on for all tiles; no toggle.
- **Owning store**: reads dot-state/elapsed stores; no dedicated pref.
- **Verdict**: `default-on` — the roadmap itself flags it as the weakest
  standalone (#41 "could fold into #10"); it is a cheap ambient signal, keep
  it but never promote it to its own surface.

### 42. HUD run cards

- **Entry points**: titlebar "HUD mode" toggle (⌘⇧H, `view.toggleHud`) opens
  the HUD layer — compact per-session run cards with click-through
  (`app/hud/*`, `app/hud/run-cards.tsx`, `store/hud.ts` — bridges
  `window.hermesDesktop.hud`). **[runtime]** (toggle verified; cards need
  runs).
- **Default state**: HUD closed; overlay-mode by user toggle; per-window
  layout via `hud.resetLayout`.
- **Owning store**: `$hud*` in `store/hud.ts` + Electron-side window state.
- **Verdict**: `keep advanced` — ambient overlay is Advanced chrome; already
  behind an explicit toggle.

### 43. Proactive nudges (opt-in)

- **Entry points**: Settings → Chat → "Proactive nudges" toggle; on settle,
  next-step chips appear in the attention fold ("open a PR", "schedule a
  follow-up"); `suggestion-providers/nudges.ts`. **[runtime]** (toggle
  verified).
- **Default state**: **off by default** (opt-in); never auto-acts, never hits
  the model without consent.
- **Owning store**: `hermes:proactive-nudges` (`persistentAtom`, default
  false) + attention-fold rendering.
- **Verdict**: `surface-in-context` — opt-in chips in the fold are the right
  shape; keep default-off.

## Phase 6 — Platform bets

### 44. Companion thread

- **Entry points**: session-row ⋯ → "Ask about this session" → side-thread
  dialog (`session-ask-dialog.tsx`); backend `session.ask` RPC answers over
  the stored transcript without touching the live conversation.
  **[runtime]** (menu item verified; dialog needs a backend with a model).
- **Default state**: menu action; threads persist per session.
- **Owning store**: `store/session-ask.ts` — `$sessionAskThreads`,
  `connectionScopedAtom` key `hermes.desktop.sessionAskThreads` keyed
  `${profile}:${sessionId}`.
- **Verdict**: `default-on` — "talk about work without derailing it" is a
  headline capability; keep it in the ⋯ menu (no new chrome).

### 45. Mobile companion

- **Entry points**: Webhooks page mobile-companion section — pairing flow for
  a phone web client (`api/mobile.ts` `POST /api/mobile/pairing`,
  `app/webhooks/mobile-companion.tsx`); status/approvals/quick replies on the
  paired client. **[code]** — the `/webhooks` page verified ("Enable
  webhooks", "New subscription"); the companion section needs gateway/pairing
  support enabled to render.
- **Default state**: unpaired until the user pairs a device; pairing is
  explicit.
- **Owning store**: backend pairing records; renderer mirrors via
  `api/mobile.ts`.
- **Verdict**: `keep advanced` — a whole second-client surface; niche until
  the mobile client matures.

### 46. Record-a-task → skill

- **Entry points**: preview pane → record button → preview-record dialog —
  captures a UI workflow into a replayable skill artifact
  (`lib/preview-record/`, `right-rail/preview-record-dialog.tsx`).
  **[code]** — needs a preview session.
- **Default state**: manual action inside the preview pane; recordings become
  skills the agent can invoke.
- **Owning store**: `lib/preview-record/` capture state + skills write path.
- **Verdict**: `keep advanced` — authoring skills from recordings is a deep
  power feature; correctly buried in the preview pane.

### 47. Worktree-per-session

- **Entry points**: session-row ⋯ → Branch; worktree isolate/merge-back
  affordances on rows for git workspaces (`store/session-worktree.ts`,
  `electron/git-worktree-ops.ts`; worktrees at
  `<repo>/.worktrees/session-<slug>` on `hermes/session-<slug>` branches).
  **[runtime]** (Branch item verified; worktree items need a repo-backed
  session to appear).
- **Default state**: worktrees created on demand for sessions with file
  writes in a repo; restore recreates missing worktrees.
- **Owning store**: `store/session-worktree.ts` + persisted keys
  `hermes.desktop.dismissedWorktrees` / `hermes.desktop.removedWorktrees`.
- **Verdict**: `keep advanced` — isolation plumbing is invisible until needed;
  merge-back is inherently advanced.

### 48. Agent mailbox

- **Entry points**: structured hand-off notes render inside group chats and
  the roster (`plugins/hermes-bots/mailbox.ts`, `mailbox-parts.tsx`,
  `group-chat-view.tsx`). **[code]** — needs a multi-bot group chat.
- **Default state**: renders in-context when mailbox parts exist in a
  transcript.
- **Owning store**: hermes-bots plugin state (mailbox records), no renderer
  pref.
- **Verdict**: `keep advanced` — inter-agent plumbing; users meet it through
  group chats, not a standalone surface.

### 49. Usage & cost analytics

- **Entry points**: Command Center (`/command-center`) usage/cost section;
  opt-in gate `hermes.desktop.cost-analytics.v1`
  (`store/cost-analytics-enabled.ts`). **[code]** — command-center route
  exists; the section renders only once opted in.
- **Default state**: **off** — explicit opt-in (root rubric: no analytics
  without consent); local-only aggregation.
- **Owning store**: `$costAnalyticsEnabled` (`persistentAtom`,
  `hermes.desktop.cost-analytics.v1`) + session usage stores.
- **Verdict**: `keep advanced` — spend dashboards serve heavy users; opt-in
  is correct.

### 50. Cross-device handoff

- **Entry points**: session-row ⋯ → "Open on another device" →
  `session-device-dialog.tsx` QR/deep link (`lib/session-device-link.ts`);
  inbound `hermes://session/open?id=…` handled in `lib/deeplink-routes.ts`.
  **[runtime]** (menu item verified).
- **Default state**: menu action; links resolve only when the target
  connection is configured.
- **Owning store**: connection/session stores; no dedicated pref.
- **Verdict**: `surface-in-context` — a ⋯ menu item + a dialog; no ambient
  cost.

### 51. Plugin surface SDK

- **Entry points**: none user-facing — typed contract for pane/layout/nav
  contributions consumed by `plugins/kanban` + `hello-runtime`
  (`src/sdk/index.ts`); third-party plugin docs.
- **Default state**: API surface, always compiled in.
- **Owning store**: n/a — type exports + the contrib registries
  (`app/contrib`).
- **Verdict**: `keep advanced` — developer surface, not UX chrome; revamp
  touchpoint is only that contributed panes respect `tier`.

---

## Roll-up for the simplification pass

| Verdict | Items | Theme |
|---|---|---|
| `default-on` | 1, 6, 7, 8, 11, 13, 16, 24, 25, 28, 32, 34, 35, 41, 43*, 44 | Core attention/export/context features; invisible until needed (*43 keeps its opt-in). |
| `surface-in-context` | 9, 10, 12, 15, 17, 22, 29, 36, 40, 50 | Right-place surfaces; already conditional — the pass should mainly verify they stay conditional. |
| `keep advanced` | 2, 4, 5, 14, 18, 19, 21, 23, 26, 27, 30, 31, 33, 37, 38, 39, 42, 45, 46, 47, 48, 49, 51 | Power/ambient/organizational depth — Simple mode should hide or read-only these. |
| `retire` | — | None recommended for removal; #41 is the weakest standalone and could fold into #10's digest work rather than ship as its own surface. |

Notable simplification pressure points found while inventorying:

- **Session-row ⋯ menu is doing a lot** — 20 items (#2, #8, #17, #32, #35,
  #40, #44, #47, #50 plus windowing/organizing). It is the correct *single*
  home (one action one home), but deserves grouping/overflow in the Simple
  pass.
- **Two settings silos for captures**: region capture lives in the composer
  menu + the global shortcut under Keyboard Shortcuts → Screen capture —
  coherent, but worth linking the setting from the menu item.
- **Opt-ins already correct**: menu-bar status (#38), proactive nudges (#43),
  cost analytics (#49) all default off — the ambient layer stays opt-in.
- **SIMPLE_POLICY already covers the heavy panes** — review, artifacts,
  terminal, file browser, statusbar all shadow in Simple; the inventory's
  `keep advanced` items mostly just need the existing `tier`/`modeBound`
  wiring verified, not new plumbing.
