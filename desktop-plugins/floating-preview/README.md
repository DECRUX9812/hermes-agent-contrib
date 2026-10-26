# Floating Preview Panel

A tear-out preview pane for the Hermes desktop: a fixed, draggable card you
can point at **anything** — a URL, a file path, or an artifact — showing a
**compact tile** that expands to **full details**. It reuses the app's
existing preview infra; it does not build a new preview engine.

```
/home/user/.hermes/desktop-plugins/floating-preview/
├── plugin.js                  the plugin (single file, no build step)
├── tests/floating-preview.test.mjs    vm-harness suite (node:test, no deps)
└── README.md
```

## What it does

- **Floats** — registered as a core `placement: 'floating'` pane, so the
  shell owns drag-by-header, viewport clamping, edge tracking on resize, and
  position/collapse persistence. Drag it anywhere; it stays put across
  reloads.
- **Points at anything** —
  - type a target into the panel's input row (URL, file path, `localhost:3000`,
    bare domain), or
  - ask an agent to open something — the `open_preview` desktop_ui tool emits
    a `preview.open` gateway event and the panel follows it (toggleable
    **Follow** control), or
  - call `window.__floatingPreview.pointAt(...)` from devtools / another
    plugin (accepts a raw string or a `{ kind, label, url }` target object).
- **Compact → expand** — every open lands as a compact tile (label, kind pill,
  compact URL/path, format hint). Click it (or the chevron) to expand:
  - **URL / HTML file** → live `<webview>` on the **same partition core's
    preview uses** (`persist:hermes-preview`), so cookies/session/devtools
    follow. Reload, open-in-browser, load-error state with retry, and
    **Ask Hermes to restart** (the `preview.restart` gateway RPC, with
    progress/complete events rendered inline).
  - **Other files** → metadata card + Reveal in file manager / Open in
    browser / Copy path.
  - **Artifacts** → registry-backed card (nothing on disk — the rail owns the
    full render).

## Grounding (the real seams)

| Piece | Seam |
|---|---|
| Float | `placement: 'floating'` pane role — `pane-shell/tree/renderer/floating-panes.tsx` + `floating-rect.ts` (anchor, clamping, persistence) |
| Target model | `PreviewTarget` in `src/store/preview.ts`; normalization ladder mirrors `localPreviewTarget` (`src/lib/local-preview.ts`) + the backend tool's localhost/domain rungs (`tools/open_preview_tool.py`) |
| Live render | `<webview partition="persist:hermes-preview" webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes">` — the exact contract `PreviewPane` builds (`src/app/chat/right-rail/preview-pane.tsx`) |
| Follow | `preview.open` gateway event — `host.onEvent` (`src/contrib/events.ts`), the same event `usePreviewRouting` routes |
| Restart | `preview.restart` gateway RPC — `host.request` (`tui_gateway/methods_prompt.py`), same call `usePreviewRouting.restartPreviewServer` makes |
| Persistence | `ctx.storage` — source string only, never bytes/`dataUrl` (localStorage bloat), never artifact ids |

**RPC answer:** there is **no** `host.request('preview.open')` — `preview.open`
is an *event* emitted by the backend tool bridge (`tools/desktop_ui.py`), not
a JSON-RPC method, so a plugin can't RPC the core rail open. The floating
panel is the plugin-shaped way to show a preview; it listens to the event and
mirrors it (respecting the Follow toggle). `preview.restart` is the one real
preview RPC a plugin can call.

## How to try it

1. The plugin is already at `<hermes home>/desktop-plugins/floating-preview/
   plugin.js` — the desktop app **auto-discovers** this folder and hot-reloads
   on save (standalone disk door, default-on; `contrib/runtime-loader.ts`).
   If it's not visible yet, hit **⌘K → "Reload desktop plugins"** (or restart
   the app).
2. A **Preview** card appears top-right, floating above the workspace
   (drag by its header; the header chevron collapses it entirely).
3. Type `https://example.com`, `localhost:3000`, or `/path/to/file.html` in
   the input row and press Enter → compact tile → click to expand.
4. In a chat: *"open cnn.com in the preview pane"* → the agent's `open_preview`
   tool fires a `preview.open` event → the floating panel follows (with
   Follow on).
5. Devtools: `window.__floatingPreview.pointAt('https://news.ycombinator.com')`.

## Verification

```
node --check plugin.js
node --test tests/*.test.mjs        # the GLOB form — directory form fails
```

25 tests: the normalize ladder, `compactUrl`/`byteSizeHint`, the
partition-reuse + sandbox invariant (`webviewProps`), target-kind → renderer
mapping, compact vs expanded states, load-error affordances, follow
on/off/no-churn behavior, and the register contract (floating placement,
global door, storage restore).

## Design notes / pitfalls honored

- **Partition reuse**: a detached preview must ride `persist:hermes-preview`
  or session state (cookies, devtools) is orphaned — pinned by test.
- **`dataUrl` targets**: never persisted (storage stores only `source`).
- **Guest-pointer guard**: the webview is sandboxed (`nodeIntegration=no`,
  `sandbox=yes`); the panel never `executeJavaScript`s into it and never lets
  a remote page drive host UI (prompt injection via webview is real).
- **No page reader**: `read_preview` stays core's door (`preview-reader.ts`);
  the float is presentation, per the narrow-waist rule.
- **Collapsed-by-default, expand-to-inspect**: every open lands as a compact
  tile; details are one click away.
- **Hot reload**: event disposers + contribution re-registration are all
  cleaned through `ctx.onDispose`, so saving the file mid-session reloads
  cleanly.
