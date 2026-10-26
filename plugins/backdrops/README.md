# Backdrops

A desktop plugin for the Hermes app: a rolling **Backdrop gallery** under
**Settings → Appearance** — fresh art drops plus your own photo, applied to the
chat background in one click.

## What it does

- **Gallery of drops.** Eight bundled scenes ship with the plugin; the card also
  refreshes itself from a remote manifest, so new drops appear without a plugin
  update. Offline (or pre-release builds) the bundled set keeps the wall full.
- **Your photo.** Upload any image — it's downscaled the same way the built-in
  tile does (1920px JPEG) and remembered so you can re-apply it after trying a
  drop.
- **One click to apply.** Tiles write the same `custom` Chat Background slot the
  Appearance page's own picker writes, so the app's blend/strength/scene
  machinery renders the result — the plugin is a picker, not a second backdrop
  engine.

## Install

Install the plugin through the Hermes plugin catalog (`hermes plugins install
backdrops`), then enable it under **Capabilities → Plugins** in the app. The
gallery card appears under **Settings → Appearance**, beneath Chat Background.

## How it stays stable

- Everything goes through the documented SDK doors: `APPEARANCE_AREAS.extra`
  for the card, `host.settings` for the `backdrop.*` keys, `ctx.storage` for the
  photo and the gallery cache. No DOM poking, no injected CSS.
- `host.settings` calls are feature-detected: on a Desktop build older than the
  `backdrop.*` keys the card still renders and simply can't apply (it tells you
  once instead of throwing).
- The remote manifest is shape-checked entry by entry — a bad fetch or malformed
  JSON leaves the last good list (or the bundled floor) in place. New drops
  refresh every 6 hours and on demand via the refresh button.

## Shipping a new drop

Append to `plugins/backdrops/backdrops.json` (`id`, `title`, `url`, `thumb`,
`added` as ISO date; paths may be relative to the manifest's own directory) and
commit the images under `backgrounds/`. Installed galleries pick it up on their
next refresh — no plugin release needed. Remote entries merge over the bundled
list by `id`, so a drop can also be fixed or replaced later.

Developers can point the card at any manifest by setting the `manifestUrl`
key in the plugin's `ctx.storage` (e.g. a `file://` or `http://localhost` URL
during development).
