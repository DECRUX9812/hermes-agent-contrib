# Bot Context 0.2.1 — release audit

- Tag: `bot-context-v0.2.1` (`9a3c9ba03e`)
- Branch: `overlay/core-patches`
- Plugin version: `0.2.1` (manifest v2, standalone, MIT, 5 tools, 5 hooks, no external dependencies)
- Release: https://github.com/DECRUX9812/hermes-agent-contrib/releases/tag/bot-context-v0.2.1

## Chronology

| Date (local · UTC) | Milestone | Evidence |
|---|---|---|
| 2026-11-02 20:44:32 -0600 · 2026-11-03T02:44:32Z | Initial plugin, 0.1.0: 4 tools, 3 hooks | `2e60baaf16` |
| 2026-11-02 22:09:32 -0600 · 2026-11-03T04:09:32Z | Stock-main portability: queue-discovered `request_id`, `local_only`, session filters, profile rebinding, RPC | `bc057e46ad` |
| 2026-11-03 12:44:54 -0600 · 2026-11-03T18:44:54Z | Muse rail: centered avatar, halo/mood, collapsible sections, approval history | `7b5c4c1542` |
| 2026-11-03 13:12:57 -0600 · 2026-11-03T19:12:57Z | Subagents and Bot tab, 0.2.1 | `c0852ae069` |
| 2026-11-03 13:47:36 -0600 · 2026-11-03T19:47:36Z | Screen status card replaces the black placeholder | `02c57a4f64` |
| 2026-11-03 14:25:33 -0600 · 2026-11-03T20:25:33Z | Clickable avatar, reduced-motion face, outcome-level trajectory | `9a3c9ba03e` |

## Verification

| Claim | Command | Result |
|---|---|---|
| Plugin suite | `pytest tests/plugins/test_bot_context_plugin.py -q` | 66 passed in 10.51s |
| Clean install + stock checkout | `pytest ...::TestCleanInstallAndSharedPath -q` | 5 passed in 5.16s |
| Approval/session/subagent focus | `TestApprovalFlow`, `TestStockHostCompatibility`, `TestSubagents` | 16 passed in 1.48s |
| UI model/panel/face clock | 3 Vitest files | 39 passed |
| TypeScript | `tsc -p tsconfig.json --noEmit` | exit 0 |
| Shipped zip on stock main | release zip installed into fresh `HERMES_HOME`, stock `plugins list --user` | `enabled`, `0.2.1`, source `user` |
| Tools/hooks on stock main | stock `PluginManager` introspection | 5 tools, 5 hooks, no error |
| Stock test runner | `scripts/run_tests.sh tests/plugins/test_bot_context_plugin.py -q` in stock worktree | 63 passed, 0 failed, 3 skipped |
| Video | `ffprobe` addendum | 20.000s, 1920×1080, 30fps, H.264/AAC, 2,908,742 bytes |

The three stock-run skips are the bundled-copy assertions: the test copy points at the installed zip, so “bundled source” discovery does not apply. The installed plugin itself loaded enabled with all 5 tools and 5 hooks.

## Limits

1. Approvals are process-local; prompts held by another gateway/process cannot be answered.
2. Prompts raised before the plugin loads are not retro-indexed.
3. CLI prompts are `local_only` and must be answered in their terminal.
4. The desktop rail changes live in the bundled Bot Mode source; `bot-context-0.2.1.zip` contains only the Python plugin.
5. The 20s addendum shows the connecting screen state, not a live or stopped real screen.
6. Bot switching and the live headed session pass were not verified today.
7. The tag was force-moved during the 0.2.1 audit; current peeled commit is `9a3c9ba03e`.
