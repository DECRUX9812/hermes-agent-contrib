# Can the web app have a real HUD window? — feasibility, decision, evidence

**Question.** The webapp (browser-hosted Hermes Desktop) has no HUD mode: the
feature is Electron-only, gated on `window.hermesDesktop.hud` in
`apps/desktop/src/lib/browser-desktop-bridge.ts`, which the browser bridge never
defines. Can a browser give the page a genuine chromeless, always-on-top,
separately movable OS window for the picture-request HUD — and if so, how, while
keeping the existing web app?

**Answer.** Yes, mostly, with one decisive constraint that changes the design:
**Document Picture-in-Picture (Chrome/Edge 116+) gives a real OS window that is
chromeless and asked to stay above other windows, but that window can never
navigate.** Everything the HUD shows has to be built inside the document it is
born with. Click-through and true transparency remain Electron-only. So the
recommendation is a two-tier HUD, not a port:

| Tier | Surface | What it can do |
| --- | --- | --- |
| Full HUD | Electron desktop app (already shipped) | transparent, per-pixel click-through, global hotkey, frameless |
| Browser HUD | webapp / Chrome extension via Document PiP | chromeless, always-on-top, movable, resizable, no click-through |
| Browser fallback | the same panel docked in a Chrome side panel | no separate window at all |

No native-messaging host is needed for this. Native messaging only earns its keep
for OS-global hotkeys or click-through, and both of those are Electron's job.

## Measurements (Chrome 156.0.8078.47, Linux X11, this machine)

These are the facts the design rests on — each one was measured, not assumed.

| Property | Result |
| --- | --- |
| `documentPictureInPicture.requestWindow` available | yes |
| Window is a separate top-level X window | yes — `xwininfo -root -tree`, `420x560`, `WM_WINDOW_ROLE "pop-up"` |
| Window decorations | off — `_MOTIF_WM_HINTS = 0x2,0,0,0,0` (decorations flag, 0) |
| Always-on-top | requested — `_NET_WM_STATE = _NET_WM_STATE_ABOVE, _NET_WM_STATE_STICKY` |
| Size hint honoured | **no** — asked 420×560, got 1280×720; `resizeTo()` inside the window then set 420×560 exactly |
| Openable from a worker / without a gesture | no — `NotAllowedError` when activation is withheld (CDP `userGesture:false`) |
| **Navigating the window** | **closes it** — http:// → closed, blob: → closed, data: → silently ignored |
| Injected `<script type="module">` runs in the window's realm | yes |
| Injected stylesheet by absolute extension URL applies | yes (`border-radius` resolved from the injected rule) |
| Opener can read/write the window's DOM | yes (`pip.document`) |
| Opener's `MediaStream` can be the window's `<video>.srcObject` | yes — 1280×720, playing, live |
| One window per document | yes — a second request takes the first away |
| Screen capture surface | `displaySurface: "monitor"`, capped 30 fps |

One consequence worth stating plainly: **"just point the PiP window at
`?win=hud`" does not work.** That was the obvious design and it is impossible —
the window dies on navigation. The app's HUD surface therefore has to be rendered
*into* the PiP document (a React portal in the app's case, injected DOM in the
extension's case), not loaded as a route.

## Chosen architecture

```
┌─────────────────────────────┐        BroadcastChannel (text only)
│ Chrome side panel (dock)    │◀────────────────────────────────┐
│  • Share screen (consent)   │                                 │
│  • Ask Hermes (loopback)    │        ┌────────────────────────┴──────┐
│  • Pop out HUD ─────────────┼───────▶│ Document-PiP window           │
└─────────────────────────────┘        │  same-origin about:blank doc  │
        stream ───────────────────────▶│  injected markup + module     │
                                       │  its own capture + composer   │
                                       └───────────────────────────────┘
```

- **One surface controller, two hosts.** `createSurface({doc, role})` takes the
  document to drive. The dock passes its own `document`; the floating HUD passes
  the PiP document. Same markup, same CSS, same consent rules — no second UI to
  drift.
- **The PiP window owns its own realm.** `pip.mjs` injects a module script; it
  executes inside the PiP document, so the HUD has its own activation, its own
  capture and its own lifecycle. Closing the dock does not close the HUD.
- **Frames, not objects, cross the boundary.** A `MediaStream` is not
  structured-cloneable, so state crosses as text. The one exception is the same
  origin: the dock assigns its stream straight to the HUD's `<video>`, which is
  how the floating window shows what is being captured.
- **Geometry is applied from the inside.** The size hint is advisory, so the
  window clamps and calls `resizeTo` itself against the display it landed on
  (`clampHudGeometry`: min 320×360, max clamped to `availWidth/Height − 16`, CSS
  pixels so DPR never doubles anything).

## Where the webapp itself goes next

`apps/desktop/src/lib/browser-hud.ts` (in progress) implements the same
`window.hermesDesktop.hud` contract the Electron bridge exposes — `open`,
`close`, `resetLayout`, `setSession`, `onChanged` — but over Document PiP, and
renders the app's real HUD components into a portal host inside the PiP document,
with stylesheets and theme custom properties copied across. That makes the
existing titlebar HUD button and `Ctrl/Cmd+Shift+H` live in the browser build
without the app growing a second HUD implementation. It must use the same
injection rule: no navigation, portal only.

## Fallbacks and error states (all implemented in the extension)

| Situation | Behaviour |
| --- | --- |
| No `documentPictureInPicture` | Pop-out disabled, hint explains, other HUD stays available |
| Request without a gesture | `HUD_NO_GESTURE` — "click again", never a silent no-op |
| Window refused / already open | `HUD_BLOCKED` — one HUD per page |
| User cancels or denies the picker | `CAPTURE_DENIED` / `CAPTURE_CANCELLED`, nothing shared |
| Display busy / unplugged / no source | `CAPTURE_BUSY`, `CAPTURE_NO_SOURCE` |
| Only a tab (capture unsupported) | `CAPTURE_UNSUPPORTED` with recovery hint |
| Share ends externally | tracks stop, badge clears, title restored |
| Gateway missing or 404 | `BACKEND_OFFLINE` with the exact remedy |
| Extension reloaded under the panel | `EXTENSION_CONTEXT_LOST` |

## What is genuinely not achievable in a browser

1. **Click-through.** No API lets a page say "ignore my pointer". Electron-only.
2. **Per-pixel transparency.** The PiP window composites against the desktop
   opaquely.
3. **A global hotkey.** `chrome.commands` needs Chrome focused; the page can't
   register an OS shortcut. Electron-only.
4. **Surviving tab close.** The HUD is owned by the document; close the tab and
   the HUD goes with it.
5. **Opening itself.** Both the window and the capture require user activation.

Each of those is a deliberate Electron feature, which is why the desktop app keeps
the HUD and the browser gets the assistant-window tier.

## Testing

See `extensions/picture-request-hud/README.md` for the exact commands, the
17-check live run, and the X11 receipts. Short version:

```bash
node --test extensions/picture-request-hud/tests/hud-core.test.mjs      # 15 unit
DISPLAY=:101 node extensions/picture-request-hud/tests/e2e-hud.cjs      # 17 live
DISPLAY=:101 node extensions/picture-request-hud/tests/stack-hints.cjs  # X11 hints
```

Manual checks that automation cannot cover: drag the HUD across monitors and
confirm it keeps its size; move it to a 2× display and confirm no doubling;
confirm a second app window behind the HUD stays behind it (needs a real window
manager — this host has none, which is why stacking is verified from the X11
property rather than visually).
