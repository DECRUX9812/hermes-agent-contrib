# Grok UI — switchable Grok/ChatGPT-style surface for Hermes Desktop

A desktop plugin that gives Hermes a **Grok/ChatGPT AI-native look** while
keeping *every* existing pet, theme, plugin, and feature. It layers on, does
not replace.

## What you get

- **`/grok` full-page route** — unboxed conversational canvas (near-black
  `#0d0e12`, hairline borders, warm-white text, gold accent, floating pill
  composer) over the **real Hermes gateway**.
- **Sidebar nav row** ("Grok") to switch between Classic chat and Grok view —
  one click, nothing else moves.
- **⌘K command** — `Grok: Open Grok view` (keywords: grok, chatgpt, skin,
  style, view).
- **Statusbar chip** — green dot when a session is active.
- Streams deltas off `host.onEvent`; sends via verified `prompt.submit`.

## Switchable

- **View:** click the "Grok" sidebar row to enter Grok view; click any other
  row (Sessions, Kanban, Bots…) to leave. Both coexist.
- **Whole-app skin:** drop `skins/grok.yaml` (already there) and
  `hermes config set display.skin grok` — the CLI, TUI, AND desktop repaint
  live to the Grok palette while pets/plugins keep working. Revert with
  `hermes config set display.skin default` or `/skin default`.

## Install

The plugin lives at `~/.hermes/desktop-plugins/grok-ui/plugin.js` — the app
auto-discovers the folder (rescan via ⌘K → "Reload desktop plugins"). The
laptop pulls it from the VM distributor (:8899) automatically.

## Verified against the real SDK

- Imports only from `@hermes/plugin-sdk` + `react/jsx-runtime` (20 exports
  checked against `sdk/index.ts`).
- Route/nav/palette/statusbar areas match the `kanban` plugin pattern exactly.
- RPC doors verified: `prompt.submit`, `session.list`, `session.create`,
  `session.resume` (no `session.get` — it doesn't exist).
- De-slop gates: no HTML, semantic tokens where provided, loading/empty/error
  states via `Skeleton`/`EmptyState`/`ErrorState`, `useValue` in leaf only.
