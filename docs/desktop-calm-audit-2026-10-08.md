# Calm UI audit — desktop app vs DESIGN.md § Attention

**Date:** 2026-10-08 · **Branch:** claude/cool-cannon-cx2rw7 · **Standard:** `apps/desktop/DESIGN.md` § "Attention — the calm bar" (eight principles + squint test, added in this change; also wired into the `AGENTS.md` hand-off taste test and the DESIGN.md pre-ship checklist).

## Method

Five read-only auditors swept the app in parallel (shell/notifications, chat, bot
workspace, settings/overlays, loading/empty/error states) against the eight
principles. 50 findings returned (10 per area, ranked P1/P2/P3). The orchestrator
re-verified the highest-impact premises in code before anything was edited — every
spot-check held (11/11). Fixes were applied on disjoint file sets, each fixer
re-verifying its own premise.

## Fixed (23 findings)

### Principle 5 — Forgiving
| Location | Change |
|---|---|
| `src/app/settings/local-models-model-rows.tsx` | `window.confirm` (banned) → shared `confirm()` with `destructive: true` |
| `src/app/settings/appearance-settings.tsx` | theme delete now confirms before `removeUserTheme` |
| `src/plugins/hermes-bots/team-org.tsx` | team-member removal confirms before the RPC |
| `src/plugins/hermes-bots/cron.tsx` | routine trash button confirms before `act('remove')` |

`confirm` is re-exported from the plugin SDK (`src/sdk/index.ts`) next to the
pre-existing `ConfirmDialog` export, so plugin surfaces stay inside the import fence.

### Principle 8 — Never a blank screen
| Location | Change |
|---|---|
| `src/app/contrib/wiring.tsx` | 5 lazy overlay `Suspense fallback={null}` → shared `OverlayFallback` (PageLoader + backdrop) |
| `src/app/messaging/index.tsx` | failed platform fetch → `ErrorState` + Retry (was infinite PageLoader) |
| `src/app/profiles/index.tsx` | same pattern (`PanelEmpty` + Retry) |
| `src/app/artifacts/index.tsx` | `catch → setArtifacts([])` no longer masks failure as empty; `ErrorState` + Retry |
| `src/app/quick-open/index.tsx` | Loader row while async search runs (was blank popover); hand-rolled empty + raw button → `PanelEmpty` + `Button` |
| `src/app/activity/activity-tab.tsx` | gated on `$sessionsLoading` (init `true`) — no false "Nothing happening yet" flash; `EmptyState` primitive |
| `src/app/settings/memory/provider-config-panel.tsx` | JSX literal loading label → existing localized `t.settings.providers.loading` |
| `src/plugins/hermes-bots/bot-session-deck.tsx` | `.catch` no longer presents failure as an empty list; `ErrorState` + Retry |
| `src/components/chat/visualization-card.tsx` | bare shimmer text → shared `Loader` (pending + loading states) |

### Principle 7 — Quiet by default
| Location | Change |
|---|---|
| `src/store/native-notifications.ts` | fresh defaults: `turnDone`/`backgroundDone` native notifications **off**; approval, input, turnError, credits stay on; stored prefs still win. `plugin` kept on — plugins notify with actions/links while the user is away (evidence-based exception). |
| `src/app/shell/activity-rail.tsx` | amber attention dot no longer fires for a merely `running` cron job (overdue still does) |
| `src/app/activity/index.tsx` | passive tab badges removed (`cronJobs.length`, `bots.length`); approvals badge kept |
| `src/app/shell/butterbar.tsx` | auto-rotation removed (was 3s peripheral motion); manual pager dots + close retained; hover-pause handlers dropped with it |
| `src/components/remote-display-banner.tsx` | indefinite (`durationMs: 0`) top-center info toast → standard bounded duration + quieter placement |

### Principles 4 & 6 — Obvious next action / Consistent
| Location | Change |
|---|---|
| `src/app/chat/composer/restored-draft-notice.tsx` | literal `×` → Codicon `close` |
| `src/app/command-center/index.tsx` | notices nav section gets explicit Bell icon matching its statusbar entry |
| `src/app/shell/titlebar-controls.tsx` | HUD button glyph `comment-discussion` (collided with rail's Sessions toggle) → `empty-window` |
| `src/app/capabilities/skills/official-skill-detail.tsx` | primary action (Install) `textStrong` → `default` variant |
| `src/app/activity/approvals-tab.tsx` | bespoke emerald/red buttons → `Button` variants + inline Loader busy state; labels via new `common.approve`/`common.deny` keys (en/fr/de/es) |

## Deliberately not changed — needs Ritesh's call (product decisions)

| # | Location | Question |
|---|---|---|
| 1 | `src/plugins/hermes-bots/mission-rail.tsx:506` | Bot tab embeds `BotSessionDeck` (lists up to 50 persisted sessions). `apps/desktop/AGENTS.md` says "no per-bot session browser (removed in #90732; don't add it back)" — possible invariant violation. Not removed unilaterally. |
| 2 | `src/app/command-center/index.tsx` | Overlay bundles 5 disjoint jobs (sessions, notices, system, usage, maintenance) — fails one-screen principle. Proposal: dedupe sessions, move usage charts to Settings › Billing. |
| 3 | `src/app/activity/index.tsx` | Overlay mixes presence, roster, timelines, approvals, cron, character editors. Proposal: Activity = stream + approvals only. |
| 4 | `src/app/webhooks/index.tsx:442` | `<MobileCompanion />` pairing banner inside the Webhooks overlay — two product domains on one screen. Proposal: move to Settings/Devices. |
| 5 | `src/app/retirement-view.tsx:29` | Retired-build notice's only action is "maybe later" — dead end. Needs a real "get supported build" CTA (product/URL decision). |

## Backlog (audit findings not yet fixed)

**Principle 5:** uninstall section hand-rolls inline confirm instead of `ConfirmDialog` (`settings/uninstall-section.tsx:154`); billing `DowngradeConfirm` inline card (`settings/billing/plans-view.tsx:184`); queued-prompt delete has no undo (`chat/composer/index.tsx:785`).

**Principle 7/2:** tip bubbles block Esc, use full `accent` variant, linger 22s (`components/tips/tip-bubble.tsx:69`); updates overlay renders `SyncStatusCard` unconditionally during an update decision (`updates-overlay.tsx:350`); connection rows show up to 3 status pills (`settings/connections-registry.tsx:685`).

**Principle 1:** Command Center sessions tab flashes empty before load resolves (`command-center/index.tsx:294`).

**Principle 3:** queue row clamps to 2 lines, not 1 (`chat/composer/queue-panel.tsx:209`); subagent status rows permanently 2 lines (`status-stack/subagent-section.tsx:58`); goal subgoals wrap unbounded (`status-stack/session-control-goal.tsx:444`).

**Principle 4:** team-org member actions all hidden in a kebab (`team-org.tsx:152`).

**Principle 6:** persona `boxShadow` ring outside the avatar (`hermes-bots/bot-row.tsx:295`); inbox glyph used for 3 different operations (`mission-rail.tsx:193`); hand-rolled starter chips (`hermes-bots/chat-empty.tsx:223`); Lucide `XIcon` instead of Codicon (`assistant-message.tsx:348`); hand-coded buttons (`preview-attachment.tsx:234`); hand-rolled spinner (`free-tier/sign-in-dialog.tsx:342`); bespoke log container instead of `LogView` (`updates-overlay.tsx:521`); `GlyphSpinner` instead of `Loader` (`region-capture/overlay.tsx:442`); paragraph instead of `PanelEmpty` (`pane3d/ui/feed-panel.tsx:58`); `visualization-card` wrapper → `WIDGET_SHELL_CLASS` (ruled out for now — ripples through iframe containment).

## Verification

- **Full typecheck:** `npm run typecheck` passed (exit 0 across `apps/desktop`, Electron main, E2E, and builder configs).
- **Targeted tests for touched surfaces:** `npx vitest run <29 test files>` — **242 passed, 0 failed** in 41.6s.
  - Covers every surface edited: native notifications, butterbar, activity rail, cron, team-org, bot-session-deck, appearance, local-models, messaging, profiles, artifacts, quick-open, memory settings, titlebar, command-center, approvals, visualizations, catalog completeness, and overlay completeness.
- **i18n completeness:** `overlay-gaps.json` ratcheted clean; complete locales (en, de, fr, es) remain 100% complete.
- **Pre-existing test debt identified:** 9 files fail on `main` independently of this work (`wiring-background-queue-drain` broken in the Oct 3 Devin squash `dfded3a18d`; `no-native-title` tripped by untracked `home-feed.tsx` and modified `backdrop-setting.tsx`; `list-session-scroll` timeout; `Backdrop`/`backdrop` timer tests; `voice-prefs`; `webhooks`; `session-actions-menu`; `markdown-blocks` fuzz test). None of those files were modified by this change.

## Known pre-existing branch issues (independent of this work)

- `npm run lint` fails on 4 files never touched in this change: `electron/main.ts:6914`, `electron/popout-window.ts:100,104` (`curly`), `chat/composer/index.tsx:9` (import sort), `contrib/browser-desktop-plugins.test.ts:20` (import sort) — all pre-date this session (worktree content = HEAD for those files).
- Untracked `src/app/chat/home-feed.test.tsx` (session-start WIP) also errors under lint.
- `python scripts/check` fails `health` with 232 pre-existing Python findings vs the upstream sync commit.
