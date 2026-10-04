# Agentic desktop roadmap

A researched, prioritized build plan for `apps/desktop` — ~50 concrete features
grouped into six phases, ordered by (value ÷ effort) and dependency order.
Sources verified by browsing each product's site/docs/repo — September 26, 2026.
Companion to [`control-surface-research.md`](./control-surface-research.md)
(PR #20), which covers OpenClaw 2.0, rabbitOS 3, and AionUi in depth.

## Design invariants every feature must respect

From `AGENTS.md` + `DESIGN.md` — these are hard constraints, not preferences:

- **Offer, don't hijack.** Nothing opens, navigates, or steals focus because
  something happened in the background. Every surface below is user-invoked.
- **Profiles are islands.** No live config inheritance, no implicit cross-profile
  routing. Multi-profile features (roster, fan-out) must keep explicit routing.
- **i18n everywhere.** All user-facing strings through `src/i18n/types.ts` +
  all 9 locales; `ar`, `ja`, `zh-hant` are partial — new strings must degrade
  honestly there.
- **Prompt caching is sacred.** Nothing here mutates a live conversation's
  context; "ask about a run" features use a separate utility-model call, never
  a prompt into the running session.
- **Renderer-first.** Prefer existing stores/RPC (`session.list`,
  `getSessionMessages`, `searchSessions`, `profiles.list`, the kanban plugin's
  REST). New backend RPC is marked **B** and needs its own justification.
- **Merge, don't clobber.** Persisted state is scope-keyed
  (`connectionScopedAtom` per connection/profile), merges on refresh, and every
  new profile-keyed localStorage family joins `migrateTilesForProfile` +
  `dropTilesForProfile`.
- **One action, one home; one primitive per concern** (Button, SearchField,
  CardStack, OverlayView, Tip). No bespoke forks.

**Legend** — Effort: **S** small (<1 session), **M** medium (~1 session),
**L** large (multi-session or cross-stack). Layer: **R** renderer-only,
**E** Electron main, **B** backend/plugin work. "Touches" lists the primary
surfaces, not every file.

---

## 1. Market research — what makes agent control feel great

Verified findings per product; the *pattern*, not the pixel, is what we adopt.

### OpenClaw 2.0 (openclaw/openclaw — Gateway + Control UI, Lit+Vite)

Covered in `control-surface-research.md`. Key patterns: **session rail with a
live digest** (expandable per-run status: plan progress, PRs touched, elapsed),
**companion thread** (ask questions *about* a run without contaminating it —
`/btw`, `/side` escape hatches), **selection actions** on transcript text,
**agent switcher** that scopes every page to one agent, session hovercards, and
a persistent cross-session **Workboard**. Hermes already ships the adopted
slice (peek card, PR #20).

### rabbitOS 3 (rabbit.tech, launched 2026-09-22)

Single continuous conversation — the user states an **outcome**, OS3 decomposes
it across up to 5 connected device "rabbits" and reports back on completion or
when a decision is needed. Patterns worth taking: **zero ceremony to start
work** (one box, one outcome), the **report-when-done / decision-needed
contract** for background work, and the legible **node delegation roster**.
Rejected: single-stream/no-session-list, implicit routing (fights
profiles-as-islands).

### AionUi (iOfficeAI/AionUi)

Covered in the research doc. **Team Mode** (leader + teammates, shared task
board, agent↔agent **mailbox**, per-agent permission dialogs + sidebar approval
badges), **per-conversation skill indicator** in the chat header, and a
**preview panel that auto-tracks the files an agent touches**.

### Cursor 2.0

Agent-centric editor: up to **8 parallel agents per prompt** (isolated git
worktrees), a **sidebar for agents and plans**, **plan-with-one-model /
build-with-another** handoff (foreground or background), **consolidated
multi-file diff review**, and a built-in browser tool so the agent verifies its
own changes. Patterns: parallel fan-out, plan→build, unified diff review,
self-verifying preview loop.

### Windsurf 2.0 → Devin Desktop (April 2026)

**Agent Command Center** — a kanban of every running agent (local Cascade +
cloud Devin) in one place; **Spaces** group sessions/PRs/files/context under
one task; voice input; **queued messages**; **revert-to-step** via the table of
contents; Off/Auto/**Turbo** auto-execution tiers. Patterns: the
command-center-of-agents framing, shared-context task grouping, checkpoints.

### Zed agent panel

**Threads Sidebar** grouped by project — each thread shows title, status,
agent; terminal threads sit alongside agent threads; **per-thread worktree
isolation**; **⌃⇥ thread switcher**; thread history that restores both the
thread *and its removed worktree*. Patterns: project-grouped threads, fast
thread cycling, worktree isolation, resilient restore.

### Claude Code Desktop (Code tab in the Claude app)

Parallel sessions with **automatic git worktrees**, drag-and-drop panes
(chat/diff/browser/terminal/editor), **visual diff review with "Review code"**
— the agent leaves inline comments on the diff you can answer or ask it to
revise — **PR monitoring through CI**, app/browser/iOS-simulator preview panes,
**side chats** that use session context without derailing it, connectors
(GitHub/Slack/Linear), and **Dispatch** from a phone. Patterns: the diff view
as a *conversation surface*, CI-watched PRs, phone steering.

### ChatGPT desktop (macOS/Windows)

**⌥Space Chat Bar** — a floating quick-entry that can carry the frontmost app's
context ("Work with Apps" banner); **Voice inside an existing task** — start
talking mid-task, interrupt, steer, check progress without re-typing;
**Computer Use** plugin; iOS **Remote** pairing to reach a desktop host.
Patterns: global hotkey quick-entry with ambient context, voice as a *steering*
modality (not just dictation), phone-as-remote.

### Warp 2.0 (Agentic Development Environment)

Multi-agent management under user control, block-based terminal output, **Warp
Drive** shared knowledge for agents + teammates, cloud-agent **triggers**
(Slack/Linear/GitHub/webhooks) and **schedules**, an agent CLI that follows you
over SSH. Patterns: knowledge-at-the-edges (≈ our skills), event-driven agents,
"the agent is the same on every surface".

### Raycast AI

**Quick AI** floating window one hotkey away; **AI Extensions** — `@`-mention
an installed extension and the AI picks its tool; **presets** (tuned
model+instructions combos); frictionless attachments incl. screen content.
Patterns: launcher-speed entry, `@`-mentionable tool namespaces, reusable
presets.

### Meta Muse (launched ~2026-09-08, iPhone + Mac)

A personal agent that talks **like messaging a person** (app or WhatsApp):
you share a **goal**, it builds a plan, coordinates time/resources, and
**advances work on its own** — proactive nudges, not just answers. Runs on a
dedicated **Secure VM**; **customizable agent name/avatar**; Mac app works
across apps/files/calendar/messages behind **explicit permission grants**.
Patterns: goal→plan→proactive-nudge loop, persona identity, granular
permission surface, phone parity.

### Grok Bot (xAI, beta ~2026-08)

**Bots as teammates**: named, always-on agents with their **own cloud
computer**; you message them like a colleague and they come back **only when
approval is needed**. Signature moves: the bot can **hand its desktop back to
you** (you solve the CAPTCHA/2FA), request a credential through a **secure
form** (never in chat), **record-a-task** teaching, and specialist **chaining**
(bot→bot handoff). Phone/desktop share one thread. Patterns: approval-only
return contract, control hand-back, secure-field asks, teach-by-demonstration,
cross-surface thread parity.

### Linear (project-surface baseline)

Triage inbox discipline, keyboard-first everything, labels/facets, cycle
rollups — the model for our "attention" surfaces.

### Cross-cutting patterns (the thesis)

1. **Inspect without entering** — peek/digest/PR-status layers so a run is
   legible at a glance (OpenClaw, Cursor, Zed, Claude).
2. **Talk *about* work without derailing it** — companion/side channels
   (OpenClaw `/btw`, Claude side chats).
3. **Delegation as a roster, not a pile** — agents/bots/nodes as named workers
   with outcome + state (OS3, Grok Bot, AionUi, Cursor, Devin Desktop).
4. **Approval-aggregation** — one queue of "needs you" across everything
   (AionUi team approvals, Linear triage, OS3 decision cards).
5. **Diffs as the review + feedback surface** (Cursor, Claude, Windsurf revert).
6. **Ambient presence** — menu bar, quick-entry hotkey, HUD, voice, phone
   (ChatGPT, OS3, Grok Bot, Muse, Raycast).
7. **Cost/capability legibility** — context ring exists; next step is spend and
   per-session capability truth (AionUi, BYOK products).

---

## 2. Where the fork already stands

Everything below **exists today** — the roadmap builds on it, doesn't duplicate:

- **Unified rail**: sessions + messaging + cron + bots in one sidebar, grouped
  per profile (`fleet-rail`, `gateway-groups`), projects, pins, unread,
  virtualized list, search (always-mounted after PR #19), filter menu,
  connection switcher, bulk archive (PR #19).
- **⌘K palette**: commands + session search + direct id jump + plugin pages
  (`app/command-palette`, `store/command-palette.ts`).
- **Session tiles/splits**: side-by-side panes, drag-to-swap, tile zones,
  per-tile routing (`chat/session-tile*`, `pane-mirror`, `tile-zone-host`).
- **Composer**: queue + steer, attachments, voice fan (`voice-*`,
  `start-voice-button`), model + reasoning pills, slash pipeline, `@`-refs,
  context ring (PR #22), input history, suggestion pills.
- **Transcript**: render windows, ⌘F find + stored-history mode (PR #23),
  scroll restore, approval `CardStack`, tool diffs, restored-draft notice.
- **Right sidebar**: preview browser (URL bar, console, annotate, script
  runner), files tree, review pane (churn-bar, file-tree, ship-bar), terminal
  panes (persistent, per-agent streams).
- **Overlays/pages**: Settings, Command Center (maintenance + Notices via
  PR #21), Cron (+ blueprints), Profiles, Agents (subagent tree), Starmap,
  Artifacts, Capabilities (skills/plugins/MCP/toolsets/connectors/catalog),
  Messaging, Webhooks, `/kanban` (plugin page + nav row + statusbar count).
- **Ambient**: notifications (toast stack + native + sound), mute per session
  (PR #21), quick-entry window (`app/quick-entry`, `electron/quick-entry.ts`),
  HUD mode (`app/hud`), wake-word + wake indicator, pet overlay.
- **Bots** (`plugins/hermes-bots`): profile-backed personas, canonical
  forever-chat, group chats/rounds, roster pane, per-bot cron, screens.
- **Infra**: pooled `hermes serve` per (connection, profile), remote/SSH/cloud
  connections, `searchSessions` FTS, profile-rename migration, gone-session
  draft rescue.

**Open PRs this roadmap must not duplicate** — #18 (test fixture), #19 (rail
carets, always-mounted search, attention badges, bulk archive), #20 (research
doc + session peek card), #21 (notification history + per-session mute),
#22 (context ring + labeled queue), #23 (transcript-scoped find), #24 (upstream
fix sync). Features below assume these land; anything overlapping an open PR is
framed as its *follow-on*.

---

## 3. The roadmap — 50 features, 6 phases

Phases are ordered by value ÷ effort and dependency. Everything in Phase 1 is
renderer-only and mutually independent — any subset can ship in any order.

### Phase 1 — Everyday flow wins (9 features, all R, all independent)

| # | Feature | Spec | Inspired by | Effort | Layer | Touches |
|---|---------|------|-------------|--------|-------|---------|
| 1 | ⌘K frecency | Rank palette commands/sessions by recency + frequency instead of static order; seeded from open-time history. | Raycast, Linear | S | R | `store/command-palette.ts`, `app/command-palette/index.tsx` |
| 2 | Session tags | User-assigned color/label chips per session (connection-scoped, merge-on-refresh, survives profile rename via `migrateTilesForProfile`); filter-menu facet. | Linear labels | M | R | `store/session-states.ts`, `chat/sidebar/session-row-slots.tsx`, `filter-menu.tsx` |
| 3 | Global history search | ⌘⇧F searches *all* sessions' stored history via existing `searchSessions` FTS; result jumps through `history.revealRow` (PR #23 seam). | OpenClaw sessions, Linear search | M | R | `store/transcript-find.ts` (extend), `command-palette`, `open-session.ts` |
| 4 | Shortcut editor | Settings page listing every rebindable action (reads `$bindings` like `TipKeybindLabel`), record-new-combo, conflict warning. | Warp, Raycast | M | R | `app/settings`, bindings store, `TipKeybindLabel` |
| 5 | Compact rail density | Condensed row variant (dot + title only), per-window persisted toggle; badge/meta still reach the tooltip/peek. | Zed dense threads | S | R | `chat/sidebar/session-row.tsx`, `row-geometry.ts`, `store/display-toggles.ts` |
| 6 | Drag-to-attach | Drop files onto a session row/tile → chips stage in *that* session's composer (no focus steal — badge shows "N attached"). | ChatGPT work-with-apps | M | R (+E for file URLs if needed) | `new-session-drag.ts`, `session-row.tsx`, `composer/attachments.tsx` |
| 7 | Locale completion | Fill ar/ja/zh-hant gaps for shipped strings; add a missing-keys CI check so partial locales can't silently fall behind. | i18n hygiene | S | R | `i18n/*.ts`, `catalog-completeness.test.ts` |
| 8 | Transcript export | "Copy as Markdown" / save `.md` per message and per session; includes tool-call summaries collapsed. | every chat product | S | R | `session-actions-menu.tsx`, `lib/` export helper |
| 9 | Queue inspector | Queue panel gets reorder + edit + remove for pending prompts (queue exists; this is management, not new mechanics). | Cursor/Cascade queue | M | R | `composer/queue-panel.tsx`, `store/composer-queue.ts` |

### Phase 2 — Session legibility (9 features; the "what is my agent doing" pass)

| # | Feature | Spec | Inspired by | Effort | Layer | Touches |
|---|---------|------|-------------|--------|-------|---------|
| 10 | Live digest line | Extend peek card (PR #20) + row with "what it's doing now": current tool, todo progress, elapsed — all existing stores, no model call. | OpenClaw session rail | M | R | `session-peek.tsx`, `session-row-details.ts`, `store/todos.ts`, `$sessionDotStateById` |
| 11 | Report cards | When a background session settles, the attention fold gets a card: outcome line, duration, files touched, CTA (open/archive). Never auto-opens the session. | rabbitOS 3 report-back | M | R | `store/agent-notices.ts`, attention fold, `notify()` |
| 12 | PR + CI chips | Session rows show linked-PR state + CI rollup from `$pullRequestsByBranch`; click opens PR. | Claude Desktop PR monitoring | M | R (+ existing REST) | `chat/pr-tag.tsx`, `store/pull-requests*`, `session-row-slots.tsx` |
| 13 | Session recap | On resuming a stale session, an inline "where it left off" card derived from the stored tail — no model call, dismissible. | OS3 memory, Claude resume | M | R | `route-session-state.ts`, `transcript-tail-cache.ts`, transcript banner |
| 14 | Timeline scrubber | Density minimap along the transcript scrollbar: user/tool/approval markers, click/drag to jump (rides `thread-timeline`). | IDE minimap, Zed | M | R | `store/thread-timeline.ts`, transcript scrollbar host |
| 15 | Capability chip | Chat-header chip: active skills/toolset count + model for *this* session; opens filtered Capabilities view. | AionUi skill indicator | M | R (+B field if not already exposed) | chat header, `capabilities` page, `commands.catalog` |
| 16 | Attention inbox | One overlay aggregating every pending approval / clarify / error across profiles; each row deep-links to the session at its card. | Linear triage, AionUi approvals | M | R | `store/agent-notices.ts`, approval stores, new overlay route |
| 17 | Watch chip | "Watch" a background session → compact live status chip (state dot + current tool) floats in the rail header; click opens it. | Grok Bot check-in | M | R | rail header, `$sessionDotStateById`, `store/session-unread.ts` |
| 18 | Rail multi-select | ⌘/⇧-click selection in the session list → bulk pin/mute/archive/tag (extends PR #19's bulk archive into a selection model). | Linear multi-select | M | R | `virtual-session-list.tsx`, `session-actions-menu.tsx` |

### Phase 3 — Delegation & oversight (8 features; agents as a roster)

| # | Feature | Spec | Inspired by | Effort | Layer | Touches |
|---|---------|------|-------------|--------|-------|---------|
| 19 | Delegation roster | Fleet rail → optional roster page: every active run across profiles as a card (outcome/first-line, state, elapsed, profile); click-through only. | OS3 nodes, Cursor agents sidebar, Devin command center | M | R | `use-fleet-roster.ts`, `fleet-rail.ts`, new overlay route |
| 20 | Goal-first draft | New-session draft offers "state an outcome" framing + plan chips (reuse `suggestion-pills`); explicit profile target stays. | rabbitOS 3 | M | R | composer empty state, `composer-suggestions.ts` |
| 21 | Parallel fan-out | Send one prompt to N explicitly-picked profiles/bots as sibling tiles; never implicit routing — islands preserved. | Cursor 8-agents | M | R | `session-tile-actions.ts`, tile zones, fleet roster |
| 22 | Plan→build handoff | A plan artifact gets "Build with this" → seeds a new session with the plan attached as context file (fresh cache, no mid-conversation mutation). | Cursor plan/build | M | R | artifacts, `open-session.ts`, composer attachments |
| 23 | Agent review pass | "Have ‹bot/profile› review this diff" — seeds a review session carrying the diff as an attachment; results land as a report card. | Claude "Review code" | M | R + thin B (diff fetch may already exist via review pane) | `right-sidebar/review`, session create path |
| 24 | Delegation pill in transcript | When a bot delegates (group round / subagent), a compact pill in the transcript names the worker + state; expands to the subagent tree. | OS3 tachikoma pills, AionUi | M | R + plugin (hermes-bots) | transcript row, `store/subagents.ts`, hermes-bots group rounds |
| 25 | Secure-field ask | Agent's credential/2FA need renders a masked input card that writes to the secret store, never the transcript. | Grok Bot secure form | M | R + B (secret-write RPC) | approval/clarify card family, secrets IPC |
| 26 | Team board lanes | Kanban plugin: lane per profile/bot, drag a card to a lane → delegates to that agent (existing `transfer.ts`/`orchestration.tsx`). | AionUi Team Mode | M | R + plugin | `plugins/kanban/board.tsx`, `transfer.ts`, roster data |
| 27 | Starmap live mode | Starmap nodes animate live state + settle events; click-through opens session; "replay" scrubs the day. | ambient fleet viz | M | R | `app/starmap/*`, `store/starmap.ts` |

### Phase 4 — Review & deliverables (8 features; the diff as a conversation)

| # | Feature | Spec | Inspired by | Effort | Layer | Touches |
|---|---------|------|-------------|--------|-------|---------|
| 28 | Unified session diff | Review pane aggregates *all* files the session touched into one tree + unified diff; open-in-editor per file. | Cursor improved review | M | R + E (git via existing fs/git capabilities) | `right-sidebar/review/*`, electron git capability |
| 29 | Diff comments → feedback | Comment on a diff line → sends structured feedback ("src/x.ts:40-52 — …") into the session composer as a draft. | Devin Review, Claude diff comments | M | R | review pane, composer seed |
| 30 | Agent self-review | "Review changes" runs a *separate* utility review pass over the diff and lands inline comments on the diff view. | Claude Code Review code | L | R + B (utility-model call) | review pane, new RPC or kanban-style plugin REST |
| 31 | Turn checkpoints | Per-turn workspace snapshot (git stash-style); "revert to before this prompt" per user message. | Windsurf TOC revert, Cursor checkpoints | L | B + E | backend checkpoint record, transcript row affordance |
| 32 | Artifact rail | Per-session artifact rail (from the Artifacts page's data): previews + promote-to-file; versioning via existing artifact store. | Claude previews, OpenClaw artifacts | M | R | `app/artifacts`, preview pane, session header |
| 33 | Preview verify loop | "Verify in preview" — agent step opens the built app, reads console errors (existing `preview-console`), iterates; user sees the pass/fail card. | Cursor browser testing | M | R + B (agent-callable, `desktop_ui` toolset seam) | `right-rail/preview-*`, `preview-console-store.ts` |
| 34 | Screenshot annotate → composer | Region capture + markup → attachment with a note; generalizes `preview-annotate` to any screen region. | ChatGPT, Grok Bot | M | R + E (screen capture IPC) | `preview-annotate-*`, composer attachments, electron capture |
| 35 | Deliverable export | Bundle a session's outcome — summary + diff stat + artifacts + PR link — into a shareable Markdown/PDF report. | OS3 report card, Devin summary | M | R | artifacts/session export, `lib/` |

### Phase 5 — Ambient presence & input (8 features)

| # | Feature | Spec | Inspired by | Effort | Layer | Touches |
|---|---------|------|-------------|--------|-------|---------|
| 36 | In-task voice | Voice upgrades from dictation to *steering*: start voice mid-session, interrupt, "what's it doing?" → spoken status from stores (no model call). | ChatGPT Voice, Grok Bot | M | R + B (existing voice-live transport) | `store/voice-live.ts`, composer voice fan, wake-word |
| 37 | Context-aware quick entry | Quick-entry window carries the frontmost app/selection as a context chip; ⌥Space parity, submits to a chosen profile. | ChatGPT ⌥Space, Raycast Quick AI | M | E + R | `app/quick-entry`, `electron/quick-entry.ts` |
| 38 | Menu-bar status | macOS menu bar / tray icon: active-run count, needs-you badge, recent sessions, quick actions. | OS3 ambient, standard tray | M | E | `electron/` tray + menu, status feeds |
| 39 | Notification rules | Per-kind rules on top of PR #21: quiet hours, "digest mode" (batch to hourly), per-session overrides UI. | every modern notifier | M | R | `store/notifications.ts`, `native-notifications.ts`, Command Center Notices |
| 40 | Phone parity links | Per-bot/per-session "continue on Telegram/Slack" deep link + QR (extends `telegram-qr-setup`); gateway presence shown. | Grok Bot, Muse WhatsApp | M | R + B (gateway API exists) | `app/messaging`, hermes-bots row menu |
| 41 | Tile status strip | Each session tile's strip shows live dot + elapsed + current tool (not just active tile). | Zed threads sidebar | S | R | `chat/session-tile.tsx`, status stores |
| 42 | HUD run cards | HUD mode gets compact per-session run cards (progress + needs-you) with click-through to the full window. | OS3 ambient layer | M | R | `app/hud/*`, session stores |
| 43 | Proactive nudges (opt-in) | On settle, offer next-step chips ("open a PR", "schedule a follow-up check") in the attention fold; never auto-acts, never hits the model without consent. | Muse proactive agent | M | R (+B only if a utility suggestion is desired; default heuristic) | attention fold, `composer-suggestions.ts`, cron blueprints |

### Phase 6 — Platform bets (8 features; heavier, backend-involved)

| # | Feature | Spec | Inspired by | Effort | Layer | Touches |
|---|---------|------|-------------|--------|-------|---------|
| 44 | Companion thread | "Ask about this session" — a side thread answered by a utility model over the stored transcript; never touches the live conversation (prompt cache intact). | OpenClaw companion, Claude side chat | L | B (new `session.ask` RPC) + R | new popover/drawer, `tui_gateway` method |
| 45 | Mobile companion | Steer from a phone: paired web client or gateway-platform flow covering status, approvals, quick replies. | Claude Dispatch, Muse iPhone, Grok Bot | L | B + E | gateway REST/webhooks, pairing flow |
| 46 | Record-a-task → skill | Record a UI workflow (in preview/desktop) into a replayable skill artifact the agent can invoke. | Grok Bot teaching | L | B + E + plugin | recording capture, `skills/` write path |
| 47 | Worktree-per-session | Sessions with file writes get an isolated git worktree; row shows worktree + "merge back" affordance; restore recreates missing worktrees. | Cursor, Zed, Claude Desktop | L | B + E | projects/workspaces, electron git, session row |
| 48 | Agent mailbox | Structured async notes between bots/agents (task hand-off payloads with status), rendered in group chats + roster. | AionUi Team Mode mailbox | L | plugin + B | hermes-bots, new plugin RPC |
| 49 | Usage & cost analytics | Per-profile/model/session spend trends; Command Center section; local-only aggregation (opt-in, no telemetry — root rubric). | Warp insights, BYOK dashboards | M | R + existing usage stores | `command-center`, `session.context_breakdown`/usage stores |
| 50 | Cross-device handoff | "Open this session on ‹connection›" — deep-link/QR re-homing a session view to another Hermes device without moving its home. | Grok Bot/Muse cross-surface | M | E + B (remote connections exist) | connections, `open-session.ts`, QR/deep-link |
| 51 | Plugin surface SDK | Formalize the page/pane/statusbar/nav contract used by `plugins/kanban` + `hello-runtime` into a documented, typed API for third-party desktop plugins. | Raycast extensions, AionUi | L | R (docs + type extraction) | `src/plugins/*`, `app/contrib`, docs |

*(51 items — one over target; drop or merge at owner's discretion. #41 is the
weakest standalone and could fold into #10.)*

---

## 4. Sequencing rationale

- **Phase 1** is all renderer-only, independent, and lands value in days; it
  also builds muscle (tags, frecency, queue) later phases reuse.
- **Phase 2** converts data the renderer already holds into legibility —
  highest perceived-quality-per-effort in the whole roadmap.
- **Phase 3** needs Phase 2's roster/attention primitives to exist first.
- **Phase 4** assumes Phase 3's "session = unit of delegable work" model and
  the review pane's file knowledge.
- **Phase 5** is presence/polish — independent of 3–4, can interleave.
- **Phase 6** is where backend spend is justified; each item names its RPC.

### Invariants spot-check per phase

- No feature auto-opens a surface; every "ambient" item is a badge/card/offer.
- Fan-out (#21) and roster (#19) keep explicit profile routing — no OS3-style
  implicit dispatch.
- Companion thread (#44) and agent review (#30) use *separate* model calls —
  the live conversation's prompt cache is never touched.
- Every persisted preference keys by declared scope and joins the
  profile-rename migration pair.
- Backend-touching items (marked B) are Phase 3+ — renderer-first held through
  the cheap phases.

---

## 5. Upstream convergence — the one-gateway cutover

Upstream `NousResearch/hermes-agent` PR
[#106742](https://github.com/NousResearch/hermes-agent/pull/106742)
("One gateway owns every local session") is staged to land with a fast-follow
that re-parents `serve`, remote Desktop, and web onto the canonical
gateway-owned session authority
([unsupportedpastels' entry-point plan](https://gist.github.com/unsupportedpastels/765f9d551ce88ee01630c18367763e75),
aligned with the profile-multiplexing direction #109417). When it lands, the
fork's sync will be a very large merge; the design rule for everything on this
roadmap until then:

- **Route through session/authority lookups, not process-local state.** New
  backend surface stays on the existing `serve` / `tui_gateway` seams; nothing
  may assume the session owner is the pooled standalone `hermes serve` the
  desktop spawns today.
- **Most-affected items:** #40/#50 (device links — post-cutover a remote
  client attaches to the same canonical session rather than re-homing a view),
  #45 (mobile companion — its `/api/mobile/*` routes extend `serve` and will
  ride the cutover), #47 (worktree-per-session — keyed to session identity,
  which survives, but lifecycle/ownership moves), #44/#48 (companion thread,
  mailbox — admissions/queues move to the gateway FIFO).
- **Not a blocker:** every item ships value on today's topology and the
  cutover preserves session identity, queue durability, and controls — the
  seam is what we keep clean, not the feature set.
