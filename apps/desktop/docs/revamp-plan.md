# Desktop revamp plan — from feature pile to product

The execution plan for the next phase of `apps/desktop`, written for Devin (or
any agent) to implement in waves of small, validated PRs. Companion to
[`agentic-desktop-roadmap.md`](./agentic-desktop-roadmap.md) (what we built)
and [`control-surface-research.md`](./control-surface-research.md) (why).
Snapshot measured on `main` at `02d91043`, September 26, 2026.

## 1. Diagnosis — why ~50 shipped features didn't make a dent

The roadmap is essentially done: PRs #25–#80 landed digest, report cards,
attention inbox, roster + fan-out, checkpoints, companion thread, nudges,
mobile companion, record-a-task, worktree-per-session, mailbox, handoff links,
the plugin panes SDK, and more. The app still *feels* like the same chat app
because of four structural problems. The features are fine; how they're
wired into the product is what's missing.

**1. Breadth without a spine.** Every feature got its own door. There are
13 route overlays besides chat (`app/routes.ts`: settings, command-center,
inbox, session-import, capabilities, messaging, webhooks, artifacts, cron,
profiles, agents, starmap, roster) plus the `/kanban` plugin page, HUD run cards and the
menu-bar tray. The question *"what is running, and what needs me?"* is
answered by at least **seven** surfaces: Inbox, Agents, Roster, Starmap,
Command Center, Kanban, HUD run cards, plus rail digests and delegation
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
There is no "what's new" moment and no progressive discovery. Unused
features read as missing features.

**4. The codebase taxes every change.** The renderer is ~405k lines: 53
non-i18n source files exceed 1,000 lines, and there are **198** modules in
`src/store/`. The worst offenders sit on the hot path of every feature:

| File | Lines |
|---|---|
| `app/session/hooks/use-session-actions/index.ts` | 3,085 |
| `store/session-states.ts` | 2,864 |
| `store/gateway.ts` | 2,490 |
| `app/chat/sidebar/index.tsx` | 2,388 |
| `app/session/hooks/use-session-actions/utils.ts` | 2,362 |
| `components/pane-shell/tree/store.ts` | 2,282 |
| `sdk/index.ts` | 2,036 |
| `plugins/hermes-bots/group-chat.ts` | 1,897 |
| `store/session.ts` | 1,762 |
| `plugins/kanban/board.tsx` | 1,639 |
| `app/gateway/hooks/use-gateway-boot.ts` | 1,633 |
| `app/chat/sidebar/profile-switcher.tsx` | 1,632 |
| `components/assistant-ui/thread/list.tsx` | 1,627 |
| `app/chat/composer/index.tsx` | 1,612 |
| `app/chat/right-rail/preview-pane.tsx` | 1,602 |

Each feature PR had to thread through these files. That means regressions,
review fatigue, and no one owns the experience end to end. Nothing measures
performance either, so we can't tell whether 50 features made the app slower.

**Thesis:** the next leap is **consolidation, not addition**. Give the app
one spine (a single fleet model and a single "needs me / running" view),
bring the best features *into chat*, turn safe features on by default, and
make it measurably fast. **No new roadmap features until Wave 4 ships.**

## 2. North star — what "god tier" means, measurably

A scorecard. Wave 0 records the baseline, and each wave must move its rows.

| Dimension | Target |
|---|---|
| **One glance** | From any surface, "what's running / what needs me" is answered by **one** view, fed by **one** store. |
| **Chat carries the value** | The chat header + rail + empty state expose digest, PR/CI, capability, worktree, and needs-you *without* opening an overlay. |
| **Fewer doors** | Monitoring overlays (Inbox, Agents, Roster, Starmap, Kanban-as-status, HUD cards) collapse to **one** Mission Control page with lenses. Route overlays go from 13 to about 9. |
| **Defaults that work** | Every shipped feature is either on by default, surfaced in context, or deliberately advanced. None is merely buried. |
| **Fast** | Cold start, session switch, 2k-message transcript scroll, keystroke-to-paint in the composer, and rail with 500 sessions: all measured in CI with budgets. None regresses by more than 10% from baseline, and the top two improve. |
| **Maintainable** | No non-i18n renderer file over 1,500 lines in the families touched. Fleet/attention state is one store family, not six. |

## 3. How to work — the method (non-negotiable)

This is how the plan expects each session to operate:

1. **Verify the premise first.** Before changing a surface, reproduce the
   current behavior on `main` (dev build or e2e). Name the file and line
   where the problem manifests. If the claim in this plan is wrong against
   the code, fix the plan (PR to this doc), don't force the change.
2. **Read the rules for the area.** Root `AGENTS.md`, `apps/desktop/AGENTS.md`,
   `apps/desktop/src/AGENTS.md`, and `DESIGN.md`. The invariants that bind
   every item: *offer, don't hijack*; profiles are islands; prompt caching is
   sacred; state lives with its authority, keyed by declared scope; new
   profile-keyed persistence joins `migrateTilesForProfile` +
   `dropTilesForProfile`; one primitive per concern; i18n in all 9 locales.
3. **Refactors are behavior-neutral and separate.** A split PR moves code
   and nothing else, and tests move with the code. Never mix a split with a
   behavior change. Refactors come FIRST in any family a feature will touch.
4. **Small, focused PRs off latest `main`.** One PR per item, with a
   conventional-commit title (`refactor(desktop): …`, `feat(desktop): …`).
   Rebase when `main` moves, and use a merge commit, never a force-push, on
   a branch someone else owns.
5. **Prove it before pushing.** From `apps/desktop`, run
   `npm run typecheck`, `npm run lint`, and `npx vitest run <affected files>`.
   UI-visible changes also get a dev-build walkthrough with screenshots in
   the PR. Anything at a seam (profile routing, remote connections) gets a
   real-path check, not only mocks.
6. **Behavior contracts, not snapshots.** 1–2 invariant tests per fix,
   proven red on base. No change-detector tests and no source-reading tests.
7. **Escalate UX forks.** The decision gates in §5 are the owner's. Don't
   guess on anything that changes what the user sees by default.

**Parallelism budget (SWE-2 cap = 5 sessions):** the parent orchestrator plus
up to 3 children run at once, which leaves 1 slot of headroom so a stuck child
never blocks the queue. Children run `swe-2-high`. Each wave below lists its
parallel lanes.

## 4. The waves

### Wave 0 — Baseline & inventory (1 session, no product change)

Goal: turn the diagnosis into data so every later PR can prove it helped.

- **0.1 Feature inventory** → `apps/desktop/docs/revamp/inventory.md`. For
  every roadmap item #1–#51, record: entry point(s) (chrome / palette / row
  menu / settings / overlay), default state (on / opt-in / hidden), which
  store owns its state, and a verdict for §4 Wave 4 (*default-on*,
  *surface-in-context*, *keep advanced*, *retire*). Verify each by running
  the dev build, not by grepping.
- **0.2 Perf harness** → `e2e/perf/*.spec.ts` + a fixture generator. Cover
  cold start to interactive, session switch (warm/cold), scroll a
  2,000-message transcript with tool cards, composer keystroke latency during
  streaming, and a rail with 500 sessions across 3 profiles. Emit JSON. Record
  numbers in `docs/revamp/baseline.md`. Wire it as a non-blocking CI job
  first; it becomes blocking in Wave 5.
- **0.3 Shape metrics** — a small script (`scripts/ts-shape-metrics.mjs`)
  listing files over 1,000/1,500 lines and store count. Record the baseline.
  Wave 1 PRs quote before/after from it.

Lanes: 0.1 ∥ 0.2 ∥ 0.3 (3 children).

### Wave 1 — Refactor the spine (behavior-neutral, mechanical)

Split the god files that every later wave touches. Each split follows the
facade + siblings pattern already used in-tree: the directory keeps an
`index.ts` with public entry points, and topic modules sit beside it. No
re-export shims for internal moves; update imports and fix any `AGENTS.md`
or doc that names a moved symbol in the same PR.

| # | Family | Split by |
|---|---|---|
| 1.1 | `use-session-actions/index.ts` + `utils.ts` (5.4k) | create / open / resume / archive / fork / tile routing / gone-session handling |
| 1.2 | `store/session-states.ts` (2.9k) | tiles-by-profile persistence, rename migration (`migrateTilesForProfile`/`dropTilesForProfile` stay one module), route memory, owner hints |
| 1.3 | `store/gateway.ts` + `use-gateway-boot.ts` (4.1k) | socket lifecycle, connection resolution ladder, re-home shapes (soft/hard/live-swap), boot UI state |
| 1.4 | `chat/sidebar/index.tsx` + `profile-switcher.tsx` (4k) | rail shell, section renderers, filter/sort model, profile switcher menus |
| 1.5 | `composer/index.tsx` + `thread/list.tsx` (3.2k) | composer shell vs. input/attachments/queue/voice/slash; list virtualization vs. row rendering |
| 1.6 | `pane-shell/tree/store.ts` (2.3k) | tree model, ops, persistence |

Rules: each PR ships with `ts-shape-metrics` before/after and a green run of
the affected vitest files. The suite count must be unchanged, with tests moved,
not deleted. Do 1.1–1.3 before Wave 2 and 1.4–1.5 before Wave 3.

Lanes: {1.1, 1.2, 1.3} in parallel, then {1.4, 1.5, 1.6}.

### Wave 2 — One fleet model + Mission Control

**2.1 `store/fleet/` — one derived model.** Consolidate `agent-notices`,
`attention-inbox`, `delegation-reports`, `fleet-roster`, `fleet-runs`, and
`session-digest` into one store family:

- `$fleetRuns`: every live/recent run across connections and profiles
  (identity, profile, state dot, digest line, elapsed, PR/CI, worktree).
- `$needsYou`: approvals, clarifies, secret asks, errors, and mailbox
  hand-offs awaiting the user, each with a deep link to the exact card.
- `$reports`: settled-run report cards (outcome, duration, files, PR).

It's read-only derivation over existing stores/RPC, so there's no new
backend surface. Preserve reference identity on no-ops, and coalesce cosmetic
ticks but flush terminal transitions (per `AGENTS.md`). Keys route through
session identity, not the pooled `serve` process, which keeps it ready for the
upstream one-gateway cutover (roadmap §5). Every existing consumer (rail, HUD
run cards, menu-bar tray, mobile companion status, inbox, roster) migrates to
read from it. The old stores are deleted in the same PR series, not left
behind.

**2.2 Mission Control page** *(decision gate G1)*. One route replaces Inbox,
Roster, Agents, and Starmap as separate overlays. It has three lenses over
`store/fleet`:

- **Needs you** (default lens): the attention queue, keyboard-triaged
  Linear-style (`j/k`, `enter` opens at the card, `a` approve where safe,
  `e` archive). This absorbs Inbox.
- **Running**: roster cards with digest + fan-out entry, plus the subagent
  tree on expand. This absorbs Roster + Agents.
- **Map**: Starmap as a visual lens, not a separate route.

Kanban stays the kanban plugin page (it's a planning surface, not a status
surface), with a "Board" link from Mission Control. Command Center keeps
maintenance, cost analytics, and Notices. Old routes redirect to the matching
lens so deep links and palette commands survive. One shortcut (proposed `⌘⇧M`)
opens it, and the titlebar gets a single needs-you count badge that opens it.

Lanes: 2.1 alone first (it's the spine), then 2.2 ∥ consumer migrations.

### Wave 3 — Bring the value into chat (the home surface)

**3.1 Session header strip.** One consolidated strip in the chat header
reading `store/fleet`: state + digest line, PR/CI chip, worktree chip (with
merge-back), capability chip (today's `SkillTag` from the tile zone strip,
widened to toolset count + model — roadmap #15), context ring, and a
companion-thread button. It replaces scattered per-feature header bits, and
the peek card becomes this strip's hover detail. Priority collapse at narrow
widths comes from one layout table, not per-chip media queries.

**3.2 Rail = live fleet.** Rows read `$fleetRuns`. A pinned **Needs you**
section at the top of the rail appears only when non-empty; it holds
compact cards that open the session at the card. It offers, never navigates.
Report cards land here on settle, not as toasts.

**3.3 Launchpad empty state** *(decision gate G2)*. The new-chat draft becomes
the front door: a goal-first composer (roadmap #20), explicit profile/bot
target, "run on N agents" fan-out toggle, and three compact blocks:
*Continue* (recent + recap), *Needs you* (top 3 from `$needsYou`), and
*Scheduled* (next cron runs). No auto-actions. Each block is a click-through.

**3.4 One composer action menu.** A single `+` menu merges attach, screenshot
region, record-a-task, fan-out, plan→build handoff, voice steering, and
companion ask. The slash palette and ⌘K invoke the same actions (one action,
one home).

**3.5 Transcript polish.** Inline delegation pills and checkpoint revert get
consistent affordances. The timeline scrubber shows needs-you and report
markers from `store/fleet`.

Lanes: 3.1 ∥ 3.2 ∥ 3.4, then 3.3 and 3.5.

### Wave 4 — Defaults & discovery

- **4.1 Default flips** *(decision gate G3)*. Apply the inventory verdicts.
  Candidates to turn on by default: proactive nudges (they are offers, so
  they don't hijack), menu-bar status, notification digest for background
  sessions, frecency ranking. Worktree isolation stays opt-in per project but
  gets offered in context: first multi-file write in a git project → inline
  "isolate future sessions?" chip. Every flip keeps its settings toggle, and
  respects an explicit prior user choice (an unset value flips; a set value
  never does).
- **4.2 What's new, once.** After an update, a dismissible Notices entry (in
  Command Center, and a badge on the titlebar) lists up to 5 features with
  "Show me" buttons that open the feature's own surface. Never a modal.
- **4.3 Contextual tips.** Use the existing `components/tips` rotation to teach
  one feature at the moment it becomes relevant (e.g., first time 2+ sessions
  run → Mission Control tip). Cap one tip per day and respect dismissals.
- **4.4 Palette as the index.** Every feature from the inventory is reachable
  from ⌘K by its product noun, with frecency on.

Lanes: 4.1 ∥ 4.2 ∥ 4.3/4.4 (one child).

### Wave 5 — Feel: speed, polish, finish

- **5.1 Perf budgets become blocking** in CI, using the Wave 0 harness. Fix the
  top two regressions it finds: likely broad store subscriptions in rail rows
  and transcript rows. Verify with the React profiler before and after.
- **5.2 Primitive + token sweep.** Grep for raw hex/rgba, `className` overrides
  of primitive padding/radius, native `title=` on buttons, and
  `transition-all`. Migrate onto `DESIGN.md` primitives. Run it as a lint rule
  where possible so it stays fixed.
- **5.3 Keyboard & a11y pass** across the new surfaces: focus order, single-action
  `Esc`, `aria-label` on icon chrome, and reduced-motion.
- **5.4 Locale completion** for `ar`, `ja`, `zh-hant` (roadmap #7), plus a
  missing-keys CI check.

Lanes: 5.1 ∥ 5.2 ∥ {5.3, 5.4}.

### Wave 6 — Convergence readiness

Before the upstream one-gateway cutover (roadmap §5) syncs, audit that
`store/fleet`, mobile companion, handoff links, worktrees, companion thread,
and mailbox route through session-authority lookups, not the pooled `serve`
process. Output: a short checklist in `docs/revamp/cutover-readiness.md` plus
fixes.

## 5. Owner decision gates (answer before the wave starts)

- **G1 — Mission Control merge.** Retire Inbox / Roster / Agents / Starmap as
  separate routes in favor of one page with lenses (old routes redirect)?
  *Recommendation: yes.* This is the single biggest "dent" lever.
- **G2 — Launchpad empty state.** Replace the current new-chat empty state
  with the goal-first launchpad? *Recommendation: yes*, with a settings
  toggle for a minimal empty state.
- **G3 — Default flips.** Approve the per-feature list produced by Wave 0.1.
  *Recommendation:* flip everything whose verdict is *default-on* and that
  only ever offers (never acts).
- **G4 — Feature freeze.** No new roadmap features until Wave 4 ships;
  bug fixes and upstream syncs continue. *Recommendation: yes.*

## 6. Sequencing at a glance

```
Wave 0  inventory ∥ perf harness ∥ shape metrics
   │
Wave 1  split session-actions ∥ session-states ∥ gateway   → then sidebar ∥ composer ∥ pane-tree
   │
Wave 2  store/fleet (spine) ──► Mission Control ∥ consumer migrations      [G1]
   │
Wave 3  header strip ∥ rail needs-you ∥ composer + menu ──► launchpad, transcript  [G2]
   │
Wave 4  default flips ∥ what's new ∥ tips + palette index                  [G3]
   │
Wave 5  perf budgets blocking ∥ primitive sweep ∥ a11y + locales
   │
Wave 6  cutover readiness audit
```

Waves 0 and 1 unblock everything and change nothing the user sees; start both
immediately after G4. Wave 2 is the spine; don't start Wave 3 until
`store/fleet` is merged.

## 7. Brief for the orchestrating Devin session (copy-paste)

> Implement `apps/desktop/docs/revamp-plan.md` wave by wave. Read root
> `AGENTS.md`, `apps/desktop/AGENTS.md`, `apps/desktop/src/AGENTS.md`, and
> `DESIGN.md` first. Work the method in §3 exactly: verify the premise on
> `main` before changing anything, keep refactors behavior-neutral and in
> their own PRs, one focused PR per item off latest `main`, and run
> `npm run typecheck && npm run lint && npx vitest run <affected>` from
> `apps/desktop` before every PR. Include screenshots for UI changes. Run at
> most 3 children in parallel (`swe-2-high`) to stay under the 5-session cap.
> Start with Wave 0 (three lanes) and Wave 1's first three splits. Stop and
> escalate at each decision gate in §5 with the Wave 0 inventory attached. Do
> not add new features until Wave 4 ships. Report after each wave with: PR
> links, scorecard rows moved (§2), and anything in this plan the code proved
> wrong.
