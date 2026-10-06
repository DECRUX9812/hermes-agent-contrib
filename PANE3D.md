# 3D Pane

AI assistants that live on your screen: one transparent, always-on-top window over the work area,
hosting a single React Three Fiber scene where five 3D avatars (Muse, Hermes, Grok, OpenCode and
Claude) rise out of the edge of the window you are looking at, deliver updates, talk to each other,
and take tasks from the page in front of you.

This document is the developer reference for the feature: what it is, how the pieces fit, the
protocols, the click-through rules per platform, the state machine, the real interfaces, the dev
harness boundary, how to run and validate it locally, its known limits, and how to add a new avatar.
The authoritative design (file layout, numbers, art direction) is
`~/.factory/missions/…/architecture.md` for the mission that built it; this file is the durable,
in-repo summary.

- Code lives under `apps/desktop/src/app/pane3d/` (renderer) and `apps/desktop/electron/pane3d*.ts`
  (main process).
- The pane is lazy-loaded from `apps/desktop/src/main.tsx` (`?win=pane3d`), so it never grows the
  main bundle.
- Version 1 is desktop-first on **Linux/X11**. Wayland and macOS/Windows click-through are
  documented follow-ups (see [Known limits](#known-limits)).

---

## What it is

One Electron `BrowserWindow` with `transparent: true`, `frame: false`, `alwaysOnTop` at the
`screen-saver` level (`floating` on macOS), `focusable: false`, `skipTaskbar: true`, created
non-activating and shown with `showInactive()`. It covers the work area of one display and renders:

- **one WebGL canvas** (one React Three Fiber `<Canvas>`, DPR capped at 1.75) with the avatars and
  the 3D chart, and
- **a DOM layer** above the canvas: notification/result cards, speech bubbles, the composer, the
  working pill, the activity feed, the dock, hover chips, the accessible avatar handles and the
  chart's axis labels.

Everything outside the avatars and cards is click-through. Nothing renders continuously: the frame
loop is `always` only while an avatar is out or a chart is turning, otherwise `demand`/`never`.

All text is DOM. There is no troika/`<Text>` (it fetches fonts from a CDN) and no
`<Environment preset>` (it fetches HDR files); lighting is local lights plus Lightformers, and the
only generated textures are drawn locally (seam, contact shadow, chart grid).

### Ownership

- **Pane renderer** owns presentation and all avatar/room/feed/task state.
- **Main process** owns the window, click-through, anchoring and page-context reads.
- **Main renderer** (the Hermes app) is only a client: it opens/closes the pane, launches the demo,
  and calls `notify`. The pane has **no gateway connection of its own** in v1.

---

## Process and component map

```
 Main renderer (Hermes app)            Main process                             3D Pane window (?win=pane3d)
 ───────────────────────────           ────────────                             ───────────────────────────
 palette: Open/Close 3D Pane  ──IPC──▶ electron/pane3d-window.ts (factory, bounds) Pane root (ThemeProvider + Canvas)
 palette: Play launch demo    ──IPC──▶ electron/pane3d-ipc.ts (relay, sender      ├─ director/  AvatarDirector (nanostores)
 hermesDesktop.pane3d.notify  ──IPC──▶   checks, ready queue)                     │    avatarMachine (pure reducer)
                                       electron/pane3d-hit.ts (strategies)  ◀─────┤    room (AvatarRoom choreography)
                                       electron/pane3d-anchor.ts (AnchorService) ──▶│    tasks (TaskExecutor interface)
 <webview> guests ◀──────────────────── electron/pane3d-context.ts (PageContext)──▶├─ scene/  Stage, Rig, Avatar, Chart3D
 OS windows (window-below.ts)                                                        ├─ avatars/ registry + 5 definitions
                                                                                     ├─ ui/      DOM cards, bubbles, composer,
                                                                                     │          feed, dock, handles
                                                                                     ├─ hit/     HitRegionPublisher
                                                                                     └─ dev-harness/ (LABELLED scaffolding)
```

`electron/main.ts` (a large facade) only wires: create the controller/getters, call
`registerPane3dIpc({...})`, and start/stop the `AnchorService`. All pane logic lives in the focused
`electron/pane3d-*.ts` modules with injected dependencies, so every policy is unit-testable without
booting Electron.

### File layout (renderer)

```
src/app/pane3d/
  pane3d-root.tsx      mountPane3d(): imports the cast, mounts <PaneApp/>
  pane-app.tsx         one <Canvas> + the DOM overlay + the hit publisher
  protocol.ts          PaneState / PaneControl / shared types (type-only)
  copy.ts              pane-internal English strings
  director/            machine, director, notify, store, room(+live), tasks, composer, chart, feed
  scene/               canvas, camera, lights, stage, rig, emergence, choreography, projection,
                       chart3d, chart-board, chart-labels, chart-scale, chart-layout, chart-motion
  avatars/             registry, types, muse, hermes, grok, opencode, claude, marks
  ui/                  notification-card, result-card, speech-bubble, composer, task-pill, feed-panel,
                       dock, hover-chips, avatar-handle, dev-badge, card-layout, card-geometry
  hit/                 regions (pure merge/pad), publisher, exact-hit (darwin/win32)
  dev-harness/         demo-feed, conversation-script, dev-executor, demo-data, launch-demo
```

---

## Protocols

All message types live in `src/app/pane3d/protocol.ts` (type-only, so the main process can
`import type` from it without pulling three.js into the Electron bundle).

```ts
export type AvatarId = 'muse' | 'hermes' | 'grok' | 'opencode' | 'claude'

export interface ScreenRect { x: number; y: number; width: number; height: number } // window-local DIP

export type AnchorKind = 'hermes-browser' | 'os-window' | 'desktop'
export interface PaneAnchor { kind: AnchorKind; rect: ScreenRect; label: string } // rect = pane-local CSS px

export interface PageContext {
  source: 'hermes-browser' | 'os-window' | 'none'
  url?: string; title?: string; selection?: string; app?: string; capturedAt: number
}

export interface NotifyRequest {
  avatar: AvatarId; title: string; body: string
  action?: { id: string; label: string }; source?: 'live' | 'dev-harness'
}

export interface ChartSpec { title: string; unit?: string; series: { label: string; value: number }[] }
export type DemoScript = 'launch' | 'notify' | 'hangout'
```

### Main → pane (`PaneState`)

| Message | Payload | Meaning |
| --- | --- | --- |
| `init` | `{ anchor, platform, reducedMotion }` | First state after the pane's `ready`; sets the anchor, host platform and motion preference. |
| `anchor` | `{ anchor }` | The anchor moved/resized; the pane re-perches. |
| `notify` | `{ id, request }` | Deliver a notification (queued per avatar, never dropped). |
| `demo` | `{ script }` | Run a scripted dev-harness demo. |
| `summon` / `dismiss` | `{ avatar }` | Director commands; never open a closed pane. |

### Pane → main (`PaneControl`)

| Message | Meaning |
| --- | --- |
| `ready` | The pane renderer is mounted and shader-warm; main flushes queued states. |
| `hit-regions` | The padded, merged interactive rectangles (pane CSS px). |
| `focus` | `{ focusable }` — the composer needs the keyboard. |
| `ignore-mouse` | `{ ignore }` — darwin/win32 forward strategy only, change-only. |
| `notify.action` / `notify.dismissed` | Forwarded to the host renderer. |
| `open-app` | Raise and focus the main window. |
| `close` | Close the pane; echoed back to the host so the palette label stays correct. |

**Relay rules** (`electron/pane3d-ipc.ts`): the sender is resolved with
`BrowserWindow.fromWebContents(e.sender)`; `hit-regions`, `focus` and `ignore-mouse` are honoured
**only** when the sender is the pane window. A state addressed to a closed pane opens it and queues
until the renderer's `ready`. Readiness is keyed to the pane's `webContents` object (not a boolean),
so close→reopen, a stale-window replacement and a dev reload all start unready and the queued state
is delivered exactly once.

### Preload API (`electron/preload.ts`, channel prefix `hermes:pane3d:`)

```ts
window.hermesDesktop.pane3d = {
  open(): Promise<{ ok: boolean }>
  close(): Promise<{ ok: boolean }>
  isOpen(): Promise<boolean>
  playDemo(script?: 'launch' | 'notify' | 'hangout'): Promise<{ ok: boolean }>
  notify(req: NotifyRequest): Promise<{ ok: boolean; id: string }>   // the real AvatarDirector entry from the host
  summon(avatar): Promise<...>; dismiss(avatar): Promise<...>
  captureContext(): Promise<PageContext>                             // request/response (ipcMain.handle)
  // used by the pane window itself:
  control(msg: PaneControl): void
  onState(cb: (state: PaneState) => void): () => void
  onControl(cb: (control: PaneControl) => void): () => void          // host renderer receives notify.action etc.
}
```

The main-renderer client is `src/store/pane3d.ts` (`$pane3dOpen`, `openPane3d`, `closePane3d`,
`togglePane3d`, `playPane3dDemo`, `notifyPane3d`, `summonPane3d`, `dismissPane3d`). The command
palette exposes two items in the Appearance group:
`3D Pane: Open/Close 3D Pane` (`appearance-3d-pane`) and
`3D Pane: Play launch demo (dev harness)` (`appearance-3d-pane-demo`), with i18n keys
`pane3d.open` / `pane3d.close` / `pane3d.demo` in `en`, `fr`, `de` and `es`.

---

## Click-through (hit regions)

The pane is an invisible overlay, so the default must be "clicks pass through". The renderer
publishes what is interactive and the main process applies it per platform.

### Renderer: what becomes a region

Every animation frame in which something moved (at most once per frame), `hit/publisher.tsx`
collects, in pane-local CSS px:

- each visible avatar: the projected world-space `Box3` of **each top-level part** marked
  `userData.hitPart = true` (one rect per part, silhouette-accurate rather than one fat box),
  padded by **6 px** for the glow;
- each DOM element with `data-pane-hit` (cards, bubbles, chips, dock, composer, feed, chart labels):
  its `getBoundingClientRect()`, padded by **8 px** for the shadow;
- the emergence seam while it is visible, and the chart's projected bounds while it is presented.

`hit/regions.ts` is the pure half: `padRect`, `mergeRegions(rects, gap = 4)` (unions overlapping/near
rects and caps the list at 24 by merging the closest pairs), `roundRect`, `regionsEqual(a, b, tol = 1)`.
Regions are published (`hit-regions`) only when they change.

### Main: `planHitApplication(regions, platform, zoomFactor)`

**Zoom.** Chromium UI zoom is per-origin, so the pane renders at the same factor as the main window
(0.9 on the validation host; `webContents.getZoomFactor()`). The renderer publishes CSS px; main
multiplies by the zoom factor and rounds **outward** (`regionsToDip`) before shaping, so the shape
never clips a pixel it keeps interactive. Any screen↔pane-local math divides by the same factor.

| Platform | With regions | With **no** regions |
| --- | --- | --- |
| `linux` (X11) | `setShape(regions)` — the shape **is** the input region | `setShape([{ x:0, y:0, width:1, height:1 }])` |
| `darwin` / `win32` | `setIgnoreMouseEvents(true, { forward: true })`; the renderer's exact per-pixel test toggles it change-only | `setIgnoreMouseEvents(true, { forward: true })` |

The planner still *states* an ignore policy on Linux, but `applyHitRegions` **never runs
`setIgnoreMouseEvents` on the shape strategy** (see below).

### The never-`setShape([])` rule

`setShape([])` must **never** be used for "nothing is interactive". Electron reads an empty list as
"the whole rectangle", which would turn the transparent overlay into a full-screen click eater. The
empty case collapses to a 1×1 shape in the top-left corner instead (`COLLAPSED_SHAPE`).

### X11 notes (the real v1 target)

- **`setIgnoreMouseEvents` is a one-way door on X11.** Once set to `true`, the window's input region
  is emptied and `(false)` cannot restore it — not even with a later `setShape`. The pane therefore
  spawns with a 1×1 shape and the shape alone carries the whole click-through strategy. There is no
  `setIgnoreMouseEvents` call anywhere on the Linux path.
- **`setShape` also clips painting on X11.** The regions must cover every visible pixel of the pane
  (hence the 6 px avatar padding and 8 px DOM padding), or part of an avatar or its glow is clipped
  away. A window with a 1×1 shape paints nothing and reports `isVisible() === false`: that is the
  intended idle state.
- **A compositor must be running when the window is created** for the transparent areas to be truly
  transparent. Without one, transparent areas paint opaque *inside* the shape — an acceptable
  fallback, because `setShape` clips the window to the avatars/cards anyway. (Bare Xvfb has no
  compositor; the pane's own `xwd` capture therefore shows the transparent area as opaque.)
- Cursor polling (`screen.getCursorScreenPoint`) and `forward: true` do **not** work on X11 — do not
  use them on Linux.

### macOS / Windows (implemented, not live-validated here)

`setIgnoreMouseEvents(true, { forward: true })` from spawn; forwarded `mousemove` runs an exact
per-pixel test (R3F raycast against the avatar meshes **or**
`document.elementFromPoint(x, y)?.closest('[data-pane-hit]')`) and sends a change-only
`{ type: 'ignore-mouse' }` toggle. The ignore state is latched while dragging or a composer is open,
and a region update never re-arms click-through underneath the pointer. This path is unit-tested
(planner + exact-hit) but has not been validated on a macOS or Windows host.

### Focus

The pane is `focusable: false`. Opening the composer sends `{ type: 'focus', focusable: true }`
(main calls `setFocusable(true); focus()`); closing it returns to `false`. The page context is
captured **before** the pane takes focus, so the selection is still in the page when it is read.

---

## Anchoring (`electron/pane3d-anchor.ts`)

`AnchorService.pick()` decides where the avatars sit, in order:

1. **`hermes-browser`** — the in-app browser page the user is on. Enumerate
   `webContents.getAllWebContents()` filtered to `getType() === 'webview'` (not destroyed) and map
   the host with `BrowserWindow.fromWebContents(guest.hostWebContents)`. Prefer the guest whose host
   window is focused; within a host, prefer the visible `<webview>` that contains
   `document.activeElement` (the host renderer is asked for one record per `<webview>`: webContents
   id, visibility, bounding rect). Screen rect = host content-bounds origin + rect × host zoom.
   Guest ids are **not** stable (re-docking creates new guests), so they are re-enumerated on every
   pick, never cached. Destroyed guests and hidden/minimized hosts are skipped.
2. **`os-window`** — the frontmost non-Hermes window from `enumerateWindowsFrontToBack(process.pid, …)`
   (`electron/window-below.ts`; X11 via `get-windows`, or Hyprland). Its bounds; label = window title.
   On macOS, titles require the Screen Recording consent
   (`systemPreferences.getMediaAccessStatus('screen') === 'granted'`), else the app name is used.
3. **`desktop`** — nothing to perch on: the avatars float bottom-right above the dock.

Watching: the service subscribes to the host's `move`/`resize`/`focus`/`blur`/`closed` and the
guest's `did-navigate`/`did-navigate-in-page`/`page-title-updated`, plus a **≤ 4 Hz** poll
(interval ≥ 250 ms) only while the pane is open and visible (the `os-window` kind needs it). It
pushes `{ type: 'anchor' }` only on change (> 1 px). `stop()` clears the poll and every listener;
`main.ts` calls it when the pane closes.

The rect pushed to the pane is converted to **pane-local CSS px** (pane DIP ÷ pane zoom factor).

The pane spawns over the work area of the display containing the current anchor (fallback: primary),
and `rehome()` moves it to a new display when the anchor moves there.

---

## Avatar state machine (`director/machine.ts`, pure)

States: `hidden`, `emerging`, `idle`, `listening`, `thinking`, `responding`, `celebrating`,
`notifying`, `hiding`. Anything not listed is **ignored** (the reducer returns the same object, so a
no-op is detectable by identity).

| State | Event → next |
| --- | --- |
| `hidden` | `SUMMON` → `emerging`; `NOTIFY` → `emerging` (the request is held and delivered on `EMERGED`) |
| `emerging` | `EMERGED` → `idle`, or → `notifying` when a notification is pending |
| `idle` | `COMPOSER_OPEN` → `listening`; `NOTIFY` → `notifying`; `TASK_ACCEPTED` → `thinking`; `DISMISS` → `hiding` |
| `listening` | `USER_INPUT` → `listening` (stay); `SUBMIT` → `thinking`; `COMPOSER_CLOSE` → `idle`; `DISMISS` → `hiding` |
| `thinking` | `TASK_PROGRESS` → `thinking` (stay); `STREAM_TOKEN` → `responding`; `TASK_DONE` → `celebrating`; `TASK_ERROR` → `idle` |
| `responding` | `STREAM_TOKEN` → `responding` (stay); `TASK_DONE` → `celebrating`; `TASK_ERROR` → `idle` |
| `celebrating` | `CELEBRATED` → `idle` |
| `notifying` | `NOTIFY_SETTLED` → `idle`; `DISMISS` → `hiding` |
| `hiding` | `HIDDEN` → `hidden` |

Every transition is driven by a **real** event: user input, a `TaskExecutor` event, a director
notification, or the rig reporting an animation finished. There are no timers that cycle states by
themselves except the notification read timeout (9 s) and the room's rate-limited greeting.

`director/director.ts` is the only writer: `dispatch(id, event)` runs the machine, mirrors the new
state into `$avatars` and appends to the transition log. Choreography clocks anchor to the avatar's
`changedAt` (the transition timestamp), and each pose is a pure function of elapsed ms clamped at the
end, so a completion never cuts a visible motion short even at 5–7 fps software GL.

---

## The interfaces

Real interfaces live in `director/` (and `electron/pane3d-*.ts` for the main process). The scripted
implementations live in `dev-harness/`.

### `AvatarDirector` (`director/director.ts`)

Exported singleton `avatarDirector` plus the store:

```ts
notify(req: NotifyRequest): string          // returns the id; per-avatar FIFO, one card per avatar
deliverNotification(id, req): void          // the `{type:'notify'}` path (host owns the id)
summon(id: AvatarId): void
dismiss(id: AvatarId): void
dispatch(id: AvatarId, event: AvatarEvent): void
hoverNotification(id): void                 // pause the 9 s read timer
unhoverNotification(id): void
activateNotificationAction(id, actionId): void
dismissNotification(id): void
```

Notifications are queued per avatar and **never dropped**: the machine only accepts `NOTIFY` while an
avatar is `hidden`/`idle`, so a request that arrives while it is listening/thinking/responding/
celebrating/emerging/notifying waits in the FIFO. A card opens on the `notifying` transition and
settles on the action, the close control, a dismissal, or the 9 s timeout (hover pauses it). On
settle it collapses into the feed (kind `notify`) and dispatches `NOTIFY_SETTLED`.

State is exposed through nanostores (`$avatars`, `$cards`, `$feed`, `$composer`, `$tasks`,
`$taskProgress`, `$taskCards`, `$bubbles`, `$anchor`, `$transitions`), and a read-only debug snapshot
is installed in dev as `window.__pane3dDebug.snapshot()` (see [Observability](#observability)).

### `TaskExecutor` (`director/tasks.ts`)

```ts
export interface AvatarTask {
  id: string
  avatar: AvatarId
  text: string
  context: PageContext
  createdAt: number
  /** The scripted demo whose composer submitted this task, if any (§11). */
  demo?: DemoScript
}

export type TaskEvent =
  | { type: 'accepted' }
  | { type: 'progress'; label: string; pct?: number }
  | { type: 'token'; text: string }
  | { type: 'done'; result: TaskResult }
  | { type: 'error'; message: string }

export interface TaskResult {
  title: string
  body: string
  chart?: ChartSpec
  links?: { label: string; url: string }[]
  /** Present this chart without a click; the card collapses into the feed. */
  presentChart?: boolean
}

export interface TaskExecutor {
  readonly label: string
  readonly isDevHarness: boolean
  /** Returns the cancel function; `emit` may be called any number of times. */
  run(task: AvatarTask, emit: (event: TaskEvent) => void): () => void
}
```

`submitTask(avatar, text, context, demo?)` runs the one active executor (installed via
`setTaskExecutor`; the composer passes its demo tag, if it has one) and maps events onto the machine:
`accepted → TASK_ACCEPTED`, `progress → TASK_PROGRESS` (the working pill's label + bar), the first
`token → STREAM_TOKEN` (`responding`), `done → TASK_DONE` (`celebrating`) then a result card,
`error → TASK_ERROR` (error card). One running task per avatar; `cancelTask`/`cancelTasks` mark the
session cancelled, call the executor's cancel function, drop the pill and return the avatar to
`idle`. `pane-app.tsx` cancels every task on `pagehide` and unmount.
A result that carries `presentChart` is presented immediately by the chart presenter — the same path
as the card's "Show chart" — and its card collapses into the feed; every other result keeps its card.
The presenter never learns which executor set the flag, so the demo's chart stays scoped to the one
task whose composer carried the demo tag.

The v1 active executor is `DevHarnessExecutor` (`dev-harness/dev-executor.ts`).

### `ConversationSource` (`director/room.ts`)

```ts
export interface ConversationContext { turn: number; reason: 'greeting' | 'chatter' }
export interface ConversationLine { speaker: AvatarId; listener: AvatarId; text: string }

export interface ConversationSource {
  readonly label: string
  readonly isDevHarness: boolean
  next(speaker: AvatarId, listener: AvatarId, ctx: ConversationContext): ConversationLine | null
}
```

Installed with `setConversationSource`. The **AvatarRoom** (`director/room-live.ts`) starts an
exchange only on a real `emerging → idle` transition while another avatar is visible and idle: both
turn to face each other, bow (10°, 400 ms), then alternate bubbles (3.2 s each, two lines), logging
each line to the feed as `"Grok → Muse: …"`. Rate limits: ≤ 1 exchange per pair per 45 s, ≤ 1 overall
per 20 s, and never while a composer is open, a task is running, or a notification card is open.
Facing is re-derived on a 250 ms poll.

### `PageContextService` (`electron/pane3d-context.ts`)

```ts
export interface PageContextService { capture: () => Promise<PageContext> }
```

`capture()` order: the same in-app-browser guest the avatars perch on → `{ source: 'hermes-browser',
url, title, selection }` (selection from `String(window.getSelection())`, trimmed and capped at 4000
chars; a failing `executeJavaScript` omits the selection and never throws); else the frontmost
non-Hermes OS window → `{ source: 'os-window', title, app }` (no URL, shown as "title only"); else
`{ source: 'none' }`. The whole read resolves within **800 ms**; a timeout yields `none`. The
renderer calls it through `hermesDesktop.pane3d.captureContext()` before it focuses the pane.

### `AnchorService` (`electron/pane3d-anchor-types.ts`)

```ts
export interface AnchorService {
  start: () => Promise<void>          // begin watching and push `init`
  stop: () => void                    // clear the poll and every listener (idempotent)
  pick: () => Promise<PaneAnchor>     // compute without pushing
  currentScreenRect: () => ScreenRect | null
  isRunning: () => boolean
}
```

---

## Dev-harness boundary

Everything scripted lives under `src/app/pane3d/dev-harness/` and is reachable **only** through:

- the palette command `3D Pane: Play launch demo (dev harness)` (or
  `hermesDesktop.pane3d.playDemo('launch')`), which travels IPC → pane `{ type: 'demo' }` → the
  composition point, and
- the default `TaskExecutor` and `ConversationSource`.

The real interfaces live in `director/` and **nothing outside `dev-harness/` imports from it** except
the single composition point `src/app/pane3d/director/defaults.ts`, which installs the default
executor, conversation source, chart presenter and demo-script handler, and is imported once by
`pane-app.tsx`.

Every UI surface whose content came from a harness renders `<DevBadge/>` ("Dev harness",
`data-dev-harness`): notification cards, result cards, the task pill, speech bubbles, feed entries,
the chart panel, and the pre-filled demo composer. Live host content never shows the badge.

### The launch demo (`dev-harness/launch-demo.ts`)

A choreography of **real** director calls, in four stages (`launchStep` is the pure table; the
runtime watches the real signals):

1. **Start** — `reset-cast` (dismiss both, a no-op when hidden), summon **Muse**, then notify her:
   *"Hey — there's an update for you"* / *"I posted that reel to your Instagram."*
   (`source: 'dev-harness'`). Muse emerges from the current anchor edge.
2. **Waiting for the card** — the demo watches **this run's own notification id**: the card opening
   is Muse entering `notifying` for it, and the card going away (the close control, the 9 s timeout,
   a dismissal, a hide) is her leaving it. A 15 s deadline covers a path where the card can never
   open; it is disarmed the moment the card is up, so a replay that dismisses an older card, or a
   card the presenter is still reading, never counts as this run's settle.
3. **Grok** — summon Grok; the room greeting fires naturally (it stays quiet while a card is open).
   The demo waits for the greeting to be logged and the last bubble to come down, with a 10 s
   deadline if the greeting is suppressed.
4. **Composer** — `openComposer('grok', { draft, source: 'dev-harness', demo: 'launch' })`: the page
   context is captured first, then Grok's composer opens pre-filled with
   `"this looks cool — can you build this for me?"`. The user (or a validator) presses Enter; the
   demo tag rides onto that one task, whose result carries `presentChart` and the demo chart, which
   the chart presenter shows automatically. `lastDemo` stays in the snapshot for observability but
   no longer decides anything, so a task asked for afterwards is an ordinary one.

`cancelLaunchDemo()` runs on `pagehide` and on every restart, so closing the pane mid-flight runs no
later effect.

---

## Observability

In dev (`import.meta.env.DEV`) the pane installs a read-only `window.__pane3dDebug.snapshot()`:
anchor, per-avatar state/visible/slot/screenRect/yaw/gaze/meshCount/materialTypes, `regions`,
`frameloop`, `renderCount`, `pixelRatio`, `transitions` (last 200), `feed`, `cards`, `bubbles`,
`composer` (context + removed chips + draft + demo tag), `tasks`, `taskCards`, `taskProgress`,
`chart: { visible, rotationDeg }`, `lastDemo`, `prewarm`, `reducedMotion`.

DOM hooks (all of them `data-*`, stable for tests):

| Hook | On |
| --- | --- |
| `data-avatar-id`, `data-avatar-state`, `aria-label` | the accessible handle over each visible avatar |
| `data-dock-avatar="<id>"` | dock buttons |
| `data-pane-card="notify\|result\|error"` | cards (with `data-avatar-id`) |
| `data-pane-bubble` | speech bubbles |
| `data-pane-feed`, `data-feed-kind` | the activity feed and its entries |
| `data-pane-composer`, `data-context-chip="url\|title\|selection\|none\|title-only"` | the composer |
| `data-pane-task-pill`, `data-task-phase`, `data-task-label`, `data-task-stream` | the working pill |
| `data-pane-chart` | the presented chart |
| `data-pane-hit` | everything that must receive clicks |
| `data-dev-harness` | the Dev-harness badge |

---

## How to run and validate locally

Version 1 is validated on **Linux/X11** with a private Xvfb display, driven over CDP. Nothing here
touches the user's real `~/.hermes`, Electron profile or backend: launch uses `env -i` with a
temporary HOME/HERMES_HOME/user-data and fake boot.

1. **Install** (repo root): `npm ci --no-audit --no-fund`.
2. **Start the display and dev server**: `Xvfb :121 -screen 0 1920x1080x24 +extension GLX +extension
   COMPOSITE -nolisten tcp`, then `npx vite --host 127.0.0.1 --port 5174 --strictPort` from
   `apps/desktop`. Start background processes with `setsid` and stop them by PID.
3. **Rebuild the Electron main bundle** after any change under `electron/` or the preload:
   `npx tsc --build tsconfig.electron.json && node scripts/bundle-electron-main.mjs --dev`.
4. **Launch the isolated app**: Electron needs `--no-sandbox` and `--ignore-gpu-blocklist` (without
   the second flag WebGL is disabled). Expose CDP on `9222` and the Node inspector on `9230`.
5. **Optional page fixture**: a local "X post" page on `127.0.0.1:5181` gives the demo real page
   context; open it with the preview store (`openPreview({ kind: 'url', … })`).
6. **Drive it**:
   - `agent-browser --session <name> --cdp 9222` for DOM, clicks and screenshots of the main window
     and the `?win=pane3d` target;
   - the Node inspector for main-process facts (window flags/bounds, `setShape` calls, guests,
     `setBounds`);
   - `DISPLAY=:121 xdotool` for **real** pointer input — only X input proves the shape's
     click-through (CDP-injected input bypasses the X input shape).
7. **Assert** with `window.__pane3dDebug.snapshot()` and the `data-*` hooks above. On this host WebGL
   runs in software (~10–18 fps), so never assert a frame rate: verify motion from the state
   sequence, transition timestamps and sampled screenshots.

### The milestone gate (from `apps/desktop`)

```bash
npm run typecheck
npm run lint                                    # 0 errors (pre-existing warnings are fine)
npx vitest run --project ui src/app/pane3d src/i18n src/app/command-palette
npx vitest run --project electron electron/pane3d
```

Unit tests cover the pure logic (state machine, registry contract, perch/room layout, hit-region
merge/pad, director notification lifecycle and rate limits, executor mapping, chart scales, the
launch-demo choreography) and the main-process policies (strategy choice per platform, the
empty-region rule, bounds/display resolution, anchor choice, page-context source). Renderer tests are
the vitest `ui` project; main-process tests are the `electron` project. Platform is passed as data
(`planHitApplication(regions, 'linux')`), never faked with `process.platform`.

### Resource discipline

- `frameloop` is `always` only while an avatar is out or a chart is presented; otherwise `demand`,
  and `never` while `document.hidden`. `snapshot().renderCount` must stop rising when everything is
  hidden.
- DPR is capped at 1.75 (`dpr={[1, 1.75]}`).
- The anchor poll is ≤ 4 Hz; with the pane closed there is no pane window and `AnchorService.stop()`
  has cleared its interval and listeners.

---

## Known limits

- **Wayland.** `alwaysOnTop` and `setShape` are not guaranteed; the X11 strategy is the only
  validated click-through. Wayland is a documented follow-up.
- **High anchor perch.** When the anchor perch sits within ~90 px of the pane top (for example a
  maximized main window with the browser docked), the avatars and the chart title can be clipped at
  the top; a perch policy for high anchors is a follow-up.
- **macOS / Windows.** The forward-mode click-through strategy is implemented and unit-tested, but
  has not been validated on those hosts. On macOS, OS-window titles require Screen Recording consent
  (without it the app name is used) and the pane is a `panel` at the `floating` level.
- **No gateway connection.** The pane is a client of the main renderer only; it does not talk to the
  agent backend in v1. The `TaskExecutor` and `ConversationSource` seams are where a live backend
  plugs in.
- **OS-window anchor/context need a window manager.** On bare Xvfb there is no WM, so
  `enumerateWindowsFrontToBack` returns nothing and those paths fall back to `desktop`/`none`; they
  are unit-tested rather than live-validated there.
- **Software WebGL on the validation host** runs at ~10–18 fps; motion quality is judged from the
  state sequence and screenshots, not frame-rate thresholds.
- **One WebGL context, no post-processing, no real-time shadows** (blob/contact shadows only).

---

## Add a new avatar

Adding an avatar is one new file plus one `registerAvatar` call; the registry is what the dock, the
director, the room and the shader pre-warm all read, so an unregistered avatar can never appear.

**1. Add the id.** In `src/app/pane3d/protocol.ts`, extend the union and the id list (this is the
compile-time contract every switch in the pane is checked against):

```ts
export type AvatarId = 'muse' | 'hermes' | 'grok' | 'opencode' | 'claude' | 'atlas'

export const AVATAR_IDS: readonly AvatarId[] = ['muse', 'hermes', 'grok', 'opencode', 'claude', 'atlas']
```

**2. Write the body.** Create `src/app/pane3d/avatars/atlas.tsx`. The body is pure geometry — no
state-machine logic, no timers. It exposes the named sub-groups the shared `<Rig>` nudges each frame
via the `AvatarRigHandle` refs (`head`, `eyes`, `accent`); a body whose thinking cue is not a spin
(Hermes' wing fold, Grok's scanning visor, OpenCode's cursor) leaves `accent` null and registers an
`accentCue` with `rig.registerAccentCue` instead — the rig still owns when it runs. Top-level parts
that should be interactive set `userData.hitPart = true`; every material that must emerge through the
anchor edge uses `EMERGENCE_CLIPPING_PLANES`. Colours come from the definition's own palette (avatars
are the one place raw hex is allowed).

```tsx
import { EMERGENCE_CLIPPING_PLANES } from '../scene/emergence'

import { registerAvatar } from './registry'
import type { AvatarBodyProps, AvatarDefinition } from './types'

const SHELL = '#cfe3ff'
const RING = '#8fb6ff'
const EYE = '#101a2e'

function AtlasBody({ rig }: AvatarBodyProps) {
  return (
    <>
      <mesh userData={{ hitPart: true }}>
        <icosahedronGeometry args={[0.4, 2]} />
        <meshPhysicalMaterial
          clearcoat={1}
          clippingPlanes={EMERGENCE_CLIPPING_PLANES}
          color={SHELL}
          roughness={0.2}
          transparent
        />
      </mesh>

      {/* The generic accent: the rig spins this only while thinking (§8.4). */}
      <group position={[0, 0.3, 0]} ref={rig.registerAccent} userData={{ hitPart: true }}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.5, 0.02, 16, 96]} />
          <meshStandardMaterial
            clippingPlanes={EMERGENCE_CLIPPING_PLANES}
            color={RING}
            emissive={RING}
            emissiveIntensity={1.2}
            roughness={0.3}
            transparent
          />
        </mesh>
      </group>

      <group position={[0, 0.05, 0.3]} ref={rig.registerHead}>
        <group ref={rig.registerEyes}>
          {[-0.13, 0.13].map(x => (
            <mesh key={x} position={[x, 0, 0.06]} scale={[0.058, 0.09, 0.03]}>
              <sphereGeometry args={[1, 20, 20]} />
              <meshStandardMaterial
                clippingPlanes={EMERGENCE_CLIPPING_PLANES}
                color={EYE}
                roughness={0.45}
                transparent
              />
            </mesh>
          ))}
        </group>
      </group>
    </>
  )
}

export const atlas: AvatarDefinition = {
  Body: AtlasBody,
  displayName: 'Atlas',
  height: 1.1,
  id: 'atlas',
  palette: { accent: '#8fb6ff', glow: '#bcd4ff', ink: '#101a2e', primary: '#cfe3ff' },
  tagline: 'Atlas — your map of the work',
  // Optional: the projected silhouette width the perch layout reserves.
  width: 1.0
}

registerAvatar(atlas)
```

**3. Register it at the pane's composition point.** Add a side-effect import to
`src/app/pane3d/pane3d-root.tsx` (the one module that imports the cast):

```ts
import './avatars/atlas'
```

**4. (Optional) give it lines.** Add `'atlas->muse'` (and the reverse) entries to
`dev-harness/conversation-script.ts`; a missing pair falls back to a generic greeting. The dock, the
perch layout, the facing rules, the pre-warm plan and the shader pre-warm are all registry-driven and
need no further changes.

**5. Test and check.** `npx vitest run --project ui src/app/pane3d` (the registry contract test
asserts every registered body satisfies the rig), then the milestone gate above. If the new body's
silhouette is much wider or narrower than its height, set the optional `width` (world units) so perch
slots never overlap.

### The `AvatarDefinition` contract

```ts
export interface AvatarPalette { primary: string; accent: string; glow: string; ink: string }

export interface AvatarDefinition {
  id: AvatarId
  displayName: string
  tagline: string
  palette: AvatarPalette
  /** World units; the rig rests the body's feet on the perch line. */
  height: number
  /** World-space silhouette width for the perch layout; defaults to height × a ratio. */
  width?: number
  Body: ComponentType<AvatarBodyProps>
}

export interface AvatarBodyProps { rig: AvatarRigHandle; state: AvatarState }

export function registerAvatar(definition: AvatarDefinition): void
export function getAvatar(id: AvatarId): AvatarDefinition
export function listAvatars(): AvatarDefinition[]
```

`registerAvatar` is idempotent by id, so Vite HMR re-running a module never duplicates a body. The
shared `<Rig>` (`scene/rig.tsx`) owns **all** motion — breathing, gaze, facing, lean, the emergence
clip and the celebrate/greet gestures — so a new body only supplies geometry and its accent cue.
