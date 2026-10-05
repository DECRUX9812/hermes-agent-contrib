/**
 * Contract tests for the 3D-Pane IPC relay (architecture §4): the sender check
 * that keeps only the pane window's control messages authoritative, and the
 * notify-before-ready queue that must never drop a notification.
 *
 * `electron` is mocked because a plain-node test has no ipcMain; the relay's
 * decisions are then driven through the exact channels registerPane3dIpc wires.
 */

import assert from 'node:assert/strict'

import type { BrowserWindow } from 'electron'
import { beforeEach, test, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: { window?: unknown } | null) => sender?.window ?? null },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    },
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      electron.listeners.set(channel, listener)
    }
  },
  screen: {}
}))

import type { ScreenRect } from '../src/app/pane3d/protocol'

import { createPane3dRelay, isPaneSender, PANE3D_CHANNELS, registerPane3dIpc } from './pane3d-ipc'

const paneWindow = {
  isDestroyed: () => false,
  label: 'pane',
  focus: () => {},
  setFocusable: () => {},
  setIgnoreMouseEvents: () => {},
  webContents: { send: () => {} }
}

const foreignWindow = { isDestroyed: () => false }
const resolveWindow = (sender: unknown) => (sender as { window?: unknown } | null)?.window ?? null

function relayHarness({ paneOpen = true } = {}) {
  const sent: Array<Record<string, unknown>> = []
  const toHost: Array<Record<string, unknown>> = []
  const focusable: boolean[] = []
  const ignored: boolean[] = []
  const shapes: ScreenRect[][] = []
  let opened = 0
  let closed = 0
  let raised = 0
  let ready = 0

  const relay = createPane3dRelay({
    applyHitRegions: regions => shapes.push(regions),
    closePane: () => {
      closed += 1
    },
    isPaneOpen: () => paneOpen,
    newId: () => 'notify-1',
    onReady: () => {
      ready += 1
    },
    openPane: () => {
      opened += 1
    },
    raiseMainWindow: () => {
      raised += 1
    },
    sendToHost: control => toHost.push(control as Record<string, unknown>),
    sendToPane: state => sent.push(state as Record<string, unknown>),
    setPaneFocusable: value => focusable.push(value),
    setPaneIgnoreMouse: value => ignored.push(value)
  })

  return {
    closed: () => closed,
    focusable,
    ignored,
    opened: () => opened,
    raised: () => raised,
    ready: () => ready,
    relay,
    sent,
    shapes,
    toHost
  }
}

const requestOf = (state: Record<string, unknown> | undefined) => state?.request

test('notify to a closed pane opens it and holds the request until ready', () => {
  const h = relayHarness({ paneOpen: false })

  const id = h.relay.notify({ avatar: 'muse', title: 'Hi', body: 'Body' })

  assert.equal(id, 'notify-1')
  assert.equal(h.opened(), 1)
  assert.equal(h.sent.length, 0, 'nothing may be sent before the pane is ready')

  h.relay.onPaneControl({ type: 'ready' }, true)

  assert.equal(h.sent.length, 1)
  assert.deepEqual(requestOf(h.sent[0]), { avatar: 'muse', title: 'Hi', body: 'Body' })
  assert.equal(h.sent[0].id, 'notify-1')
})

test('notify to an open-but-not-ready pane queues instead of dropping', () => {
  const h = relayHarness({ paneOpen: true })

  h.relay.notify({ avatar: 'grok', title: 'One', body: 'First' })
  h.relay.notify({ avatar: 'grok', title: 'Two', body: 'Second' })

  assert.equal(h.sent.length, 0)
  assert.equal(h.opened(), 0, 'the pane is already open — notifying must not reopen it')

  h.relay.onPaneControl({ type: 'ready' }, true)

  assert.equal(h.sent.length, 2)
})

test('notify sent after ready goes straight to the pane', () => {
  const h = relayHarness({ paneOpen: true })

  h.relay.onPaneControl({ type: 'ready' }, true)
  h.relay.notify({ avatar: 'claude', title: 'Now', body: 'Live' })

  assert.equal(h.sent.length, 1)
  assert.equal(h.opened(), 0)
})

test('only the pane window may flip focus, ignore-mouse or forward control', () => {
  const h = relayHarness({ paneOpen: true })

  h.relay.onPaneControl({ type: 'focus', focusable: true }, false)
  h.relay.onPaneControl({ type: 'ignore-mouse', ignore: true }, false)
  h.relay.onPaneControl({ type: 'notify.action', id: 'n1', actionId: 'open' }, false)
  h.relay.onPaneControl({ type: 'close' }, false)

  assert.deepEqual(h.focusable, [])
  assert.deepEqual(h.ignored, [])
  assert.deepEqual(h.toHost, [])
  assert.equal(h.closed(), 0)
})

test('the pane window may flip focus, ignore-mouse and forward notify actions', () => {
  const h = relayHarness({ paneOpen: true })

  h.relay.onPaneControl({ type: 'focus', focusable: true }, true)
  h.relay.onPaneControl({ type: 'ignore-mouse', ignore: true }, true)
  h.relay.onPaneControl({ type: 'notify.action', id: 'n1', actionId: 'open' }, true)
  h.relay.onPaneControl({ type: 'notify.dismissed', id: 'n2' }, true)
  h.relay.onPaneControl({ type: 'close' }, true)

  assert.deepEqual(h.focusable, [true])
  assert.deepEqual(h.ignored, [true])
  assert.deepEqual(h.toHost, [
    { type: 'notify.action', id: 'n1', actionId: 'open' },
    { type: 'notify.dismissed', id: 'n2' }
  ])
  assert.equal(h.closed(), 1)
})

test('hit regions reach the applier only from the pane window', () => {
  const h = relayHarness({ paneOpen: true })
  const regions: ScreenRect[] = [{ height: 10, width: 10, x: 1, y: 2 }]

  h.relay.onPaneControl({ regions, type: 'hit-regions' }, false)
  assert.deepEqual(h.shapes, [], 'a foreign window cannot shape the pane')

  h.relay.onPaneControl({ regions, type: 'hit-regions' }, true)
  assert.deepEqual(h.shapes, [regions])
})

test('summon and dismiss never open a closed pane', () => {
  const h = relayHarness({ paneOpen: false })

  h.relay.summon('muse')
  h.relay.dismiss('muse')

  assert.equal(h.opened(), 0)
  assert.equal(h.sent.length, 0)
})

test('playDemo opens a closed pane and waits for ready', () => {
  const h = relayHarness({ paneOpen: false })

  h.relay.playDemo('launch')

  assert.equal(h.opened(), 1)
  assert.equal(h.sent.length, 0)

  h.relay.onPaneControl({ type: 'ready' }, true)

  assert.deepEqual(h.sent, [{ type: 'demo', script: 'launch' }])
})

test('ready fires onReady once the pane renderer announces itself', () => {
  const h = relayHarness({ paneOpen: true })

  assert.equal(h.ready(), 0)

  h.relay.onPaneControl({ type: 'ready' }, true)
  assert.equal(h.ready(), 1)

  // A ready from a foreign window is refused, like every pane control.
  h.relay.onPaneControl({ type: 'ready' }, false)
  assert.equal(h.ready(), 1)
})

test('isPaneSender accepts only a live pane window for the sender', () => {
  const sender = { window: paneWindow }

  assert.equal(isPaneSender(sender, paneWindow, resolveWindow), true)
  assert.equal(isPaneSender({ window: foreignWindow }, paneWindow, resolveWindow), false)
  assert.equal(isPaneSender(sender, null, resolveWindow), false)
  assert.equal(isPaneSender(sender, { isDestroyed: () => true }, resolveWindow), false)
  assert.equal(isPaneSender(null, paneWindow, resolveWindow), false)
})

beforeEach(() => {
  electron.handlers.clear()
  electron.listeners.clear()
})

test('registerPane3dIpc wires the documented channels and honors the pane sender check', async () => {
  const paneMessages: Array<Record<string, unknown>> = []
  const focusCalls: boolean[] = []
  const shapeCalls: ScreenRect[][] = []
  let opened = 0

  const livePane = {
    ...paneWindow,
    setFocusable: (value: boolean) => focusCalls.push(value),
    setShape: (rects: ScreenRect[]) => shapeCalls.push(rects),
    webContents: {
      getZoomFactor: () => 0.9,
      send: (_channel: string, payload: Record<string, unknown>) => paneMessages.push(payload)
    }
  }

  registerPane3dIpc({
    closePane3d: () => {},
    getMainWindow: () => null,
    getPaneWindow: () => livePane as unknown as BrowserWindow,
    isPane3dOpen: () => true,
    newId: () => 'id-9',
    openPane3d: () => {
      opened += 1
    }
  })

  assert.ok(electron.handlers.has(PANE3D_CHANNELS.open))
  assert.ok(electron.handlers.has(PANE3D_CHANNELS.notify))
  assert.ok(electron.listeners.has(PANE3D_CHANNELS.panel))

  const open = await electron.handlers.get(PANE3D_CHANNELS.open)!(null)

  assert.deepEqual(open, { ok: true })
  assert.equal(opened, 1)

  const notify = (await electron.handlers.get(PANE3D_CHANNELS.notify)!(null, {
    avatar: 'muse',
    title: 'T',
    body: 'B'
  })) as { ok: boolean; id: string }

  assert.deepEqual(notify, { ok: true, id: 'id-9' })
  assert.equal(paneMessages.length, 0, 'the pane has not said ready yet')

  // A foreign sender must not be able to flip focus on the pane.
  electron.listeners.get(PANE3D_CHANNELS.panel)!(
    { sender: { window: foreignWindow } },
    { type: 'focus', focusable: true }
  )
  assert.deepEqual(focusCalls, [])

  // The pane's own ready message flushes the queued notify, and only it may focus.
  electron.listeners.get(PANE3D_CHANNELS.panel)!({ sender: { window: livePane } }, { type: 'ready' })
  electron.listeners.get(PANE3D_CHANNELS.panel)!({ sender: { window: livePane } }, { type: 'focus', focusable: true })

  assert.equal(paneMessages.length, 1)
  assert.equal(paneMessages[0].type, 'notify')
  assert.deepEqual(focusCalls, [true])

  // Hit regions: refused from a foreign sender, shaped for the pane with the
  // zoom factor applied (10..110 CSS px at 0.9 -> 9..99 DIP), and a 1x1 shape
  // — never setShape([]) — when nothing is interactive.
  const panel = electron.listeners.get(PANE3D_CHANNELS.panel)!
  const regions: ScreenRect[] = [{ height: 50, width: 100, x: 10, y: 20 }]

  panel({ sender: { window: foreignWindow } }, { regions, type: 'hit-regions' })
  assert.deepEqual(shapeCalls, [])

  panel({ sender: { window: livePane } }, { regions, type: 'hit-regions' })
  assert.deepEqual(shapeCalls, [[{ height: 45, width: 90, x: 9, y: 18 }]])

  panel({ sender: { window: livePane } }, { regions: [], type: 'hit-regions' })
  assert.deepEqual(shapeCalls[1], [{ height: 1, width: 1, x: 0, y: 0 }])
})

test('registerPane3dIpc capture-context resolves the none stub without a service', async () => {
  registerPane3dIpc({
    closePane3d: () => {},
    getMainWindow: () => null,
    getPaneWindow: () => paneWindow as unknown as BrowserWindow,
    isPane3dOpen: () => false,
    openPane3d: () => {}
  })

  const context = (await electron.handlers.get(PANE3D_CHANNELS.captureContext)!(null)) as {
    capturedAt: number
    source: string
  }

  assert.equal(context.source, 'none')
  assert.equal(typeof context.capturedAt, 'number')
})
