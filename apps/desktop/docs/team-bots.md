# Team Bots — design and status

Team Bots are **shared AI teammates**: a small org of Hermes profiles that share a mission, a
boss chain, budgets, a board's approval, and a memory of what the team has learned. You give a
seat the skills, plugins and credential *names* its role needs, then work with it in the
desktop app — or in Slack, through the messaging gateway that profile already has.

This is the layer a ticket board lacks. Kanban already does execution (atomic claims, runs,
dispatch, decompose). Teams add **who / why / how much / who signs off / what we learned** on
top of it, and reuse Kanban for the *what*.

## Where this lives (plugin, backend, web)

| Piece | Kind | Needs backend changes? | Web-portable? |
|---|---|---|---|
| Team Bots data: org chart, goals, budgets, approvals, learnings, packs | **Backend** (`tools/bot_team.py` + 20 `bots_team.*` RPCs) | Yes — this is the backend part. Ships with Hermes; an older gateway reports "Teams need a newer Hermes" instead of breaking. | n/a (server) |
| Budget hard-stop, dispatcher hold, team context in the session-start prompt | **Backend** (kanban dispatcher + `agent/system_prompt.py`) | Yes, small and cache-safe (session start only). | n/a (server) |
| `/team` page, Hire gallery, bot rows, "Needs you", teammate header | **Desktop plugin** (bundled `hermes-bots`) | No — uses existing RPCs only. | **Yes**: SDK + `host.request` only, no Electron bridge (ESLint-fenced for `team*`). |
| Live pane (every tool call, raw) | **Desktop core** (`store/live-activity.ts`, `app/right-sidebar/live`) | No — reads the `tool.start`/`tool.complete` events every client already receives (full args, full result). | **Yes**: pure renderer state, no bridge. |

In short: the *product surface* is a plugin plus one core pane; the *team model* is backend
code, because budgets and approvals must be enforced where the agent runs, not in a window that
might be closed. A web build of the desktop app needs nothing new for any of it.

## What we took from the field

| Idea | From | Where it lives here |
|---|---|---|
| Org chart, one lead, no cycles, open seats | Paperclip | `tools/bot_team.py` — `upsert_member`, `org_tree` |
| Goal ancestry: the task carries *why* it exists | Paperclip | `goal_ancestry`, `build_brief` ("Reach 10k → Grow blog → Ship posts") |
| Per-agent monthly budget with a hard stop | Paperclip | `check_budget`, `held_profiles`, dispatcher gate |
| Board governance: hires/spend/access need sign-off, never self-approved | Paperclip | `request_approval` / `decide_approval` |
| Append-only audit of every mutation | Paperclip | `bot-teams/audit/<team>.jsonl` |
| Chief-of-staff topology, shared teammates reachable in chat | Grok Bot / Team Bots | `lead` seat; `channels` bindings; role kits |
| Shared learning that compounds | Team Bots | `add_learning` (deduped, ranked) → folded into the brief |
| Shareable org design | Paperclip "company" export | Team Pack (`export_pack` / `import_pack`), data-only |

## Model

`<install root>/bot-teams/teams/<id>.json` — install-wide, like the mailbox, because a team
spans profiles. Profiles stay islands: the team stores *references*, never config or secrets.

- **Seat** — `slot`, `profile` (null = open seat), `role`, `title`, `reports_to`, `lead`,
  `skills`, `plugins`, `credentials` (names only), `status` (active/paused), `budget`.
- **Goal** — hierarchical (`parent_id`), `owner` seat, `status`, `task_ids` (Kanban). Progress
  is **rolled up** from the linked tasks' real status, children into parents.
- **Approval** — `hire | spend | credential | action`. Decided by the board (`you`), or by the
  lead when `policy.lead_decides` — and never by the requester itself.
- **Learning** — short lessons, deduplicated; the most-confirmed are in every brief.
- **Brief** — `bots_team.brief`: role, boss, mission→goal chain, top lessons. **Injected at
  session start only** — never rewritten into a running conversation (prompt cache).

## Delegation: goal → card → teammate

`bots_team.goal.spawn_task` turns a goal into real work: it creates a Kanban card assigned to a
hired seat (default: the goal's owner), links it to the goal, and opens the card's body with that
teammate's brief — role, boss and the mission→goal chain ("Reach 10k → Grow blog → Ship 5 posts")
— so a worker that has never seen the team still knows *why*. Idempotent per (goal, title).
Roll-up reads the card's real board status back, so completing the card moves the goal's bar.

## Enforcement (not just bookkeeping)

- **Dispatcher gate.** `hermes_cli/kanban_db_dispatch._dispatch_lane_task` asks
  `tools.bot_team.held_profiles` before claiming a card. A paused or budget-exhausted seat
  is skipped (`skipped_team_held`); the card stays `ready` and flows the moment the seat
  resumes, the limit is raised, or the month rolls. Fail-open: a broken team store never
  stops the board.
- **Spend is measured, not self-reported.** Each seat's month-to-date spend is read
  (read-only, throttled to 60 s) from that profile's own session ledger (`state.db`, actual
  cost over estimate); hand-recorded spend adds on top.

## Session-start context (cache-safe)

A profile that holds a seat carries the team's stable context into every NEW session's system
prompt on any surface (Desktop, Slack, CLI): `agent/system_prompt.py::_team_parts` →
`tools/bot_team.prompt_section` (role, boss, mission, teammates, top-8 lessons; goals are left
out because they change daily and reach a worker through its task). It is built once per
session like every other prompt block. For a canonical Bot Chat — an eternal session — the text
is hashed into `bot_mode_probe.capability_fingerprint`, so the existing once-per-change epoch
rebuild refreshes it when the team's shape or top lessons move (and only then). Profiles on no
team keep their existing epoch.

## Surfaces

- Backend: `tools/bot_team.py`, `tui_gateway/methods_bot_team.py`, contract
  `tui_gateway/contracts/bot_team.py` (generated to `apps/shared`). 20 `bots_team.*` methods.
- Desktop: `/team` page in the bundled Bots plugin (`team-page.tsx`, `team-org.tsx`,
  `team-goals.tsx`), sidebar row and palette entry. **Simple**: org, goals+progress,
  approvals, learnings. **Advanced** (`host.state.showsAdvancedChrome`): + audit trail,
  approval policy, IDs, Team Pack import/export, delete.

## Web portability

Everything above reaches the backend through `host.request` (gateway JSON-RPC) and renders
with the plugin SDK only — no `window.hermesDesktop`, no Electron. ESLint enforces it for
`src/plugins/hermes-bots/team*` (`no-restricted-properties`). When the desktop app is ported to
the web, `/team` needs nothing: same route, same RPC, same store on the hosted gateway.
Checklist for any new page meant to be web-portable: (1) data via `host.request`/SDK only;
(2) no preload bridge — feature-detect any shell capability behind the SDK; (3) no absolute
file paths in UI state; (4) tier with `host.state.showsAdvancedChrome`, not a core import.

## Bot Mode refresh (Sep 29)

Matched to `revamp/mockups/simple.png`, `teammate-work-simple.png` and `hire.png`, inside the
real app:

- **Hire a teammate** (`hire-gallery.tsx`): the one door for new bots. Shelves, starter cards
  (`bot-starters.ts`; each hires through a C1 preset's skills + model), a "describe the teammate
  you want" box, and **Team Packs** (`team-packs.ts`) that create a whole team with open seats
  via `bots_team.pack.import`. Hire opens the create form pre-filled — one creation path.
- **Needs you** (`triage-strip.tsx`): a quiet section with an amber count and one action per
  row (Answer / Review / Open) instead of an alarm banner.
- **Bot rows**: two lines — name + role, then status dot + live status.
- **Teammate header** in the bot's rail: state badge in the live tone, role · where it lives,
  Message + New task.
- **Live** pane (core): the raw record — every command, its full output, exit code, timing —
  for people who want to watch the agent rather than read run summaries. A "Live" link on each
  run summary opens it at that run; ⌘K "Toggle live activity" too.
- Global polish: 46rem reading column (was full-bleed), conversation titles in tabs render in
  their own case at reading size (chrome tabs keep the uppercase label style).

From Wajo's Fo (launched Sep 2026), kept: proactive "needs you" queue, owning an outcome with
a visible record of what was done (Live + task log + receipts), budgets as the agent's "card"
with a hard stop, escalation to a *teammate* (Team delegation). Left out on purpose: hiring
human assistants into the loop, and an agent-owned phone number/credit card — both are hosted
services, not something a local-first agent should ship.

## Status

Done and tested: store + RPC + contracts, dispatcher gate, measured spend, Team page.
Not done (honest list):
- Slack/Grok-Bot **routing** — `channels` stores the binding names; delivery still belongs to
  the messaging gateway, and a Team Bot behaves as its profile does there. No new adapter.
- Locales beyond English for the Team page (falls back to `en`).
- Auto-creation of approvals from tool calls (today teammates call `bots_team.approval.request`).

## Visual check

Rendered from the real components in Chromium against a fixture gateway (org chart with a paused
seat, an exhausted budget and an open seat; approvals; goal roll-up): desktop
`revamp/evidence/team-page-desktop.png`, phone width `revamp/evidence/team-page-mobile.png` (page
fits; the org chart scrolls horizontally by design). Dark mode was not visually checked — the
harness had no theme provider.
