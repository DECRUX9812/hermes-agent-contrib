## What does this PR do?

Bot Mode can now answer two different questions truthfully:

- **Who needs me?** — only bots whose canonical `Bot Chat` is genuinely parked on a clarify/approval/sudo/secret prompt.
- **Who is working?** — only bots whose canonical session is mid-turn or whose kanban/tool worker heartbeat is live.

Before this change, the `Active now` strip treated any message in the last 90 seconds as proof of ongoing work, so a bot that had already finished still animated as working. Background input requests were session-scoped in the core renderer but not available to the bundled Bot Mode roster, so the user had to discover them elsewhere.

The new SDK signal is content-free: it exports only runtime session IDs, never question text, commands, secrets, or credentials. Bot Mode matches those IDs against the canonical forever-chat's durable ID and resolved lineage tip. Side chats stay in Sessions and the canonical bot-row identity remains name-based.

## Related Issue

No single issue — this closes the attention/status gap left after Bot Mode became bundled in #87886.

## Type of Change

- [x] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 🔒 Security fix
- [ ] 📝 Documentation update
- [x] ✅ Tests (adding or improving test coverage)
- [ ] ♻️ Refactor (no behavior change)
- [ ] 🎯 New skill (bundled or hub)

## Changes Made

- `apps/desktop/src/store/prompts.ts`
  - Adds `$awaitingInputSessionIds`, a sorted content-free union across clarify, approval, sudo, and secret prompt stores.
- `apps/desktop/src/sdk/index.ts`
  - Exposes that read-only atom through `host.state.awaitingInputSessionIds`.
- `apps/desktop/src/plugins/hermes-bots/plugin.js`
  - Adds a `Needs you` strip and row badge backed by exact canonical session state.
  - Hidden bots with urgent input still surface in the strip.
  - Renames the presence strip to `Working now` and keys it to `host.state.busyBySession` or live worker heartbeats.
  - Recent messages retain their timestamp/pulse but no longer animate the avatar as in-flight.
  - Feature-detects the new SDK atoms so older Desktop hosts keep loading the runtime plugin without false status claims.
  - Replaces the native `title` tooltip on working chips with an accessible `aria-label`.
- Tests cover content-free union/clear behavior, durable + lineage-tip identity matching, side-chat exclusion, hidden urgent bots, exact session busy state, recent-message honesty, and legacy SDK fallback.

## How to Test

1. Run the bundled Bot Mode suite:
   ```bash
   cd apps/desktop/src/plugins/hermes-bots
   node --check plugin.js
   node --test tests/*.test.mjs
   ```
   Expected: **415 passed, 0 failed** on the current PR base.
2. Run the focused renderer store test and Desktop gates:
   ```bash
   cd apps/desktop
   npx vitest run --project ui src/store/prompts.test.ts
   npm run typecheck
   npm run build
   ```
   Expected: **15 passed**, typecheck clean, production build clean.
3. In Desktop, run one bot until it raises a blocking prompt while another chat is focused:
   - The bot appears under **Needs you**.
   - Clicking the chip opens its canonical `Bot Chat`.
   - Answering the prompt removes the signal.
   - A completed reply does not remain under **Working now**.

Additional local evidence: full UI suite **570 files / 5,468 tests passed**; targeted Bot Mode core Python suite **39 passed**; ESLint **0 errors** (117 pre-existing warnings).

## Checklist

### Code

- [x] I've read the Contributing Guide
- [x] My commit messages follow Conventional Commits
- [x] I searched existing open and closed PRs for duplicates
- [x] My PR contains only changes related to this fix
- [ ] I've run the entire Python pytest suite — renderer/plugin change; targeted Bot Mode Python tests passed (39/39)
- [x] I've added tests for my changes
- [x] I've tested on Ubuntu 26.04 / Linux X11 isolated Desktop

### Documentation & Housekeeping

- [x] Documentation update — N/A; behavior and SDK contract are documented inline
- [x] `cli-config.yaml.example` — N/A; no config keys
- [x] `CONTRIBUTING.md` / `AGENTS.md` — N/A; canonical Bot Chat architecture unchanged
- [x] Cross-platform impact considered; renderer-only state and plugin code use existing cross-platform SDK primitives
- [x] Tool descriptions/schemas — N/A; no model tool behavior changed

## Screenshots / Logs

Automated gates above are the authoritative evidence. The isolated current-source Desktop also exercised New Agent creation against a credential-free throwaway `HERMES_HOME`; it created and inherited the model correctly, then surfaced the expected explicit “not logged into Nous Portal” failure instead of fabricating readiness.
