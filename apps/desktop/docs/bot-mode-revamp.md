# Bot Mode revamp — "god-level" plan

Target: make `src/plugins/hermes-bots/` (Bot Mode) a first-class agent-ops
surface, benchmarked against Manus / OpenManus / Kortix-Suna-class products.

## What exists today (verified in tree)

- Roster pane: one row per profile-bot, avatars/pets, canonical "Bot Chat"
  (one chat per bot, identified by name — see `src/AGENTS.md` invariants).
- Routines pane: cron jobs scoped to the focused bot.
- Group chats: multi-bot rooms with rounds, mentions, presence.
- Bot screen: live thumbnail hero + take-over/hand-back of a bot's headless
  desktop (`screen-pane.tsx`, `screen-hero.tsx`).
- Mailbox + cross-connection relay (`tools/bot_mailbox.py`,
  `tools/bot_relay.py`) — bots DM across gateways.
- MCP setup, skills-hub picker, soul file, edit-profile dialog.
- Desktop surfaces built in the overnight wave that Bot Mode can reuse
  in-context: session artifact rail, watch chips, timeline scrubber,
  delegation pill/reports, roster fan-out (`src/app/roster/fan-out.tsx`),
  notification history + per-session mute, session tags, kanban workboard.

## Competitor bar (what "god-level" means)

From Manus (plan mode, scheduled tasks 2.0, wide research), Kortix Suna
(agent management plane: templates, scoped tools/secrets, triggers,
change-request review), OpenManus (visible ReAct loop, sandbox + browser
computer view):

1. **Task frame, not chat frame.** Plans, run history, deliverables,
   replays — a bot is judged by what it produced, not just what it said.
2. **Managed agents.** One-click templates, one screen for a bot's
   skills/MCP/secrets/model, clone/share a bot.
3. **Fleet coordination.** Fan-out/broadcast, group goals, calendar of
   scheduled work, attention triage across all bots.
4. **Live presence.** What it's doing right now, health, stuck work —
   glanceable without opening anything.

## Ground rules (same as the revamp spec)

- Small PRs off latest `main`, conventional-commit titles, merge on green.
- Bot-identity invariants in `src/AGENTS.md` are hard rules: canonical chat
  by (profile, "Bot Chat" title) — never a stored session id, never
  recency-based resolution, canonical chats stay hidden.
- Behavior-neutral refactors stay separate from features.
- 1–2 invariant tests per change, proven red on base; gates from
  `apps/desktop`: `npm run typecheck`, `npm run lint`,
  `npx vitest run <affected>`.
- Reuse existing desktop surfaces inside the bot context rather than
  re-implementing them.

## Phases

### Phase A — Roster as an ops surface (legibility, all renderer)

- **A1 Live status line** — roster row shows what the bot is doing now:
  current turn phase/tool for the canonical chat + active cron run;
  idle/unknown honest fallback. Reuse presence + session-state atoms.
- **A2 Attention rollup** — per-bot unread/needs-you badge fed by the
  attention inbox; attention-first sort option on the roster toolbar.
- **A3 Runs feed** — "Runs" section on the bot pane: recent activity for
  that profile (canonical-chat turns, routine runs, relay deliveries,
  group rounds) as cards: kind icon, status, duration, outcome, jump to
  transcript. Read-only roll-up of existing signals.
- **A4 Per-bot notifications** — roster context menu gets mute/quiet-hours
  scoped to the bot's sessions (reuse per-session mute plumbing).
- **A5 Roster search + sort menu** — filter by name/title; sort recent /
  alpha / attention. Toolbar row, device-local prefs.
- **A6 Group-chat badges** — unread badge + last-round one-liner on group
  rows in the roster.

### Phase B — Mission frame (Manus-class task UX)

- **B1 Plan mode** — `/plan` (or composer chip) in a bot chat: agent
  produces a structured plan, rendered as an editable/approvable card;
  approve → executes; dismiss → normal turn. Uses goal-first drafting +
  existing approval plumbing. Desktop-side card + backend turn flag.
- **B2 Plan checklist** — approved plan renders as a live step checklist
  in the transcript header; steps check off as the turn progresses
  (derive from turn markers/tool calls — read-only projection).
- **B3 Deliverables rail per bot** — aggregate the artifact rail across
  all sessions owned by the bot's profile; per-bot "Deliverables" tab.
- **B4 Run replay** — each run card opens its transcript span (jump to
  turn range via the timeline scrubber).
- **B5 Watch bot** — roster context "Watch" subscribes to the bot's
  canonical chat activity (reuse watch chips).
- **B6 Routine run history** — routines list gains past/future run cards
  linking to the run's transcript (Manus Schedules 2.0 pattern);
  "continue in same chat vs new session" toggle per routine.

### Phase C — Managed agents (Kortix-style)

- **C1 Bot templates** — preset picker at top of create dialog
  (Researcher / Engineer / Ops / Custom): pre-seeds title, soul stub,
  suggested skills, model default. Presets are local data, not backend.
- **C2 Capabilities tab** — Edit Profile gains a "Capabilities" section:
  that bot's enabled skills, MCP servers, and toolsets in one read/edit
  view (reuses mcp-setup + skills-hub-picker internals).
- **C3 Model quick-swap** — roster context menu "Model" submenu via the
  existing model picker.
- **C4 Clone bot** — context-menu "Duplicate" → copies profile + bot meta,
  fresh canonical chat.
- **C5 Export/import bot** — bundle profile dir + ui_meta bot pack to a
  shareable archive; import via create dialog.

### Phase D — Fleet coordination (multi-bot)

- **D1 Broadcast** — select N bots → one prompt delivered to each
  canonical chat in parallel; replies collected into a comparison view
  (wide-research lite; distinct from group rounds which are sequential).
- **D2 Group goal + summary** — group chats get a stated goal; when a
  round completes, a summary card lands in the room (uses the group
  rounds plumbing).
- **D3 Routines calendar** — calendar/schedule view across all bots'
  routines: next-run strip + day view (Manus Schedules 2.0).
- **D4 Stuck-work triage** — fleet strip on the roster header: failed
  relay deliveries, dead backends, timed-out routines — click-through to
  the offender.

### Phase E — Recovery & health

- **E1 Run stop/pause** — stop affordance on in-flight run cards (maps to
  turn cancel / routine disable).
- **E2 Bot health badge** — consecutive failure counter on roster rows
  (cron failures, relay timeouts); clears on next success.
- **E3 Relay retry** — one-click retry for refused/expired envelopes from
  the run card.

### Phase F — Bot console & virtual computer (Grok/Manus-style machine view)

The ask: inside the Electron app, a bot's *computer* — sessions, screen,
and parallel tasks — should be as neat as the virtual-computer views in
Manus/Grok-class agents, not a hidden screen pane.

- **F1 Bot session deck** — the bot pane shows every session the bot owns
  (canonical chat, side-chats, routine-run sessions) as live tiles with
  status; click to open, drag into a pane. Side-chats stay visible here
  even though canonical chats stay hidden in the Sessions sidebar (that
  invariant is for the sidebar, not the console).
- **F2 Computer panel** — the screen hero graduates to a docked computer
  panel beside the bot's chat: live frame, status chip
  (running / paused / not installed), one-click take over / hand back,
  resizable. Built on the existing `screen-pane.tsx` lease + thumbnail
  plumbing — presentation upgrade, no new backend protocol.
- **F3 Parallel tasks per bot** — "New task" on a bot row/pane spawns a
  side-chat session and opens it in a second tile, so one bot runs
  several tasks at once; pooled backends already multiplex sessions per
  profile.
- **F4 Computer quick actions** — from the computer panel: open in full
  pane, copy screenshot, restart screen session, link to the bot's workdir.

### Phase G — Visual redesign pass (the competitor bar, verbatim)

Reference shots: Manus-class three-pane bot workspace and Grok's bot
roster (both supplied by the user). This phase is the *look* — it restyles
what Phases A–F built into the shape users now expect, and adds the small
missing pieces the shots reveal. All renderer.

- **G1 Three-pane mission layout** — the bot workspace is a fixed
  triptych: roster rail | bot chat | context rail. The context rail hosts
  the computer panel (F2) above Routines (existing `cron.tsx`), collapsible
  per section; collapsing yields the classic chat width. Replaces the
  current "everything is a pane you hunt for" arrangement when a bot is
  focused.
- **G2 Activity pills in-transcript** — mid-turn activity renders as
  compact collapsible pills inline in the transcript ("› Reading 62
  unread threads", "› Drafted 6 replies") rather than a wall of tool
  output; expand shows the tool detail. Reuse the turn/tool markers the
  scrubber already reads.
- **G3 Bot personas** — every bot gets a role subtitle under its name in
  the roster and chat header ("Head of Research", "Staff Engineer") plus
  a per-bot accent color for avatar ring + row tint. Role is a one-line
  field on bot meta (default derived from title/description); accent is
  auto-assigned from the avatar hash, overridable in Edit Profile.
- **G4 Roster grouping** — named sections in the roster ("Websites
  Building", …) with collapsible headers; groups are device-local prefs
  layered over the A5 sort. Drag-to-group later; v1 = create/rename/
  assign via row context menu.
- **G5 Inbound event cards** — external events bound to a bot (relay
  deliveries, routine completions, webhook/git events like Grok's
  "Inbound: repo#5 — needs triage" card) render as a distinct compact
  card in the canonical chat — provenance icon, one-line summary, link.
  Read-only projection of signals the mailbox/relay already records.
- **G6 Bot marketplace stub** — a Marketplace affordance on the roster:
  v1 browses bot bundles produced by C5 export (local dir + paste-a-file),
  no registry backend. Ships the UI + import path; a hosted registry is a
  separate later decision.
- **G7 Header model chip** — the bot chat header shows the bot's model
  (the "Claude Sonnet 5" chip in the shots) beside the screen/settings
  affordances; click opens the C3 quick-swap.

## Cutover note

Everything in Phases B–E that touches backend semantics respects the
upstream one-gateway cutover (#106742): new state lives in the authority's
ledger or stays renderer-local; nothing adds process-local
serve-owns-it state. Renderer-only items (A-phase, most of C) are immune
by construction.
