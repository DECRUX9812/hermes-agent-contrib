/**
 * Contract tests for the main-renderer 3D-Pane store: the palette's
 * open/close label must follow the real window state, including when the pane
 * closes itself and main echoes `close` back.
 */

import { assert, beforeEach, test } from 'vitest'

import {
  $pane3dOpen,
  closePane3d,
  handlePane3dControl,
  notifyPane3d,
  openPane3d,
  playPane3dDemo,
  togglePane3d
} from './pane3d'

const calls: string[] = []

const pane3dApi = {
  captureContext: async () => ({ capturedAt: 1, source: 'none' as const }),
  close: async () => {
    calls.push('close')

    return { ok: true }
  },
  dismiss: async () => {
    calls.push('dismiss')

    return { ok: true }
  },
  isOpen: async () => $pane3dOpen.get(),
  notify: async (request: unknown) => {
    calls.push(`notify:${(request as { title: string }).title}`)

    return { id: 'n-1', ok: true }
  },
  onControl: () => () => {},
  onState: () => () => {},
  open: async () => {
    calls.push('open')

    return { ok: true }
  },
  playDemo: async (script: string) => {
    calls.push(`demo:${script}`)

    return { ok: true }
  },
  summon: async () => {
    calls.push('summon')

    return { ok: true }
  }
}

beforeEach(() => {
  calls.length = 0
  $pane3dOpen.set(false)
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { pane3d: pane3dApi }
})

test('opening the pane flips the shared open state', async () => {
  assert.equal($pane3dOpen.get(), false)

  const ok = await openPane3d()

  assert.equal(ok, true)
  assert.deepEqual(calls, ['open'])
  assert.equal($pane3dOpen.get(), true)
})

test('the pane close control flips the state back without a store call', () => {
  $pane3dOpen.set(true)

  handlePane3dControl({ type: 'close' })

  assert.equal($pane3dOpen.get(), false)
  assert.deepEqual(calls, [])
})

test('closePane3d clears the state even if main reports nothing', async () => {
  $pane3dOpen.set(true)

  await closePane3d()

  assert.equal($pane3dOpen.get(), false)
  assert.deepEqual(calls, ['close'])
})

test('toggling follows the current open state', async () => {
  await togglePane3d()
  assert.deepEqual(calls, ['open'])

  await togglePane3d()
  assert.deepEqual(calls, ['open', 'close'])
  assert.equal($pane3dOpen.get(), false)
})

test('playPane3dDemo opens the pane and forwards the script', async () => {
  const ok = await playPane3dDemo('launch')

  assert.equal(ok, true)
  assert.deepEqual(calls, ['demo:launch'])
  assert.equal($pane3dOpen.get(), true)
})

test('notifyPane3d returns the id and marks the pane open', async () => {
  const id = await notifyPane3d({ avatar: 'muse', body: 'Body', title: 'Title' })

  assert.equal(id, 'n-1')
  assert.deepEqual(calls, ['notify:Title'])
  assert.equal($pane3dOpen.get(), true)
})
