# Bot Context Panel — audit (2026-10-30)

Method: `apps/desktop/scripts/capture-botmode.mjs` renders the REAL panel with
fixture data, shots at preview/botmode/shots/. Source walk of
`plugins/hermes-bots/bot-context-panel.tsx` (390 lines) + pane registration in
`plugin.tsx`. VERIFIED = observed in render or code. UNVERIFIED = needs the
live pane.

## What the pane actually is

`BotContextPanel` is a **routines pane**, not the bot context panel the brief
describes: four tabs (Tasks / Scheduled / History / Saved) listing routine
jobs and run tiles, a create-routine flow, and an "Open chat" footer action.

VERIFIED working: 20s routine poll, last-good list mirrored so a failed
refresh shows the previous list with a stale notice, failed runs render with
an error state (fixture: "Nightly audit — gateway timeout"), working
indicator from `$activeGroupMemberKeys`, owner resolution through the
focused-roster ladder.

## Findings vs the done-bar

1. VERIFIED — **arrives collapsed.** `plugin.tsx` registers the pane
   `hermes-bots:routines` with `defaultCollapsed: true`; it is a thin edge
   tab on first boot and stays shut if the user ever dismissed it. This is
   the biggest "it is not working" contributor — the pane is present but
   invisible.
2. VERIFIED — **no identity/definition editing in the panel.** Persona,
   model, tools/skills, memory live in `edit-profile-dialog.tsx` /
   `profile-config.tsx` off the roster row; the context panel cannot reach
   them. Done-bar asks for editable identity round-tripping in the pane.
3. VERIFIED — **quick actions are thin.** Only "Open chat" and the
   create-routine entry point. No handoff, no stop.
4. VERIFIED — **live activity is routines-only.** No session/group feed
   beyond the cron query; nothing shows "what the bot is doing now" past a
   working dot.
5. UNVERIFIED — stale flash on bot/room switch; motion timing; behavior
   when a routine list is empty for a bot with no cron access.
6. VERIFIED (tooling) — the harness itself was shipping unstyled shots:
   `botmode.html` linked a content-hashed built asset that went stale on
   first rebuild. Fixed on `fix/botmode-preview-styles` (`@/styles.css`
   import like the sibling previews); re-shot at 1440×900 + 1024×768.

## Suggested fix order

a. Stop shipping the pane collapsed (or surface it on first bot DM open).
b. Wire the existing edit-profile dialog into the panel header — the
   machinery exists, it is just unreachable from here.
c. Quick actions row: new chat (exists), handoff, stop.
d. Then the live exercise on desktop.decruxtech.com to fill the UNVERIFIED
   rows before more building.
