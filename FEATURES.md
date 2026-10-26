# Fork feature triage

Source: `deploy/fork-main` vs Nous main `710fa8a073` (2026-10-25). 825 non-merge commits
(153 feat, 370 fix), 7 already in Nous main. Kinds:
**plugin** = moves here unchanged or nearly · **patch** = needs a core change, lives on a contrib
branch · **drop** = already in Nous main, or not product code.

## P0: the enabler

| # | Feature | Kind | Notes |
|---|---|---|---|
| P1 | Browser desktop-plugins loader (`1ff5dcf331`: `hermes_cli/web_routers/desktop_plugins.py`, `apps/desktop/src/lib/browser-desktop-plugins.ts`, "mount the desktop-plugins routes on the dashboard server") | patch | Verified 2026-10-25: Nous main's webapp has no `desktopPluginsRoot` in its browser bridge, so `runtime-loader.ts` finds no disk roots and loads only bundled plugins. Without P1, nothing in `desktop-plugins/` shows up on example.invalid. |

## Plugins (move here)

| Feature | From | Size | Notes |
|---|---|---|---|
| AgentCraft Studio (three.js voxel studio at `/studio`, Bot Room mascots, demo film) | `apps/desktop/src/plugins/agentcraft` | 318 files | Already plugin-shaped; convert bundled imports to `@hermes/plugin-sdk`. |
| Backdrops gallery | `plugins/backdrops` (+ `desktop/plugin.js`) | 23 files | Agent plugin with a desktop half; needs `__init__.py`. |
| claude-mem memory provider | `plugins/memory/claude-mem` | 2 files | Python plugin. |
| Warm Paper skin, bops staff skin | desktop themes | small | Theme contribution via SDK. |
| Bot Mode 2.0 extras (Team OS, Command Room, mailbox, missions, fleet roster, consensus cards, Activity pane) | `apps/desktop/src/plugins/hermes-bots` | +146 / ~63 files over Nous main's Bot Mode | Nous main ships `hermes-bots` bundled, and the loader skips a disk plugin with a bundled id, so ship as a separate id (`hermes-bots-plus`) that adds panes/pages. Edits to bundled files → patch. Respect the canonical "Bot Chat" invariant in `apps/desktop/src/AGENTS.md`. |
| Kanban team lanes / workboard page | `apps/desktop/src/plugins/kanban` | 7 files | Nous main ships kanban; add as pages from a separate plugin. |

## Patches (core, keep minimal)

| Feature | Area | Notes |
|---|---|---|
| Webapp: profile picker in statusbar, `getVersion`/updates bridge | webapp renderer | Check what Nous main already covers first. |
| Inline visualizations + `create_visualization` tool | gateway + renderer | Tool can be a plugin tool; the iframe card needs a renderer seam. |
| Worktree-per-session (isolate, merge-back, restore) | desktop + backend | Larger; also relevant to HWH. |
| Turn checkpoints + transcript revert | agent | Core turn loop. |
| `insights.get` token/cost breakdown | gateway | Small. |
| Composer: predictions, approval-mode picker, context ring, draft durability | renderer | Many touch core composer files. |
| Rail/session UX (tags, multi-select, density, minimap, recaps, find) | renderer | Pick only what DECRUX9812 uses daily. |
| Surrogate-safe `_json` in `hermes_state_runtime.py` | state DB | Applied to `~/.hermes/hermes-agent` 2026-10-25 (lone surrogates made settle/discard fail). |

## Separate apps (live in `apps/` here)

| App | From |
|---|---|
| Bot Room browser extension (MV3) | `apps/browser-extension` |
| Hermes mobile (Expo) | `apps/mobile` |

## Drop

- Webapp "serve Desktop renderer in browsers": Nous main has `hermes webapp` now.
- `marketing/`, `ui-design/`, `contributors/`, `.github/workflows` edits: not product code.
- The 7 commits `git cherry` shows as already upstream.
- Fix commits (370): re-check each against Nous main only when its feature is ported.

## Order

1. P1 loader patch → test one hello plugin on example.invalid.
2. Backdrops + claude-mem (small, prove the install flow).
3. AgentCraft Studio.
4. Bot Mode extras as `hermes-bots-plus`.
5. Patches, one at a time, only for features in daily use.
