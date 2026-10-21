# Desktop revamp plan — from feature pile to agent OS

The execution plan for the next phase of `apps/desktop`, written for Devin (or
any agent) to implement in gated waves of small, validated PRs. Companion to
[`agentic-desktop-roadmap.md`](./agentic-desktop-roadmap.md) (what we built)
and [`control-surface-research.md`](./control-surface-research.md) (why).
Snapshot measured on fork `main` at `02d91043`, September 26, 2026.

It has two goals that must land together:

1. **A full UI/UX rebuild.** Hermes Desktop should stop being "a chat app with
   50 overlays" and become an **agent OS**: one front door for outcomes, named
   teammates who report back, a live fleet you can read at a glance. The best
   of rabbitOS 3, OpenClaw, Grok Bot and Meta Muse, built around one spine.
2. **Survive the upstream gateway rewrite.** Upstream
   `NousResearch/hermes-agent` is replacing the backend topology the desktop
   is built on (one-gateway [#106742] + the `serve` cutover gist, plus the
   `hermes_cli` evacuation [#122491]). Every wave below must work on **today's
   pooled `serve` AND the canonical gateway**, and must not dig us deeper into
   code upstream is deleting.

[#106742]: https://github.com/NousResearch/hermes-agent/pull/106742
[#122491]: https://github.com/NousResearch/hermes-agent/pull/122491

> **Status update (2026-09-28).** A recording of the shipped build showed the visuals and feature quality are
> well short of this plan's goals (one missing-model failure announced five ways; a shipped Assign-task feature that
> fails every time; faint tiny type; no visible teammates). Two follow-up plans now own the visible work, both built
> **on the desktop that exists** (Simple/Advanced modes, the real token/skin pipeline, the pane-shell, the plugin
> seams) with targets rendered from the app's real tokens:
> **[`revamp-visual-plan.md`](./revamp-visual-plan.md) (Wave V)** — tokens, modes, error system, first-run, honest
> states; and **[`bot-mode-plan.md`](./bot-mode-plan.md) (Wave B)** — Bot Mode → Teammates: navigation, features and
> how the plugin is packaged and deployed. Mockups: [`revamp/mockups/png/`](./revamp/mockups/png/). They run
> **before** Wave 3 and supersede its visual scope; Wave 2 (`store/fleet`, Mission Control data) still feeds them.

---

## 1. Diagnosis — why ~50 shipped features didn't make a dent

The roadmap is essentially done: PRs #25–#80 landed digest, report cards,
attention inbox, roster + fan-out, checkpoints, companion thread, nudges,
mobile companion, record-a-task, worktree-per-session, mailbox, handoff links,
the plugin panes SDK, and more. The app still *feels* like the same chat app
because of four structural problems. The features are fine; how they're
wired into the product is what's missing.

**1. Breadth without a spine.** Every feature got its own door. There are 13
route overlays besides chat (`app/routes.ts`: settings, command-center, inbox,
session-import, capabilities, messaging, webhooks, artifacts, cron, profiles,
agents, starmap, roster) plus the `/kanban` plugin page, HUD run cards and the
menu-bar tray. The question *"what is running, and what needs me?"* is
answered by at least **seven** surfaces (Inbox, Agents, Roster, Starmap,
Command Center, Kanban, HUD run cards) plus rail digests and delegation
reports. Each is backed by its own store (`agent-notices`, `attention-inbox`,
`delegation-reports`, `fleet-roster`, `fleet-runs`, `session-digest`, …). No
single view is authoritative, so none of them becomes a habit.

**2. The home surface didn't change.** `DESIGN.md` says *chat is the home
surface*, yet almost all new value lives *off* chat: in overlays, palette
commands, row context menus, or settings toggles. A user who opens the app,
chats, and closes it sees none of the last 50 PRs.

**3. Features are doors, not defaults.** Several headline features are
opt-in (proactive nudges, worktree isolation, quick entry, menu-bar status,
digest-mode notifications) or reachable only from ⌘K or a context menu.
There is no "what's new" moment and no progressive discovery. Wave 0 confirms
each default in the running app.

**4. The codebase taxes every change.** The renderer is ~405k lines: 53
non-i18n source files exceed 1,000 lines, and there are **198** modules in
`src/store/`. The worst offenders sit on every feature's path:

| File | Lines | Upstream #106742 touches it? |
|---|---|---|
| `app/session/hooks/use-session-actions/index.ts` + `utils.ts` | 5,447 | no |
| `store/session-states.ts` | 2,864 | lightly (+8/−) |
| `store/gateway.ts` | 2,490 | **yes, 119 lines** |
| `app/chat/sidebar/index.tsx` | 2,388 | no |
| `components/pane-shell/tree/store.ts` | 2,282 | no |
| `store/session.ts` | 1,762 | lightly |
| `app/gateway/hooks/use-gateway-boot.ts` | 1,633 | check at sync |
| `app/chat/sidebar/profile-switcher.tsx` | 1,632 | no |
| `components/assistant-ui/thread/list.tsx` | 1,627 | no |
| `app/chat/composer/index.tsx` | 1,612 | no |
| `app/chat/right-rail/preview-pane.tsx` | 1,602 | no |

**Thesis:** the next leap is **a redesign around one spine, not more
features.** One fleet model, one "needs me / running" view, the agent-OS
experience layered on top of it, safe features on by default, measurably fast.
All of it must be built on seams that survive the gateway cutover.

---

## 2. The upstream gateway changes — what they do to us

### 2.1 What's changing upstream (state as of 2026-09-26)

**One gateway ([#106742], open, CI green).** Replaces competing writers
against `state.db` with one `SessionAuthority` per profile: a durable FIFO of
admissions, generation-fenced claims, replay epochs, and unknown-execution
recovery. CLI, TUI, local Desktop, API, ACP, bots and cron become **readers and
submitters** over the gateway WebSocket with single-use tickets. Session policy
(model, provider, toolsets) is frozen at creation, with no process-env reads.
Desktop is an **attach-only client**: quitting the app leaves the gateway
running, and `hermes gateway stop` is the explicit teardown. Its desktop-side
diff (file stat only):

- **Deleted:** `store/pool-limits.ts`, `gateway-spawn-priority.test.ts`,
  `test/pool-retirement-renderer.ts`, and parts of `store/profile.ts`. The
  pooled `hermes serve` per (connection, profile) is going away.
- **Added:** `store/pending-submissions.ts` (send retry identity for ambiguous
  acks), `runtime-gone` handling, `apps/shared/src/gateway-events.ts`,
  `session-http-mutations.ts`, and replay handling in
  `apps/shared/src/json-rpc-gateway.ts` (+ `json-rpc-gateway-replay.test.ts`).
- **Rewritten:** `store/gateway.ts` (119 lines), `store/notifications.ts`,
  `store/updates.ts`, `types/hermes.ts`.
- **Backend:** `tui_gateway/server.py` −1,424 lines, split into
  `agent_factory.py`, `session_registry.py` and `command_discovery.py`;
  `methods_bot_relay.py` −225; `hermes_cli/web_server*` and
  `web_routers/sessions.py` reworked.

**`serve` cutover (the entry-point gist, fast-follow).** `serve`, remote
Desktop (URL / Cloud / SSH) and web reach the canonical authority instead of
hosting their own agent. It ships as 4 PRs: serve cutover → remote Desktop/
browser → legacy-host removal → producer fixes. It is gated on #109403
(desktop replay-gap recovery), #109404 (detach a subscription without stopping
execution), #109405 and #109412. Touchpoints named for us:
`electron/remote-lifecycle.ts`, `electron/main.ts`,
`apps/shared/src/json-rpc-gateway.ts`. The rules: *"no Desktop-only recovery
framework"*, *"closing a viewer must not terminate the shared owner"*, and
*"an unavailable owner never causes legacy fallback."* It sits beside profile
multiplexing (#109417): one `hermes gateway run` serves every profile.
`tui_gateway/agent_factory.py` is deleted once callers migrate. The web
dashboard is on a deprecation path, so **Desktop is the primary GUI.**

**`hermes_cli` evacuation ([#122491], draft, phases 0–2 of 11 done).**
Behavior-neutral moves: `hermes_cli.profiles` → `profiles/`,
`hermes_cli.gateway_*` → `gateway/`, service manager → `gateway/`, process
helpers → `runtime/`. Later phases move plugins, providers, auth, commands,
**Kanban**, and automation, then cut the entry point over to `nous_cli`. No
permanent re-export shims. It depends on #106742. Maintainers have said they'll
review big refactors **after** one-gateway merges.

**Not yet reviewed:** the specific comment
`#issuecomment-5657057905` on #106742 was not readable from this session.
Whoever picks this up reads it first and amends this section if it changes
anything.

### 2.2 What that breaks or changes in the fork

| Fork surface | Why it's exposed | Plan |
|---|---|---|
| Pooled-serve settings (`pool-limits.ts`, "warm bot backends", "backend idle timeout", spawn priority; ~20 renderer files) | Upstream deletes the pool | Don't polish or extend. Hide them behind a capability probe (below); remove them at sync. |
| `store/gateway.ts`, `use-gateway-boot.ts` | Upstream rewrites the transport/boot path | **Don't split before the sync** (Wave 1 defers 1.3). Changes here now become merge conflicts. |
| Fork backend methods on `tui_gateway/server.py`: `session.ask` (companion), mailbox, checkpoints, worktree, record-a-task | Upstream moves this file's content into `agent_factory` / `session_registry` | Wave 0.4 inventories each; the sync re-homes them onto the authority. The companion and mailbox **must admit through the authority**, not in-process dispatch (upstream lists hosted rooms as the same known gap). |
| Mobile companion routes `hermes_cli/web_routers/mobile.py` (`/api/mobile/*` on `serve`) | `serve` stops owning conversations; #122491 relocates `hermes_cli` domains | Keep routes thin: they call session APIs and hold no session state. At cutover they move onto the gateway API with the rest of serve's conversational routes. |
| Fork Python importing `hermes_cli.profiles` / `hermes_cli.gateway_*` | #122491 moves them | New fork backend code goes in the owning subsystem, never under `hermes_cli`. Repoint imports at each upstream sync; no in-tree compat pointers. |
| Kanban (`plugins/kanban` desktop page ← `hermes_cli/kanban*.py`) | #122491 phase 8 moves Kanban ownership | Desktop talks to it only through its REST/RPC wire contract, so the move is invisible to the renderer. Keep it that way. |
| Local-session lifecycle ("quit stops the backend") | Desktop becomes attach-only; quitting leaves work running | The UX must say so: tray/menu-bar "Hermes is still working (3)", an explicit "Stop gateway" action, report-back on relaunch. |

### 2.3 New client contracts the UX must design for (they're coming either way)

These aren't optional polish. The cutover makes them real states, and a
"next level" UI shows them honestly instead of glitching:

- **Attached / detached / replaying / snapshot-recovered** per session. Detach
  never cancels. After a replay gap, the transcript recovers from an
  authoritative snapshot, with drafts and completed turns preserved.
- **Ambiguous send.** The send is admitted but the ack is lost, then retried
  with the same identity: no duplicate bubble, no "failed" flash. The composer
  shows *sending → queued → running*, fed by `pending-submissions`.
- **Unknown execution.** A run whose owner died becomes `unknown` and blocks
  its queued followers until an authorized resolution. It's a **Needs you**
  item: "Run interrupted — outcome unknown. Resume / mark done / discard",
  never an auto-retry of ambiguous tool effects.
- **Shared controls.** One approval answered on the phone, TUI or another
  window settles everywhere. The card animates out as "Answered elsewhere",
  never as an error.
- **Cross-surface presence.** The same canonical session can be open in TUI,
  Desktop, phone and web. Show viewers ("also open in TUI · phone") if and
  when the authority exposes it. Until then, show nothing rather than guess.
- **Owner restart.** "Reconnecting to Hermes…" is a soft state on the affected
  rows, not a full-screen boot overlay.

### 2.4 Compatible with both topologies — the rule

The desktop must work against **(a) today's pooled `serve`** and **(b) the
canonical gateway**, from one codebase, using the AGENTS.md ladder:

- **Probe capabilities, don't sniff versions.** One resolver
  (`store/backend-capabilities.ts`, a new small module) answers `canonicalAuthority`,
  `replayEpochs`, `pendingSubmissionIdentity`, `sharedControls`,
  `attachOnlyLifecycle`, `viewerPresence`. Every surface in §2.3 reads from it.
  A missing capability means a degraded, honest state, never a fork-only
  recovery framework.
- **New UX consumes the fleet model, never transport internals.** `store/fleet`
  (Wave 2) is the only thing Mission Control, the rail, the header strip, HUD,
  tray and mobile read. At cutover only `store/fleet`'s adapters change.
- **Key everything by durable session identity** (lineage root for
  compression-surviving state), never by the pooled process or socket.
- **No new backend RPC on `tui_gateway/server.py`** until after the sync.
  Anything a redesign item needs from the backend waits, or reuses
  existing `session.*` / `profiles.list` / kanban REST.

---

## 3. The experience — Hermes as an agent OS

What we take from each product, and the one thing we refuse (from
`agentic-desktop-roadmap.md` §1, where each was verified):

| Source | Take | Refuse |
|---|---|---|
| **rabbitOS 3** | One box, one *outcome*: decompose, then **report back when done or when a decision is needed**. Legible node roster. | Single stream with no session list; implicit routing across agents (profiles are islands). |
| **OpenClaw** | **Inspect without entering**: live digest rail per session; **companion thread** to ask *about* a run without touching it; selection actions; hovercards. | A Lit web control UI as the product. We stay native. |
| **Grok Bot** | **Bots are teammates**: named, always-on, *come back only when approval is needed*; hand control back (CAPTCHA/2FA); secure-field asks; teach by recording; bot→bot chaining. | Cloud computer by default; Hermes runs where the user chose. |
| **Meta Muse** | Talks like **messaging a person**; **goal → plan → proactive nudge** loop; **persona identity** (name/avatar); explicit permission grants; phone parity. | Acting on its own without consent. Nudges are offers. |

### 3.1 The shell — three zones, one spine

```
┌──────────────┬───────────────────────────────────────┬──────────────────┐
│ TEAM         │  CONVERSATION (home)                  │ CONTEXT          │
│ ▸ Needs you 3│  header: ● digest · PR/CI · skills ·  │ lens tabs:       │
│ ▸ Teammates  │          worktree · ctx ring · ?ask   │  Ask (companion) │
│   ◉ Atlas    │                                       │  Diff / Files    │
│   ◌ Scout    │  transcript (delegation pills,        │  Preview         │
│ ▸ Running  4 │   report cards, checkpoints)          │  Terminal        │
│ ▸ Recent     │                                       │                  │
│ ▸ Scheduled  │  composer: outcome-first, + actions   │                  │
└──────────────┴───────────────────────────────────────┴──────────────────┘
        ⌘⇧M → Mission Control (full view: Needs you · Running · Map · Board)
```

- **Team (left).** Replaces today's sessions/bots/cron rail sections with one
  fleet-backed list: *Needs you* (only when non-empty), *Teammates* (bots with
  persona avatar + presence dot + one-line status), *Running*, *Recent*,
  *Scheduled*. Profiles stay explicit groups, never merged.
- **Conversation (center).** Still the home, and now it carries the value:
  a live header strip, report cards and delegation pills inline, and an
  outcome-first composer.
- **Context (right).** One tabbed lens host. The **Ask** tab (the companion
  thread, OpenClaw style) sits beside Diff/Files, Preview and Terminal. Panes
  stay alive when hidden.
- **Mission Control (⌘⇧M).** One full view replacing Inbox, Roster, Agents
  and Starmap as separate routes: *Needs you* (Linear-style triage),
  *Running* (roster + fan-out + subagent tree), *Map* (Starmap), *Board*
  (links to the kanban plugin page). Old routes redirect to lenses.

### 3.2 The five signature experiences

1. **Outcome launchpad** (OS3 + Muse). The new-chat screen is a front door:
   state an outcome, pick teammate(s) explicitly, optionally "run on N" as a
   fan-out. It shows *Continue* (recaps), *Needs you* (top 3) and *Next
   scheduled*. The first reply renders a **plan card** (reusing plan artifacts
   and the checklist/todos store), and the session gets a **report card** when
   it settles.
2. **Teammates** (Grok Bot + Muse). Each bot has a persona card (name, avatar,
   role line, presence, what it's on), messaged like a person in its canonical
   Bot Chat (identity rules in `src/AGENTS.md` unchanged). The return contract
   is visible: *"Atlas will come back when it's done or needs you."*
   Hand-back-control, secure asks, record-a-task and mailbox hand-offs
   (chaining) all render as first-class cards in the conversation.
3. **Inspect without entering** (OpenClaw). The header strip + hover peek +
   Ask tab. Answer "what's it doing / why did it stop / what's left" without
   opening, interrupting, or touching the prompt cache.
4. **One queue of "needs you"** (OS3 decision cards + AionUi + Linear).
   Approvals, clarifies, secret asks, unknown-execution resolutions (§2.3) and
   mailbox hand-offs across all profiles, in rail, Mission Control, tray,
   HUD and phone, all from `$needsYou`. Answered anywhere, settled everywhere.
5. **Ambient presence** (Muse / ChatGPT / OS3). Tray/menu-bar with running
   and needs-you counts, quick entry, HUD run cards, voice steering, phone
   parity. The attach-only lifecycle makes this essential: work keeps running
   after the window closes, and the user needs to see it.

### 3.3 Visual & motion language

This keeps `DESIGN.md` (flat, tokens, one primitive per concern) and adds
three named contracts, documented in `DESIGN.md` in the same PR that adds them:

- **State colour ramp.** One token set for run states: idle, thinking, tool,
  needs-you, unknown, done, failed. Used by dots, digest lines, cards, tray
  and HUD. No surface-specific colours.
- **Persona tokens.** Avatar ring, accent and presence dot per teammate,
  derived from profile identity. Never free-form colours.
- **Arrival motion.** One 160ms enter/settle for cards (report, needs-you,
  answered-elsewhere), respecting reduced-motion. Motion never masks latency.

### 3.4 Beat every harness — match the table stakes, win on what only Hermes has

Full research: [`harness-research-2026.md`](./harness-research-2026.md)
(Codex app, Cursor 3, Antigravity 2.0, Conductor, Amp, OpenCode, Goose,
Claude Cowork, Poke, Manus, ChatGPT Pulse, OpenClaw). Positioning:

> **The one agent you text, code with, and delegate to, which gets better
> every week, on any model. The desktop is where you watch it work, review
> what it did, and see what it learned.**

**Signature Hermes features (Wave 3b).** These express Hermes's defaults in the
desktop. Every item reuses existing backend data, so none adds RPC to
`tui_gateway/server.py` before the sync.

| # | Feature | Beats | Spec | Layer |
|---|---|---|---|---|
| H1 | **Learning receipts** | everyone (unique) | When a turn saves memory or creates/patches a skill, a compact receipt appears inline: "Learned: *prefers pnpm*" / "New skill: *release-check*" with **View** and **Undo**. Undo means archive the skill (the curator never deletes) or remove the memory entry. Derived from the tool calls already in the transcript. | R |
| H2 | **What Hermes knows** | everyone (unique) | A durable page (a Capabilities lens, not a new route): memories, skills (self-written vs installed), the **curator timeline** (pinned / archived / consolidated / patched, from Command Center → Maintenance), and per-skill usage from insights. Pin, archive and edit live here. | R (+ existing curator/insights reads; verify the RPC in Wave 0.1) |
| H3 | **Run receipts** | Antigravity artifacts | Every settled run's report card bundles plan, todos done/left, diff stat, tests or commands run, preview screenshots, artifacts and PR link. One card, scannable in 5 seconds. | R |
| H4 | **Review queue** | Codex, Conductor | Mission Control **Review** lens: settled runs with changes awaiting you, with accept → merge-back / open PR / send feedback (diff comments → composer). | R |
| H5 | **Start from anything** | Conductor (Linear) | Launchpad + drag targets: a GitHub/Linear issue (existing connectors/MCP), a kanban card, a messaging thread, a file or a screenshot opens a new session, pre-filled, with a worktree offered for git projects. | R |
| H6 | **Fresh-context handoff** | Amp | Near the context limit, the context ring *offers* "Continue in a fresh session" with an **editable** brief (generated by the same utility-model path as `session.ask`). Compression stays the default. The new session starts with a clean cache; the old one is untouched. | R + existing utility path *(gate G6)* |
| H7 | **Daily brief & heartbeat** | Pulse→tasks, Cowork, OpenClaw | A one-click cron blueprint on the launchpad ("Morning brief", "Check my PRs hourly") delivered to the desktop *and/or* the user's messaging platform. Opt-in, and built on cron, never a new feed. | R + existing cron |
| H8 | **Model-freedom cockpit** | Codex / Cursor / Antigravity lock-in | The session header model pill shows provider, local badge, cost-so-far and fallback chain. "Try on another model" is a fan-out to a sibling tile. | R |
| H9 | **Same agent everywhere** | Poke | The Team rail shows messaging threads (Telegram, Slack, …) as first-class conversations with platform badges, and the user can reply from the desktop. Presence shows where the user is also talking to it. | R (messaging sessions already list) |
| H10 | **Share a run** | Amp, OpenCode | Export a run as a local bundle (Markdown transcript + receipts + diff + artifacts). No hosted link: nothing leaves the machine without the user. | R |
| H11 | **Legible permission tiers** | Manus | Approval cards spell out *Allow once / This session / Always for this pattern*, mapped onto the existing approval modes. No new policy. | R |
| H12 | **Off-main-thread rendering** | OpenCode | Markdown/highlight parsing in a worker for long transcripts (lands in Wave 5.1). | R |

**Ease of use (the "beautiful by default" bar).** First run is three choices:
model (free tier default), optional messaging link, and a starter (a coding
project / a daily brief / a teammate bot). Every empty state offers exactly
one next action. Every feature is reachable by name from ⌘K. The user never
needs Settings to get value.

---

## 4. How to work — the method (non-negotiable)

1. **Verify the premise first.** Reproduce current behavior on `main` (dev
   build or e2e) and name the file and line. If this plan is wrong against the
   code, fix the plan (a PR to this doc), don't force the change.
2. **Read the rules for the area:** root `AGENTS.md`,
   `apps/desktop/AGENTS.md`, `apps/desktop/src/AGENTS.md`, `DESIGN.md`. They
   bind every item: *offer, don't hijack*; profiles are islands; prompt caching
   is sacred; state lives with its authority, keyed by declared scope;
   profile-keyed persistence joins `migrateTilesForProfile` +
   `dropTilesForProfile`; one primitive per concern; i18n in all 9 locales.
3. **Cutover-safe (§2.4) or it doesn't merge.** Every PR description answers:
   *does this touch transport/boot/pool/`tui_gateway` server code? If yes, why
   now and not after the sync?*
4. **Refactors are behavior-neutral and separate.** Split PRs move code, and
   tests move with the code. Never mix a split with a behavior change.
5. **Small, focused PRs off latest `main`**, with conventional-commit titles.
   Rebase when `main` moves, and use merge commits on branches you don't own.
6. **Prove it before pushing.** From `apps/desktop`: `npm run typecheck`,
   `npm run lint`, `npx vitest run <affected>`. UI changes get dev-build
   screenshots or a recording in the PR.
7. **Behavior contracts, not snapshots.** 1–2 invariant tests per change,
   proven red on base. No change-detectors and no source-reading tests.
8. **Escalate UX forks.** The gates in §6 are the owner's.

**Parallelism budget (SWE-2 cap = 5):** the parent orchestrator plus at most 3
children (`swe-2-high`) at a time, leaving 1 slot of headroom.

---

## 5. The waves

### Wave 0 — Baseline, inventory, cutover map (no product change)

- **0.1 Feature inventory** → `docs/revamp/inventory.md`. For each roadmap
  item #1–#51: entry points, default state, owning store, and a verdict
  (*default-on / surface-in-context / keep advanced / retire*). Verified in the
  dev build.
- **0.2 Perf harness** → `e2e/perf/*.spec.ts` + a fixture generator. Covers
  cold start, session switch, 2k-message transcript scroll, composer keystroke
  latency while streaming, and a 500-session rail across 3 profiles. Record in
  `docs/revamp/baseline.md`; the CI job is non-blocking for now.
- **0.3 Shape metrics** script (`scripts/ts-shape-metrics.mjs`): files over
  1,000 / 1,500 lines, and the store count.
- **0.4 Cutover conflict map** → `docs/revamp/cutover-map.md`. Every fork
  backend method/route added since the last upstream sync (`git log` on
  `tui_gateway/`, `hermes_cli/web_routers/`) with its upstream destination
  (authority method / gateway API / owning subsystem per #122491) and the
  renderer call sites that use it. Read the unreviewed #106742 comment here.
- **0.5 Dual-topology e2e fixtures.** Extend `tests-js` mock-server so the
  desktop e2e can run in *pooled* and *canonical* modes. Canonical mode
  simulates replay gap, ambiguous ack, unknown execution, and an approval
  answered elsewhere, mirroring the gist's acceptance tests 1–6 and 9–10 from
  the client side.

Lanes: {0.1}, {0.2 + 0.3}, {0.4 + 0.5}.

### Wave 1 — Refactor the spine (behavior-neutral)

| # | Family | When |
|---|---|---|
| 1.1 | `use-session-actions/index.ts` + `utils.ts` → create / open / resume / archive / fork / tile routing / gone-session | now |
| 1.2 | `store/session-states.ts` → tiles persistence, rename migration (keep `migrate`/`drop` together), route memory, owner hints | now |
| 1.4 | `chat/sidebar/index.tsx` + `profile-switcher.tsx` → shell, sections, filter/sort model, switcher menus | now (Wave 3 rebuilds it) |
| 1.5 | `composer/index.tsx` + `thread/list.tsx` | now |
| 1.6 | `pane-shell/tree/store.ts` | now |
| 1.3 | `store/gateway.ts` + `use-gateway-boot.ts` | **after the upstream sync.** Split the post-sync file, not today's. |

Each PR quotes before/after shape metrics, keeps the suite count unchanged, and
fixes any doc that names a moved symbol. Lanes: {1.1, 1.2, 1.5}, then {1.4, 1.6}.

### Wave 2 — The spine: `store/backend-capabilities` + `store/fleet` + Mission Control

- **2.1 `store/backend-capabilities.ts`** (§2.4). One resolver; on today's
  backend it answers "pooled, no replay, no shared controls". Pool-limit
  settings render only when `canonicalAuthority` is false.
- **2.2 `store/fleet/`** consolidates `agent-notices`, `attention-inbox`,
  `delegation-reports`, `fleet-roster`, `fleet-runs` and `session-digest` into:
  - `$fleetRuns`: every live/recent run with its state from the §3.3 ramp,
    including `unknown`.
  - `$needsYou`: approvals, clarifies, secret asks, unknown-execution
    resolutions and mailbox hand-offs, each with a deep link.
  - `$teammates`: bots with persona, presence and current activity.
  - `$reports`: settled-run report cards.

  It's a pure derivation over existing stores/RPC behind a thin **source
  adapter** per topology, keyed by durable session identity. All consumers
  migrate, the old stores are deleted, and reference identity is preserved on
  no-ops.
- **2.3 Mission Control** *(gate G1)*. Lenses Needs you / Running / Map /
  Board; old routes redirect; `⌘⇧M`; one titlebar needs-you badge.

Lanes: 2.1 ∥ 2.2 first, then 2.3 ∥ consumer migrations.

### Wave 3 — The agent-OS shell (the visible rebuild)

- **3.1 Team rail** (§3.1 left zone) on `store/fleet` *(gate G2)*.
- **3.2 Conversation header strip**: state + digest, PR/CI, worktree
  (merge-back), capability chip (today's `SkillTag`, widened to toolset + model),
  context ring, and an **Ask** button. The peek card becomes its hover detail.
- **3.3 Context lens host**: one tabbed right zone (Ask / Diff·Files / Preview
  / Terminal) replacing ad-hoc right-rail toggles; panes stay alive.
- **3.4 Outcome launchpad + plan card + report card** (§3.2 #1) *(gate G2)*.
- **3.5 Teammate persona cards + the return contract** (§3.2 #2). Hand-back,
  secure ask, record-a-task and mailbox hand-off cards are unified into one
  card family in the transcript.
- **3.6 One composer `+` menu**: attach, region capture, record-a-task,
  fan-out, plan→build, voice steering, Ask. The slash palette and ⌘K invoke
  the same actions.
- **3.7 Cutover-state UX** (§2.3): send states from pending submissions,
  answered-elsewhere, unknown-execution resolution card, soft reconnecting
  rows. Built against the Wave 0.5 canonical fixtures and inert on pooled
  backends through `backend-capabilities`.

Lanes: {3.1, 3.2, 3.3} → {3.4, 3.5, 3.6} → {3.7}.

### Wave 3b — Signature Hermes (§3.4)

Only after Wave 3's shell lands, because every item renders into it. Order by
uniqueness first:

1. **H1 learning receipts + H2 What Hermes knows.** The single biggest
   "only Hermes does this" moment. Ship together.
2. **H3 run receipts + H4 review queue.** Parity with Codex / Antigravity /
   Conductor on top of Mission Control.
3. **H5 start-from-anything + H7 daily brief + H9 same agent everywhere.**
4. **H6 fresh-context handoff** *(gate G6)*, **H8 model cockpit**, **H10 share**,
   **H11 permission tiers**. H12 rides Wave 5.1.

Lanes: {H1+H2}, {H3+H4}, {H5, H7, H9} → {H6, H8, H10, H11}. G4's freeze lifts
for these items only once Wave 4 ships, *or* the owner may pull H1+H2 earlier.

### Wave 4 — Defaults & discovery

- **4.1 Default flips** *(gate G3)*, from the inventory verdicts. Anything that
  only ever *offers* is a candidate: nudges, menu-bar status, digest
  notifications for background sessions, frecency. Worktree isolation gets
  offered in context. An explicit prior user choice always wins.
- **4.2 What's new, once per update**: a Notices entry + titlebar badge with
  "Show me" buttons. Never a modal.
- **4.3 Contextual tips** via `components/tips`, capped at one per day.
- **4.4 ⌘K as the index**: every product noun is reachable, with frecency on.

### Wave 5 — Feel: speed, polish, finish

- **5.1** Perf budgets become blocking; fix the top two regressions (likely
  broad subscriptions in rail and transcript rows).
- **5.2** Primitive + token sweep (raw colours, `className` overrides,
  `title=`, `transition-all`) as lint rules.
- **5.3** Keyboard & a11y pass on all new surfaces, plus reduced-motion.
- **5.4** Locale completion (`ar`, `ja`, `zh-hant`) and a missing-keys CI check.

### Wave S — The upstream sync (triggered when #106742 merges)

This runs as its own track, owned by one session, and pauses the other waves
only for the files it touches:

1. Merge upstream `main`. Accept upstream's transport/pool deletions;
   delete fork pool UI rather than port it.
2. Re-home each fork backend method using the 0.4 cutover map: companion
   `session.ask` and mailbox admit through the authority; checkpoints, worktree
   and record-a-task sit on the session registry; mobile routes follow serve's
   conversational API.
3. Flip `store/fleet`'s source adapter and `backend-capabilities` to canonical;
   run both e2e topologies.
4. Now do Wave 1.3 (split `store/gateway.ts` / boot) on the merged file.
5. Repeat the import repoint for each #122491 phase as it lands upstream.
6. Once the serve cutover PR 2 (remote Desktop) lands, verify
   `remote-lifecycle.ts` behavior: disconnect closes transport only, and never
   falls back to a legacy host.

---

## 6. Owner decision gates

- **G1 — Mission Control merge.** Retire Inbox / Roster / Agents / Starmap
  routes into one view with lenses (redirects kept)? *Recommend yes.*
- **G2 — Agent-OS shell.** Replace the current rail and empty state with the
  Team rail + outcome launchpad (§3.1–3.2), with a "classic" toggle for one
  release? *Recommend yes.* This is the redesign.
- **G3 — Default flips.** Approve the per-feature list from Wave 0.1.
- **G4 — Feature freeze.** No new roadmap features until Wave 4 ships; bug
  fixes and upstream syncs continue. *Recommend yes.*
- **G6 — Signature Hermes scope.** Approve §3.4 H1–H11. In particular,
  H6 (fresh-context handoff) as an *offer* beside compression, and whether
  H1+H2 (learning receipts / What Hermes knows) may jump the freeze.
  *Recommend yes to both*: learning is Hermes's identity and today it's
  invisible.
- **G5 — Upstream alignment.** Build the §2.3 cutover-state UX *ahead* of the
  upstream merge, against fixtures? *Recommend yes*: it's inert on pooled
  backends and makes the sync a switch-flip instead of a scramble.

---

## 7. Sequencing at a glance

```
Wave 0  inventory ∥ perf+metrics ∥ cutover map + dual-topology fixtures
   │
Wave 1  session-actions ∥ session-states ∥ composer/list → sidebar ∥ pane-tree   (gateway.ts split deferred to Wave S)
   │
Wave 2  backend-capabilities ∥ store/fleet ──► Mission Control           [G1]
   │
Wave 3  team rail ∥ header strip ∥ lens host → launchpad ∥ teammates ∥ + menu → cutover-state UX   [G2, G5]
   │
Wave 3b learning receipts + knows ∥ run receipts + review queue ∥ start-from / brief / everywhere → handoff, cockpit, share, tiers  [G6]
   │
Wave 4  default flips ∥ what's new ∥ tips + ⌘K index                     [G3]
   │
Wave 5  perf budgets ∥ primitive sweep ∥ a11y + locales

Wave S  (independent trigger: upstream #106742 merges) sync → re-home fork backend → flip adapters → gateway.ts split
```

---

## 8. Known reports to verify in Wave 0 (from community chat, unverified)

- **Bots side-chat lost on round-trip:** Bot row → right-click "Start new chat
  with Bot" → go to Sessions → back to Bots → right-click "Open recent
  session" → the new side-chat appears lost. Check against the `src/AGENTS.md`
  rule that side-chats stay visible in the Sessions sidebar and are never the
  bot row's target. The likely fix belongs in the side-chat visibility path,
  **not** in canonical-chat identity.

---

## 9. Brief for the orchestrating Devin session (copy-paste)

> Implement `apps/desktop/docs/revamp-plan.md`. Read root `AGENTS.md`,
> `apps/desktop/AGENTS.md`, `apps/desktop/src/AGENTS.md`, and `DESIGN.md`
> first, then §2 of the plan (upstream gateway changes) and
> `harness-research-2026.md` before touching anything. Work the method in §4 exactly: verify the premise on `main`,
> behavior-neutral refactors in their own PRs, one focused PR per item off
> latest `main`, and `npm run typecheck && npm run lint && npx vitest run
> <affected>` from `apps/desktop` before every PR, with screenshots for UI.
> Every PR must be cutover-safe (§2.4): no new backend RPC on
> `tui_gateway/server.py`, no changes to `store/gateway.ts`/boot/pool code
> unless required, and new UX reads `store/fleet` + `store/backend-capabilities`
> only. Max 3 children in parallel (`swe-2-high`). Start with Wave 0 (three
> lanes) and Wave 1's first lane. Stop and escalate at each gate in §6 with
> the Wave 0 inventory and cutover map attached. When upstream #106742 merges,
> start Wave S in its own session. Report after each wave with PR links, the
> scorecard rows moved (§10), and anything the code proved wrong.

---

## 10. Scorecard — what "god tier" means, measurably

| Dimension | Target |
|---|---|
| **One glance** | "What's running / what needs me" answered by one view fed by one store, from any surface: rail, Mission Control, tray, HUD, phone. |
| **Chat carries the value** | Header strip, report cards, delegation pills and needs-you visible without opening an overlay. |
| **Fewer doors** | Route overlays go from 13 to about 9; monitoring surfaces become one Mission Control. |
| **Beats every harness** | Every §3.1 table-stakes row in `harness-research-2026.md` is ✅. H1–H11 shipped. A new user sees Hermes *learn something* within their first day without opening Settings. |
| **Teammates feel like people** | Every bot has persona, presence, current activity and a visible return contract. |
| **Defaults that work** | Every shipped feature is on, surfaced in context, or deliberately advanced. None is merely buried. |
| **Cutover-ready** | The same build passes desktop e2e in pooled **and** canonical fixture modes; the Wave S sync needs no renderer UX rewrite. |
| **Fast** | Cold start, session switch, 2k-message scroll, keystroke latency and a 500-session rail are measured in CI. None regresses by more than 10%; the top two improve. |
| **Maintainable** | No non-i18n renderer file over 1,500 lines in the touched families; fleet/attention state is one store family, not six. |
