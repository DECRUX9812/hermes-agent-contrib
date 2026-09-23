/**
 * Unit tests for the main-process window shortcut installers
 * (Ctrl/Cmd+W close, Ctrl/Cmd+R reload, F12/Ctrl+Shift+I DevTools).
 *
 * Regression: `before-input-event` fires for BOTH keyDown and keyUp. A chord
 * started in another window can deliver its keyUp here after a mid-chord
 * focus transfer (e.g. Ctrl held, W released once this window is focused),
 * so every shortcut must gate on `input.type === 'keyDown'` — a stray keyUp
 * must never close a tab, reload, or open DevTools.
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import type { BrowserWindow, Input } from 'electron'
import { describe, test } from 'vitest'

import {
  installDevToolsShortcut,
  installPreviewShortcut,
  type WindowShortcutDeps
} from './window-shortcuts'

interface Harness {
  window: BrowserWindow
  deps: WindowShortcutDeps
  calls: {
    toggleDevTools: number
    closeHudWindow: number
    sendClosePreviewRequested: number
    nav: string[]
  }
  prevented: number
  input: (overrides: Partial<Input>) => void
}

function makeHarness(): Harness {
  const emitter = new EventEmitter()
  const wc = { on: emitter.on.bind(emitter) }
  const window = { webContents: wc } as unknown as BrowserWindow

  const harness: Harness = {
    window,
    prevented: 0,
    calls: { toggleDevTools: 0, closeHudWindow: 0, sendClosePreviewRequested: 0, nav: [] },
    deps: {
      isMac: false,
      isF12Blocked: () => false,
      toggleDevTools: () => {
        harness.calls.toggleDevTools++
      },
      getHudWindow: () => null,
      closeHudWindow: () => {
        harness.calls.closeHudWindow++
      },
      sendClosePreviewRequested: () => {
        harness.calls.sendClosePreviewRequested++
      },
      sendPreviewNavCommand: command => {
        harness.calls.nav.push(command)
      }
    },
    input(overrides: Partial<Input>) {
      const event = { preventDefault: () => harness.prevented++ }
      emitter.emit('before-input-event', event, {
        type: 'keyDown',
        key: '',
        control: false,
        meta: false,
        alt: false,
        shift: false,
        ...overrides
      })
    }
  }

  return harness
}

describe('installPreviewShortcut', () => {
  test('Ctrl+W keyDown requests close', () => {
    const h = makeHarness()
    installPreviewShortcut(h.window, h.deps)

    h.input({ type: 'keyDown', key: 'w', control: true })

    assert.equal(h.calls.sendClosePreviewRequested, 1)
    assert.equal(h.prevented, 1)
  })

  test('Ctrl+W keyUp does NOT request close', () => {
    const h = makeHarness()
    installPreviewShortcut(h.window, h.deps)

    h.input({ type: 'keyUp', key: 'w', control: true })

    assert.equal(h.calls.sendClosePreviewRequested, 0, 'stray Ctrl+W keyup must not close a tab')
    assert.equal(h.prevented, 0)
  })

  test('Ctrl+R keyDown reloads; keyUp does NOT', () => {
    const h = makeHarness()
    installPreviewShortcut(h.window, h.deps)

    h.input({ type: 'keyUp', key: 'r', control: true })
    assert.deepEqual(h.calls.nav, [], 'stray Ctrl+R keyup must not reload')

    h.input({ type: 'keyDown', key: 'r', control: true })
    assert.deepEqual(h.calls.nav, ['reload'])
  })
})

describe('installDevToolsShortcut', () => {
  test('F12 keyDown toggles DevTools; keyUp does NOT', () => {
    const h = makeHarness()
    installDevToolsShortcut(h.window, h.deps)

    h.input({ type: 'keyUp', key: 'F12' })
    assert.equal(h.calls.toggleDevTools, 0, 'stray F12 keyup must not toggle DevTools')

    h.input({ type: 'keyDown', key: 'F12' })
    assert.equal(h.calls.toggleDevTools, 1)
  })

  test('Ctrl+Shift+I keyDown toggles DevTools; keyUp does NOT', () => {
    const h = makeHarness()
    installDevToolsShortcut(h.window, h.deps)

    h.input({ type: 'keyUp', key: 'i', control: true, shift: true })
    assert.equal(h.calls.toggleDevTools, 0)

    h.input({ type: 'keyDown', key: 'i', control: true, shift: true })
    assert.equal(h.calls.toggleDevTools, 1)
  })
})
