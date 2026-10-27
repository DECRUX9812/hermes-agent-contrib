/**
 * Floating browser: the same Browser workspace in a picture-in-picture window
 * that sits above the whole app, so it stays put while you move between views
 * and sessions. It can float anywhere (snapping to corners and edges), shrink
 * to a pill that keeps the page title and a live dot, or be dropped on a screen
 * edge to dock. Docking hands the browser to the app's own pane layout (a
 * workspace docked left/right, see open.tsx), so the docked width is the pane
 * shell's width, saved with the layout: there is no second size store here.
 * Floating position, size and the minimised state persist in this browser.
 *
 * The host has no app-level render slot, so the window is its own React root
 * on <body>: a react-dom build matching the host's React is loaded from the
 * plugin folder on first use (see build.mjs) and shares the host's React, so
 * hooks, stores and SDK components behave the same as in the tab.
 *
 * Motion: drags and resizes write transform/size straight to the element
 * (no React render per frame); mode changes animate with a FLIP transform on
 * a spring curve, so the page inside never re-lays out mid-animation. While a
 * gesture runs, a full-screen shield takes the pointer so iframes underneath
 * can't swallow it.
 */

import { Codicon, Tip, useValue } from '@hermes/plugin-sdk'
import { atom } from 'nanostores'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'

import { leaseHeldBy } from '../screen-connection'
import { acquireScreenLease, releaseScreenLease } from '../screen-actions'
import { useScreenPortalState } from '../screen-portal'
import { $screenState, screenStateFor } from '../screen-state'
import type { RosterRow } from '../types'

import { browserText, useBrowserText } from './browser-i18n'
import { CloudTakeOver } from './cloud'
import { floatKeyAction } from './focus'
import { loadReactDom } from './react-dom-loader'
import { $activeTab, $activity, $tabs, type BrowserTab } from './store'
import { BrowserWorkspace, TabIcon, tabLabel } from './workspace'

export type DockSide = 'left' | 'right'
export type Surface = 'float' | 'tab' | DockSide

export interface FloatGeometry {
  min: boolean
  x: number
  y: number
  w: number
  h: number
}

type Rect = { x: number; y: number; w: number; h: number }
type Visual = Rect & { s: number; o: number }
type Dir = 'e' | 'n' | 'ne' | 'nw' | 's' | 'se' | 'sw' | 'w'

const GEOMETRY_KEY = 'hermes-bots-plus.browser.float'
const SURFACE_KEY = 'hermes-bots-plus.browser.surface'
const MARGIN = 12
const SNAP = 28
const DOCK_EDGE = 10
const MIN_W = 340
const MIN_H = 240
const PILL_INSET = 16
const SPRING = 'cubic-bezier(0.34, 1.36, 0.64, 1)'
const STANDARD = 'cubic-bezier(0.2, 0, 0, 1)'

function viewport() {
  return { vw: window.innerWidth || 1280, vh: window.innerHeight || 800 }
}

function defaultGeometry(): FloatGeometry {
  const { vw, vh } = viewport()
  const w = Math.round(Math.min(560, Math.max(MIN_W, vw * 0.42)))
  const h = Math.round(Math.min(420, Math.max(MIN_H, vh * 0.55)))

  return { min: false, x: vw - w - MARGIN * 2, y: vh - h - MARGIN * 2, w, h }
}

function readJson<T>(key: string): null | T {
  try {
    const raw = window.localStorage.getItem(key)

    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode / quota: the window still works, it just won't be remembered.
  }
}

function readGeometry(): FloatGeometry {
  const saved = readJson<Partial<FloatGeometry>>(GEOMETRY_KEY)
  const base = defaultGeometry()

  if (!saved) {
    return base
  }

  const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

  return {
    min: saved.min === true,
    x: num(saved.x, base.x),
    y: num(saved.y, base.y),
    w: num(saved.w, base.w),
    h: num(saved.h, base.h)
  }
}

function readSurface(): Surface {
  const saved = readJson<string>(SURFACE_KEY)

  return saved === 'float' || saved === 'left' || saved === 'right' ? saved : 'tab'
}

/** Where the browser lives: a workspace tab, a docked pane, or the floating window. */
export const $surface = atom<Surface>(readSurface())
export const $floatGeometry = atom<FloatGeometry>(readGeometry())

export function setSurface(surface: Surface) {
  $surface.set(surface)
  writeJson(SURFACE_KEY, surface)
}

export function patchGeometry(patch: Partial<FloatGeometry>) {
  const next = { ...$floatGeometry.get(), ...patch }
  $floatGeometry.set(next)
  writeJson(GEOMETRY_KEY, next)
}

function clampRect(rect: Rect, vw: number, vh: number): Rect {
  const w = Math.min(Math.max(rect.w, MIN_W), vw - MARGIN * 2)
  const h = Math.min(Math.max(rect.h, MIN_H), vh - MARGIN * 2)

  return {
    w,
    h,
    x: Math.min(Math.max(rect.x, MARGIN), vw - w - MARGIN),
    y: Math.min(Math.max(rect.y, MARGIN), vh - h - MARGIN)
  }
}

export function rectFor(geometry: FloatGeometry, vw: number, vh: number): Rect {
  return clampRect(geometry, vw, vh)
}

/** Snap a dropped window to nearby edges (corners fall out of snapping both axes). */
function snapRect(rect: Rect, vw: number, vh: number): Rect {
  const next = clampRect(rect, vw, vh)

  if (next.x - MARGIN < SNAP) {
    next.x = MARGIN
  } else if (vw - MARGIN - (next.x + next.w) < SNAP) {
    next.x = vw - MARGIN - next.w
  }

  if (next.y - MARGIN < SNAP) {
    next.y = MARGIN
  } else if (vh - MARGIN - (next.y + next.h) < SNAP) {
    next.y = vh - MARGIN - next.h
  }

  return next
}

function pillCorner(rect: Rect, vw: number, vh: number) {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2

  return { right: cx >= vw / 2, bottom: cy >= vh / 2 }
}

function visualFor(geometry: FloatGeometry, vw: number, vh: number): Visual {
  const rect = rectFor(geometry, vw, vh)

  if (!geometry.min) {
    return { ...rect, s: 1, o: 1 }
  }

  // Shrink toward the pill's corner without changing the laid-out size.
  const corner = pillCorner(rect, vw, vh)
  const s = 0.1
  const px = corner.right ? vw - PILL_INSET - 90 : PILL_INSET + 90
  const py = corner.bottom ? vh - PILL_INSET - 16 : PILL_INSET + 16

  return { ...rect, x: px - (rect.w * s) / 2, y: py - (rect.h * s) / 2, s, o: 0 }
}

function applyVisual(el: HTMLElement, visual: Visual) {
  el.style.width = `${visual.w}px`
  el.style.height = `${visual.h}px`
  el.style.transform = `translate3d(${visual.x}px, ${visual.y}px, 0) scale(${visual.s})`
  el.style.opacity = String(visual.o)
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function useViewport() {
  const [size, setSize] = useState(viewport)

  useEffect(() => {
    let frame = 0

    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setSize(viewport()))
    }

    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return size
}

type Gesture = {
  kind: 'drag' | 'resize'
  dir?: Dir
  pointerId: number
  sx: number
  sy: number
  start: Rect
  live: Rect
  moved: boolean
  hint: DockSide | null
}

const CURSOR: Record<Dir, string> = {
  e: 'ew-resize',
  w: 'ew-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize'
}

export interface FloatProps {
  onClose: () => void
  /** Hand the browser to the pane layout, docked on `side`; `width` seeds the pane. */
  onDock: (side: DockSide, width?: number) => void
  onToTab: () => void
}

export function FloatingBrowser({ onClose, onDock, onToTab }: FloatProps) {
  const text = useBrowserText()
  const geometry = useValue($floatGeometry)
  const { vw, vh } = useViewport()
  const winRef = useRef<HTMLDivElement>(null)
  const shown = useRef<null | Visual>(null)
  const gesture = useRef<Gesture | null>(null)
  const [shield, setShield] = useState<null | string>(null)
  const [dockHint, setDockHint] = useState<DockSide | null>(null)
  const target = visualFor(geometry, vw, vh)
  const targetKey = `${target.x}|${target.y}|${target.w}|${target.h}|${target.s}|${target.o}`

  // FLIP: jump to the new box, then animate the transform from the old one.
  useLayoutEffect(() => {
    const el = winRef.current

    if (!el || gesture.current) {
      return
    }

    const from = shown.current
    applyVisual(el, target)
    shown.current = target

    if (!from || reducedMotion()) {
      return
    }

    if (from.x === target.x && from.y === target.y && from.w === target.w && from.h === target.h && from.s === target.s) {
      return
    }

    const sx = (from.w * from.s) / target.w
    const sy = (from.h * from.s) / target.h
    const shrinking = target.s < 1

    el.animate(
      [
        { transform: `translate3d(${from.x}px, ${from.y}px, 0) scale(${sx}, ${sy})`, opacity: from.o },
        { transform: `translate3d(${target.x}px, ${target.y}px, 0) scale(${target.s})`, opacity: target.o }
      ],
      { duration: shrinking ? 240 : 420, easing: shrinking ? STANDARD : SPRING }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey])

  const begin = (event: ReactPointerEvent<HTMLElement>, kind: Gesture['kind'], dir?: Dir) => {
    if (event.button !== 0 || (kind === 'drag' && (event.target as Element).closest('button,input,a'))) {
      return
    }

    const start = rectFor(geometry, vw, vh)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    gesture.current = {
      kind,
      dir,
      pointerId: event.pointerId,
      sx: event.clientX,
      sy: event.clientY,
      start,
      live: start,
      moved: false,
      hint: null
    }
    setShield(kind === 'drag' ? 'grabbing' : CURSOR[dir ?? 'se'])
  }

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current
    const el = winRef.current

    if (!g || !el || event.pointerId !== g.pointerId) {
      return
    }

    const dx = event.clientX - g.sx
    const dy = event.clientY - g.sy

    if (!g.moved && Math.abs(dx) + Math.abs(dy) < 4) {
      return
    }

    g.moved = true
    let next: Rect

    if (g.kind === 'drag') {
      next = clampRect(
        { ...g.start, x: g.start.x + event.clientX - g.sx, y: g.start.y + event.clientY - g.sy },
        vw,
        vh
      )
      const hint = event.clientX <= DOCK_EDGE ? 'left' : event.clientX >= vw - DOCK_EDGE ? 'right' : null
      if (hint !== g.hint) {
        g.hint = hint
        setDockHint(hint)
      }
    } else {
      next = resizeRect(g.start, g.dir ?? 'se', dx, dy, vw, vh)
    }

    g.live = next
    const visual = { ...next, s: 1, o: 1 }
    applyVisual(el, visual)
    shown.current = visual
  }

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current

    if (!g || event.pointerId !== g.pointerId) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    gesture.current = null
    setShield(null)
    const hint = g.hint
    setDockHint(null)

    if (!g.moved) {
      return
    }

    if (g.kind === 'drag' && hint) {
      // Keep the floating spot for when it floats again; the pane takes over.
      onDock(hint, g.start.w)
    } else if (g.kind === 'drag') {
      patchGeometry(snapRect(g.live, vw, vh))
    } else {
      patchGeometry(clampRect(g.live, vw, vh))
    }
  }

  const gestureHandlers = { onLostPointerCapture: end, onPointerCancel: end, onPointerMove: move, onPointerUp: end }

  // Keys inside the window: Esc minimises (the address bar's own Esc, which
  // cancels an edit, marks the event handled first). Everything else is left
  // to the app's shortcut layer, which already holds bare keys back while a
  // text field — the address bar or a remote page's key sink — has focus.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (floatKeyAction(event.nativeEvent) === 'minimise') {
      event.preventDefault()
      event.stopPropagation()
      patchGeometry({ min: true })
      // The window is hidden now: don't leave focus (and typing) inside it.
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    }
  }

  const handles: Dir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  const pillSide = pillCorner(rectFor(geometry, vw, vh), vw, vh)

  return (
    <div className="hbf-root" data-gesture={shield ? 'true' : 'false'}>
      {dockHint && <div aria-hidden className="hbf-dock-hint" data-side={dockHint} />}
      {/* role=region, not dialog: the app treats an open dialog as a modal
          overlay and would hold its own shortcuts back for as long as the
          window stays open. */}
      <div
        aria-hidden={geometry.min}
        aria-label={text.floating}
        className="hbf-window"
        data-hermes-browser-float=""
        data-min={geometry.min ? 'true' : 'false'}
        data-mode="float"
        onKeyDown={onKeyDown}
        ref={winRef}
        role="region"
        tabIndex={-1}
      >
        <TitleBar
          dragHandlers={{ ...gestureHandlers, onPointerDown: event => begin(event, 'drag') }}
          onClose={onClose}
          onDock={onDock}
          onToTab={onToTab}
        />
        <div className="hbf-content">
          <BrowserWorkspace floating />
        </div>
        {handles.map(dir => (
          <div
            aria-label={text.resize}
            className="hbf-handle"
            data-dir={dir}
            key={dir}
            {...gestureHandlers}
            onPointerDown={event => begin(event, 'resize', dir)}
          />
        ))}
      </div>
      {geometry.min && <Pill bottom={pillSide.bottom} right={pillSide.right} />}
      {shield && <div aria-hidden className="hbf-shield" style={{ cursor: shield }} />}
    </div>
  )
}

function resizeRect(start: Rect, dir: Dir, dx: number, dy: number, vw: number, vh: number): Rect {
  let { x, y, w, h } = start

  if (dir.includes('e')) {
    w = Math.min(Math.max(start.w + dx, MIN_W), vw - MARGIN - start.x)
  }

  if (dir.includes('s')) {
    h = Math.min(Math.max(start.h + dy, MIN_H), vh - MARGIN - start.y)
  }

  if (dir.includes('w')) {
    w = Math.min(Math.max(start.w - dx, MIN_W), start.x + start.w - MARGIN)
    x = start.x + start.w - w
  }

  if (dir.includes('n')) {
    h = Math.min(Math.max(start.h - dy, MIN_H), start.y + start.h - MARGIN)
    y = start.y + start.h - h
  }

  return { x, y, w, h }
}

type DragHandlers = {
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
}

function useActiveTab(): BrowserTab | undefined {
  const tabs = useValue($tabs)
  const active = useValue($activeTab)

  return tabs.find(tab => tab.id === active)
}

function useBotBusy(): boolean {
  const tabs = useValue($tabs)
  const activity = useValue($activity)

  return Object.values(activity).some(item => item.running) || tabs.some(tab => tab.kind === 'bot')
}

type FrontBot = { bot: RosterRow; cloud: boolean }

/** The bot whose screen or browsing is in front, and whether it browses in a cloud browser. */
export function frontBot(tab: BrowserTab | undefined, activity: ReturnType<typeof $activity.get>): FrontBot | null {
  if (tab?.kind === 'bot') {
    return { bot: tab.bot, cloud: false }
  }

  if (tab?.kind === 'activity') {
    const snapshot = activity[tab.key]

    if (!snapshot?.bot) {
      return null
    }

    if (snapshot.onDesktop) {
      return { bot: snapshot.bot, cloud: false }
    }

    return snapshot.backend === 'elsewhere' ? { bot: snapshot.bot, cloud: true } : null
  }

  return null
}

function TitleBar({ dragHandlers, onClose, onDock, onToTab }: { dragHandlers: DragHandlers } & FloatProps) {
  const text = useBrowserText()
  const tab = useActiveTab()
  const activity = useValue($activity)
  const busy = useBotBusy()
  const front = frontBot(tab, activity)
  const title = tab ? tabLabel(tab, text.newTab) : text.title

  return (
    <div
      className="hbf-title"
      {...dragHandlers}
      onDoubleClick={event => {
        if (!(event.target as Element).closest('button')) {
          onDock('right')
        }
      }}
    >
      <span className="hbf-title-icon">{tab ? <TabIcon running={busy} tab={tab} /> : <Codicon name="globe" size={14} />}</span>
      <span className="hbf-title-text" title={text.moveHint}>
        {title}
      </span>
      {busy && <span aria-label={text.botActive} className="hbf-live" role="img" />}
      <span className="hbf-title-spacer" />
      {front && (front.cloud ? <CloudTakeOver compact /> : <LeaseControls bot={front.bot} />)}
      <TitleButton icon="layout-sidebar-left" label={text.dockLeft} onClick={() => onDock('left')} />
      <TitleButton icon="layout-sidebar-right" label={text.dockRight} onClick={() => onDock('right')} />
      <TitleButton icon="window" label={text.toTab} onClick={onToTab} />
      <TitleButton icon="chrome-minimize" label={text.minimise} onClick={() => patchGeometry({ min: true })} />
      <TitleButton icon="close" label={text.closeBrowser} onClick={onClose} />
    </div>
  )
}

function TitleButton({ icon, label, onClick, pressed }: { icon: string; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <Tip label={label}>
      <button aria-label={label} aria-pressed={pressed} className="hbf-tbtn" onClick={onClick} type="button">
        <Codicon name={icon} size={14} />
      </button>
    </Tip>
  )
}

/** Take over / Hand back for the bot whose screen or browsing is in front. */
function LeaseControls({ bot }: { bot: RosterRow }) {
  const text = useBrowserText()
  const { lease } = useScreenPortalState(bot)
  const viewer = screenStateFor(useValue($screenState), bot)?.viewer ?? null
  const mine = leaseHeldBy(lease, viewer)
  const [busy, setBusy] = useState(false)

  const run = (work: () => Promise<unknown>) => {
    if (busy) {
      return
    }

    setBusy(true)
    void work()
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  return (
    <button
      className="hbf-lease"
      data-mine={mine ? 'true' : 'false'}
      disabled={busy}
      onClick={() => run(() => (mine ? releaseScreenLease(bot) : acquireScreenLease(bot)))}
      type="button"
    >
      <Codicon name={busy ? 'loading' : mine ? 'debug-disconnect' : 'record-keys'} size={13} spinning={busy} />
      <span>{mine ? text.handBack : text.takeOver}</span>
    </button>
  )
}

function Pill({ bottom, right }: { bottom: boolean; right: boolean }) {
  const text = useBrowserText()
  const tab = useActiveTab()
  const busy = useBotBusy()
  const title = tab ? tabLabel(tab, text.newTab) : text.title

  return (
    <button
      aria-label={text.restore(title)}
      className="hbf-pill"
      data-bottom={bottom ? 'true' : 'false'}
      data-right={right ? 'true' : 'false'}
      onClick={() => patchGeometry({ min: false })}
      type="button"
    >
      <span className="hbf-title-icon">{tab ? <TabIcon running={busy} tab={tab} /> : <Codicon name="globe" size={14} />}</span>
      <span className="hbf-pill-text">{title}</span>
      {busy && <span aria-label={text.botActive} className="hbf-live" role="img" />}
    </button>
  )
}

// ── mounting ────────────────────────────────────────────────────────────────

type Root = { render: (node: unknown) => void; unmount: () => void }

let root: null | Root = null
let container: HTMLElement | null = null
let mounting: null | Promise<boolean> = null

export function floatMounted(): boolean {
  return root !== null
}

/** Mount the floating window (once). Resolves false when this Hermes can't. */
export function mountFloat(props: FloatProps): Promise<boolean> {
  if (root) {
    return Promise.resolve(true)
  }

  mounting ??= loadReactDom()
    .then(dom => {
      container = document.createElement('div')
      container.dataset.hermesBrowserFloat = ''
      document.body.appendChild(container)
      root = dom.createRoot(container) as Root
      root.render(<FloatingBrowser {...props} />)

      return true
    })
    .catch(() => false)
    .finally(() => {
      mounting = null
    })

  return mounting
}

export function unmountFloat() {
  root?.unmount()
  root = null
  container?.remove()
  container = null
}

export function floatUnavailableText() {
  return browserText().floatUnavailable
}
