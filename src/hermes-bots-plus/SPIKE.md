# hermes-bots-plus spike (2026-10-25)

Fork Bot Mode 2.0 (`deploy/fork-main:apps/desktop/src/plugins/hermes-bots`, 342 files) bundled
as a disk plugin and loaded through Nous main `710fa8a073`'s real runtime loader (vitest + jsdom,
P1 browser capability, no live site, no gateway).

## Build

- `node build.mjs <dir with node_modules>`: esbuild → `desktop-plugins/hermes-bots-plus/plugin.js`
  (about 1.4 MB, under the 16 MiB route cap). Only `@hermes/plugin-sdk`, `react` and
  `react/jsx-runtime` stay external, so the bundle passes the loader allowlist.
- `nanostores` is bundled into the plugin. `@novnc/novnc` (VNC screen viewer) is replaced by a
  module that throws, so the screen pane shows an error instead of the viewer.
- The plugin id is `hermes-bots-plus`. The storage id (`ID` in `shared.ts`) stays `hermes-bots`,
  so bot looks and sections are shared with the bundled Bot Mode.

## Result

The plugin loads (`status: loaded`). It registers 19 contributions, and all 19 mount without
crashing in jsdom with empty data.

Two of them land in areas Nous main's shell does not render, so they never show up:
- `agents-section` (`SIDEBAR_LIST_TOP_AREA`)
- `bot-header-identity` (`CHAT_HEADER_AREAS.title`)

## Gaps (all handled by `sdk-compat.ts` stand-ins)

| Gap | Count | Effect |
|---|---|---|
| SDK exports missing on Nous main | 27 | Stand-ins: helpers reimplemented (`chatMessageText`, `jobState`, `isMissingRpcMethod`), components render children or nothing, atoms empty. |
| `useSessionView` | 1 | Approximated from the focused session. Tiles read the focused chat, and the transcript (`$messages`) is empty. |
| `host.state.*` atoms missing | 11 | Empty atoms: `cronJobs`, `attentionItems`, `focusedMessages`, `dotStateBySession`, `sessionWorkspaceScopes`, ... |
| `host.*` methods missing | 7 | Stubs: `listCronJobRuns`, `sessionOwner`, profile bundle import/export, file pickers, `listProfileArtifacts`. |
| Contribution areas missing | 2 | See above. |
| Gateway RPCs missing | about 23 | `bots_team.*` (20), `bots_mailbox.*` (3), `bot.kickoff`. They live in the fork's `tui_gateway/methods_bot_team.py`, `methods_bot_mailbox.py`, `contracts/bot_team.py` and `tools/bot_mailbox.py`. Nous main has `tui_gateway.server.register_method`, so an agent plugin can probably register them without a core patch (not verified). |

Not exercised: dialogs, group chat view, real gateway data, the canonical Bot Chat flow, and
running next to the bundled `hermes-bots`.

## Files

- `src/`: fork source (tests included, not run here).
- `sdk-compat.ts`: the stand-ins. Each one records itself in `globalThis.__hermesBotsPlusCompat`.
- `spike/`: the throwaway vitest harness. Copy it into `apps/desktop/src/contrib/` of a Nous main
  checkout to rerun; it writes `/tmp/hbp-spike.json`.
