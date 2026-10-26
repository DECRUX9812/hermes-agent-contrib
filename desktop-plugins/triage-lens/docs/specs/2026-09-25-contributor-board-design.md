# Triage Lens → Contributor Board — Design Spec

Date: 2026-09-25 | Status: implemented + verified (pytest 9 passed, render walk OK, live API proof) | Scope: Phase A (desktop-first, serverless)

## 1. Intent

Turn Triage Lens from a duplicate radar ("am I duplicating?") into the
everyday home for hermes-agent contributors: discover open work → claim it →
do it → prove it. Audience: OSS developers (newcomers first) plus agents.
Success: a contributor goes from "what can I work on?" to a claimed,
de-duplicated task in under 2 minutes, with zero setup.

Non-goals (Phase A): hosted web service, GitHub OAuth app, maintainer-side
review tooling, auto-closing or auto-labeling anything.

## 2. Architecture

- Single file stays: `plugin.js` in `~/.hermes/desktop-plugins/triage-lens/`
  (folder name == plugin id). Plain ESM, `jsx()` calls, imports limited to
  `@hermes/plugin-sdk`, `react`, `react/jsx-runtime`. Inline styles only,
  theme vars only — no hardcoded colors, no Tailwind-at-runtime dependence.
- Read path (unchanged): public GitHub REST search API, unauthenticated,
  `repo:NousResearch/hermes-agent`. Caches: search 5 min, issue bodies
  30 min, in-memory capped at 60 entries.
- Write path (new, opt-in): the pane never writes to GitHub directly (no
  shell, no secrets in renderer). Claiming executes through the
  `triage-check` skill / terminal via `gh` auth the user already has:
  `gh issue comment <n> --body "I'll take this…"`. The pane drafts the
  exact command + comment body, offers copy + a palette command that
  announces the handoff. Claim records persist in `ctx.storage`
  (`claims: {<issue>: {at, expires}}`).
- Agents use `~/.hermes/skills/triage-check/SKILL.md` (same scoring, verdict,
  claim, and expiry rules) — pane and agents agree by construction.

## 3. Surfaces (4 tabs + chrome)

Chrome (unchanged): right-rail pane (360px), full page `/triage-lens`,
sidebar nav, `◉ triage` statusbar chip, 2 palette commands.

- **Check** (exists): duplicate radar. Adds per-card *"Claim this instead"*
  button → switches to Board with the issue preloaded.
- **Board** (new, the daily driver): label-driven task discovery.
  - Filter chips: `🌱 Newcomer` (labels `good first issue`, `up-for-grabs`),
    `🙋 Help wanted` (`help wanted`), `📝 Docs` (`documentation`),
    `⚡ Quick wins` (effort XS/S). Single-select, `All` default.
  - Cards: #number, ISSUE/PR badge, title link, effort badge XS/S/M/L,
    type/severity badges, age, comments, assignee state
    (`unassigned` / `@someone` / `claimed by you`), match bar when a query
    is active. Sort: freshest first. Cap 12 rendered.
  - Effort heuristic (client-side, from title+body+labels): docs/typo →
    XS; single-file/test-only → S; default M; god-file/refactor/core,
    `p0`, or 3+ files hinted → L. Shown as estimate, never fact.
- **Classify** (exists): unchanged, plus its type/severity badges feed Board
  cards for unlabelled issues.
- **Mine** (new): my claims — claim age, 7-day expiry countdown, status resolved per render from the issues API
 (`open` → `completed` when `state_reason == completed` → `not_planned`
 otherwise; PR linkage shown when the API returns linked pull requests), `Unclaim` (deletes
  local record; terminal command offered to retract the comment),
  completed history (green rows, kept indefinitely).

## 4. Claim flow (comment-to-claim + anti-squat)

1. User hits Claim → pane pre-checks: assignee set? recent "I'll take
   this"/"taking this" comments by others? open PR already linked?
   If blocked → names the blocker with a link, refuses the claim.
2. If clear → pane shows the exact `gh issue comment` command + comment
   body; user runs it (or agent skill runs it); local record written
   with `expires = now + 7d`.
3. Before starting work, `run()` re-validates (same pre-checks); a lost
   race surfaces as "claimed by @X 2h ago — review theirs?" instead of a
   duplicate PR. This plus the Check tab are the two anti-duplication
   gates (search-time and claim-time).
4. Expiry: countdown turns amber < 48h, red < 12h; expired claims drop to
   history as `lapsed`. Re-claim allowed after re-check.

Rationale (recorded): GitHub self-assign needs triage permission, which
drive-by contributors lack; comments work for everyone, so claims are
comment-based with local records.

## 5. Data flow

Board load: label query (`label:"good first issue" label:"up-for-grabs" …`
OR-combined per selected chip, `state:open`, `sort:updated`) → filter PRs
vs issues per chip → enrich top 6 bodies (cached) → effort + classify →
render. Text search reuses the Check pipeline (keyword extract → search →
broaden 8→5→3 on zero hits → enrich → score → verdict).

## 6. Error handling

- 403 rate limit → message with computed wait seconds + "repeats come from
  cache"; never a blank pane.
- Empty label result → "No `<chip>` tasks right now — try All or Check" (a
  real state: hermes-agent may have zero `good first issue` labels).
- Network failure → cached results with `stale` note, else friendly error.
- Stale async: generation counter on search; late responses dropped.

## 7. Testing (must all pass before done)

1. `node --check plugin.js` → exit 0.
2. Stub-harness render walk → all surfaces register, no ReferenceErrors.
3. pytest suite (`/tmp/tlens/test_triage_lens.py`, extended): id/folder,
   allowed imports, no foreign backends, no secrets, broadening fallback,
   label queries + effort + claim/expiry logic present, skill in sync.
4. Live proof (unauthenticated): one label search + one keyword search
   against `api.github.com` returning real open items.

## 8. Acceptance criteria

- Fresh machine, plugin installed, no keys: Board renders newcomer tasks
  (or honest empty state) in < 10s on first load, < 1s cached.
- Claim path end-to-end on a real issue: pre-check → comment command →
  Mine shows countdown → expiry logic correct.
- Agents: skill workflow produces identical verdicts on 3 sample intents.
- Look: top-class — gradient verdict banners, match bars, skeleton
  loading, coherent spacing; no hardcoded colors; dark/light safe via
  theme vars.
