/**
 * Contract tests for the pane window controller: the §5 flag set and work-area
 * bounds, click-through starting before the window can be shown, single-instance
 * reuse, and close/closed bookkeeping. A fake window factory carries the whole
 * decision surface — no Electron and no host-OS faking (platform arrives as
 * data).
 */

import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createPane3dController, type Pane3dWindowDeps } from './pane3d-window'

interface FakeWindow {
  destroyed: boolean
  shown: number
  ignore: { ignore: boolean; options?: unknown } | null
  shape: unknown
  isDestroyed: () => boolean
  destroy: () => void
  close: () => void
  showInactive: () => void
  [key: string]: unknown
}

function makeWindow(order: string[], handlers: Map<string, Array<() => void>>): FakeWindow {
  const win: FakeWindow = {
    destroyed: false,
    ignore: null,
    shape: null,
    shown: 0,
    close: () => {
      order.push('close')
      win.destroyed = true
      handlers.get('closed')?.forEach(handler => handler())
    },
    destroy: () => {
      order.push('destroy')
      win.destroyed = true
    },
    isDestroyed: () => win.destroyed,
    setAlwaysOnTop: () => order.push('always-on-top'),
    setHiddenInMissionControl: () => order.push('hidden-in-mission-control'),
    setIgnoreMouseEvents: (ignore: boolean, options?: unknown) => {
      order.push('ignore-mouse')
      win.ignore = { ignore, options }
    },
    setShape: (rects: unknown) => {
      order.push('set-shape')
      win.shape = rects
    },
    setVisibleOnAllWorkspaces: () => order.push('all-workspaces'),
    showInactive: () => {
      order.push('show')
      win.shown += 1
    }
  }

  win.on = (event: string, handler: () => void) => {
    handlers.set(event, [...(handlers.get(event) ?? []), handler])
  }

  return win
}

function harness({ platform = 'linux' as NodeJS.Platform } = {}) {
  const order: string[] = []
  const created: Array<Record<string, unknown>> = []
  const windows: FakeWindow[] = []
  let closedCount = 0

  const deps: Pane3dWindowDeps = {
    attachConsole: () => order.push('console'),
    createWindow: options => {
      order.push('create')
      created.push(options)
      const handlers = new Map<string, Array<() => void>>()
      const win = makeWindow(order, handlers)

      windows.push(win)

      return win as never
    },
    getAnchor: () => null,
    getDisplays: () => [{ workArea: { height: 1080, width: 1920, x: 0, y: 0 } }],
    getPrimaryDisplay: () => ({ workArea: { height: 1080, width: 1920, x: 0, y: 0 } }),
    installLifecycle: () => order.push('lifecycle'),
    isMac: platform === 'darwin',
    loadWindowUrl: (_win, url) => order.push(`load:${url}`),
    onClosed: () => {
      closedCount += 1
    },
    platform,
    preloadPath: '/tmp/preload.js',
    rendererBase: () => 'http://127.0.0.1:5174',
    wireReveal: () => order.push('reveal'),
    wireWindow: () => order.push('wire')
  }

  return { closed: () => closedCount, controller: createPane3dController(deps), created, order, windows }
}

test('pane spawns transparent, frameless, non-focusable, over the work area', () => {
  const h = harness()
  const win = h.controller.open() as unknown as FakeWindow

  assert.equal(h.created.length, 1)
  const options = h.created[0]

  assert.deepEqual(
    { height: options.height, width: options.width, x: options.x, y: options.y },
    { height: 1080, width: 1920, x: 0, y: 0 }
  )
  assert.equal(options.transparent, true)
  assert.equal(options.frame, false)
  assert.equal(options.focusable, false)
  assert.equal(options.skipTaskbar, true)
  assert.equal(options.alwaysOnTop, true)
  assert.equal(options.backgroundColor, '#00000000')
  assert.equal(options.show, false)
  assert.equal((options.webPreferences as Record<string, unknown>).sandbox, true)
  assert.equal((options.webPreferences as Record<string, unknown>).contextIsolation, true)
  assert.equal(h.order.includes('load:http://127.0.0.1:5174/?win=pane3d#/'), true)

  // showInactive is only ever called by a reuse, never by spawn.
  assert.equal(win.shown, 0)
})

test('on linux click-through is a 1x1 shape applied before reveal and load, with no ignore call', () => {
  const h = harness({ platform: 'linux' })

  h.controller.open()

  const window = h.windows[0]

  assert.deepEqual(window.shape, [{ height: 1, width: 1, x: 0, y: 0 }])
  assert.equal(h.order.indexOf('set-shape') < h.order.indexOf('reveal'), true)
  assert.equal(h.order.indexOf('set-shape') < h.order.indexOf('load:http://127.0.0.1:5174/?win=pane3d#/'), true)
  // X11's setIgnoreMouseEvents(true) empties the input region for good, so the
  // spawn must reach click-through with the shape alone.
  assert.equal(window.ignore, null)
  assert.equal(h.order.includes('ignore-mouse'), false)
})

test('on macOS click-through forwards the mouse and never shapes the window', () => {
  const h = harness({ platform: 'darwin' })

  h.controller.open()

  assert.deepEqual(h.windows[0].ignore, { ignore: true, options: { forward: true } })
  assert.equal(h.windows[0].shape, null)
  assert.equal((h.created[0].type as string) === 'panel', true)
})

test('opening twice reuses the live window instead of duplicating it', () => {
  const h = harness()

  h.controller.open()
  h.controller.open()

  assert.equal(h.created.length, 1)
  assert.equal(h.windows[0].shown, 1)
  assert.equal(h.controller.isOpen(), true)
})

test('closing destroys the pane, reports it once, and a later open respawns', () => {
  const h = harness()

  const first = h.controller.open() as unknown as FakeWindow

  assert.equal(h.controller.isOpen(), true)

  h.controller.close()

  assert.equal(h.closed(), 1)
  assert.equal(h.controller.isOpen(), false)
  assert.equal(h.controller.getWindow(), null)

  h.controller.open()

  assert.equal(h.created.length, 2)
  assert.notEqual(h.windows[1], first)

  // Closing the replacement reports again; closing with nothing open is a no-op.
  h.controller.close()
  assert.equal(h.closed(), 2)

  h.controller.close()
  assert.equal(h.closed(), 2)
})

test('a close still in flight is destroyed before its replacement spawns', () => {
  const h = harness()

  h.controller.open()

  // close() without the 'closed' echo models an aborted/async close.
  h.windows[0].close = () => {
    h.order.push('close')
  }

  h.controller.close()
  h.controller.open()

  assert.equal(h.order.includes('destroy'), true)
  assert.equal(h.created.length, 2)
})
