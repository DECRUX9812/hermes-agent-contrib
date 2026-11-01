# Picture Request HUD — Chrome extension (prototype)

A chromeless, always-on-top floating window docked beside Chrome, plus a side
panel that can see your screen **only after you pick it in Chrome's own picker**.

This is the browser half of the HUD story. The Electron desktop app keeps the
full HUD (transparent, per-pixel click-through, global hotkey); the browser can
reach *close* to that surface with Document Picture-in-Picture and cannot exceed
it. See `../../HUD-FEASIBILITY.md` for the measurements behind that claim.

```
extensions/picture-request-hud/
  manifest.json          MV3: side panel + storage + loopback host permission
  background.js          toolbar/command → opens the dock (a gesture is required)
  dock.html              the side panel (docked beside the tab)
  hud.css                one stylesheet for the dock and the floating window
  src/hud-core.mjs       pure logic: geometry, consent machine, error copy
  src/pip.mjs            Document-PiP window + surface injection
  src/capture.mjs        getDisplayMedia wrapper, tracks, teardown
  src/surface.mjs        one HUD surface, host-agnostic (doc is injected)
  src/dock.mjs           dock entry (owns the top-level launch control + capture mirror)
  src/launcher.mjs       the one launch path: open / focus / reuse / named failure
  src/hud-injected.mjs   runs inside the PiP window's realm
  src/bus.mjs            BroadcastChannel between the two surfaces
  tests/hud-core.test.mjs  15 unit tests (node --test)
  tests/launcher.test.mjs   9 unit tests: one window, reuse, remote focus, failures
  tests/e2e-hud.cjs        23 live checks in real Chrome (Playwright)
  tests/visual-hud.cjs     OS-window screenshots + X11 geometry
  tests/stack-hints.cjs    reads the X11 stacking/decorations hints
```

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   pick `extensions/picture-request-hud`.
2. Click the toolbar icon (or `Ctrl/Cmd+Shift+H`) to open the dock.
3. **Launch HUD** — the button at the top — opens the floating window in one
   click. Clicking it again (or from a second panel) brings the open window
   forward instead of making a second one. **Share screen** asks Chrome for a
   source; until you pick one, nothing is captured.

Every launch path — the top button, the quieter **Pop out HUD**, a second
panel — runs through one launcher (`src/launcher.mjs`), so they behave
identically: a window, the same window coming forward, or a named error
(`Needs a click to open`, `HUD not available here`) in the panel. A click never
ends in silence.

Requires Chrome/Edge **116+** (Document Picture-in-Picture).

## Test

```bash
# 1. pure logic — no browser needed
node --test extensions/picture-request-hud/tests/hud-core.test.mjs
node --test extensions/picture-request-hud/tests/launcher.test.mjs

# 2. live end-to-end: real Chrome, real extension, real PiP window, real capture
DISPLAY=:101 node extensions/picture-request-hud/tests/e2e-hud.cjs

# 3. OS-level receipts: window geometry, decorations, stacking hints
DISPLAY=:101 node extensions/picture-request-hud/tests/visual-hud.cjs
DISPLAY=:101 node extensions/picture-request-hud/tests/stack-hints.cjs
```

The e2e run pre-selects a capture source with `--auto-select-desktop-capture-source`
because Chrome's picker is native UI and cannot be scripted. Everything after the
picker is asserted from the live DOM of both surfaces. Screenshots land in
`tests/shots/`.

## What is proven, and how

| Claim | Evidence |
| --- | --- |
| Separate OS window, not a tab | new window target + `xwininfo`: `420x560` top-level, `WM_WINDOW_ROLE "pop-up"` |
| Chromeless | `_MOTIF_WM_HINTS = 0x2,0,0,0,0` — WM decorations off |
| Always-on-top | `_NET_WM_STATE = _NET_WM_STATE_ABOVE, _NET_WM_STATE_STICKY` |
| HUD keeps its size | `resizeTo` from inside the window: requested 420×560, `outerWidth/Height` = 420×560 |
| Screen only after consent | 0 tracks and no indicator before the click; `displaySurface: monitor` after |
| Indicator in both surfaces | `● LIVE` badge + window title prefix in dock *and* HUD DOM |
| Frames visible in the HUD | dock's stream attached to the HUD's `<video>`: 1280×720, playing |
| Stop is honest | tracks stopped, badge cleared, title restored, `srcObject` null |
| Missing gateway | named `BACKEND_OFFLINE` state, not a silent failure |
| No activation → no window | `NotAllowedError` from a fresh document via CDP with `userGesture: false` |
| One click launches the HUD | top-level button click → new window target, `about:blank` HUD surface, label flips to *Bring HUD to front* |
| Never a duplicate | second click, second panel, and `#popout` all reuse: page count unchanged, HUD still `closed: false` |
| Failures are visible | `requestWindow` made to throw → panel shows *Needs a click to open*, no window created, next click recovers |
| One HUD, re-open re-homes it | second click does not create a second window |

## Architecture in one paragraph

The dock is a `side_panel` page. "Pop out HUD" calls
`documentPictureInPicture.requestWindow()` from that click (the gesture is
mandatory) and then **builds the HUD inside the returned window's document**:
markup from `hud-markup.mjs`, stylesheet by absolute extension URL, and a module
script that executes in the PiP realm. Navigating that window anywhere — http,
blob, even data — closes it, which is spec behaviour, so injection is the only
route. Both surfaces run the same `createSurface()` controller against their own
`document`, and they coordinate through a BroadcastChannel: state and stop
requests travel as text, because a `MediaStream` cannot be cloned across
documents. The dock's stream *can* be assigned to the HUD's `<video>` directly
(same origin), which is how frames appear in the floating window.

## Consent and privacy

- Capture starts only from a click on **Share screen** in the surface that owns
  it. Chrome's picker is the consent dialog; there is no other code path.
- While sharing: a red `● LIVE — sharing <source>` badge, a tint on the window
  edge, the window title prefixed `● LIVE`, and Chrome's own "is sharing your
  screen" bar. All four clear together.
- Stop, `track.onended` (Chrome's Stop sharing, a closed shared window, an
  unplugged monitor), `pagehide` and `beforeunload` all tear the tracks down.
- Nothing is sent anywhere until you press **Ask**; the only outbound request is
  a loopback POST to `http://127.0.0.1:9120/api/hud/assist`.
- No persistence of frames. The only stored state is window geometry and the
  optional backend URL.

## Assist backend

The extension POSTs `{task, context:{live, source, surface}}` to
`/api/hud/assist` and renders `{reply|text|message}`. **That route does not exist
on the Hermes gateway yet**, so today the panel shows the `BACKEND_OFFLINE` state
with a 404 hint. Wiring it is one endpoint (or change the URL in
`chrome.storage.local['pru.assist.backend']`); the extension deliberately does not
guess at an unverified gateway contract.

## Known limitations

- **No click-through, no transparency.** Chrome owns the PiP window's pixels.
  Only the Electron HUD can do `setIgnoreMouseEvents(true,{forward:true})` and
  per-pixel alpha.
- **The PiP window cannot navigate.** Any navigation closes it. A HUD that needs
  a different page must be built from injected DOM.
- **One PiP window per document.** Opening a second replaces the first, so a
  second "Pop out" re-homes the existing window instead.
- **Gestures are required.** Neither the PiP window nor `getDisplayMedia` can be
  opened from a background worker; a service worker has no activation to give.
- **Shortcut reach.** `chrome.commands` fires only while Chrome is focused. A
  hotkey that reaches the HUD from another app needs Electron or a native host.
- **Wayland stacking is compositor policy.** X11 gets an explicit
  `_NET_WM_STATE_ABOVE`; on Wayland the compositor decides whether to honour it.
- **DPR.** Everything is computed in CSS pixels and `resizeTo` takes DIP, so a 2×
  display should not double the window — verified at 1× on this host only.
- **Chrome titling.** The PiP window's *OS* title mirrors the opener tab's title,
  so the window list shows the dock's title (`● LIVE — …`) rather than
  "Hermes HUD". The document title inside the PiP window is correct.
- **Assist is unwired** (see above), and there is no screen *understanding* yet —
  the panel sends the task plus capture state, not pixels.

## Platform support

| Platform / browser | Floating HUD | Screen capture | Notes |
| --- | --- | --- | --- |
| Chrome 116+ / Edge 116+ on Windows | yes | yes | always-on-top via the OS topmost flag |
| Chrome/Edge on macOS | yes | yes | floating window level; Screen Recording permission prompt |
| Chrome/Edge on Linux X11 | yes | yes | verified here: `_NET_WM_STATE_ABOVE`, decorations off |
| Chrome/Edge on Linux Wayland | yes | yes | stacking up to the compositor |
| Firefox / Safari | no | n/a | no `documentPictureInPicture`; dock would need a separate port |
| Hermes desktop (Electron) | full HUD | n/a | the only surface with click-through + transparency |
