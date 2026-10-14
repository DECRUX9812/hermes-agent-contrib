import type { BrowserWindow } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  flashFrame: vi.fn(),
  getFocusedWindow: vi.fn((): unknown => null),
  ipcHandlers: new Map<string, (...args: unknown[]) => void>(),
  onApp: vi.fn(),
  setBadgeCount: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      host.onApp(event, listener)
    },
    quit: vi.fn(),
    setBadgeCount: (count: number) => host.setBadgeCount(count)
  },
  BrowserWindow: {
    getFocusedWindow: () => host.getFocusedWindow()
  },
  ipcMain: {
    handle: vi.fn(),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      host.ipcHandlers.set(channel, listener)
    }
  },
  Menu: { buildFromTemplate: vi.fn(() => []) },
  Tray: vi.fn(),
  nativeImage: { createFromPath: vi.fn(() => ({})) }
}))

import { createMinimizeToTray } from './minimize-to-tray'
import { DEFAULT_TRAY_STATUS_STRINGS } from './tray-status'

function windowStub() {
  return {
    flashFrame: host.flashFrame,
    isDestroyed: () => false,
    on: vi.fn()
  } as unknown as BrowserWindow
}

function pushHandler() {
  const handler = host.ipcHandlers.get('hermes:menu-bar-status:push')

  if (!handler) {
    throw new Error('push handler was not registered')
  }

  return handler
}

function focusHandler() {
  const call = host.onApp.mock.calls.find(([event]) => event === 'browser-window-focus')

  if (!call) {
    throw new Error('browser-window-focus handler was not registered')
  }

  return call[1] as () => void
}

function push(overrides: Record<string, unknown> = {}) {
  return {
    activeRuns: 0,
    needsYou: 0,
    sessions: [],
    strings: { ...DEFAULT_TRAY_STATUS_STRINGS },
    ...overrides
  }
}

function realPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { configurable: true, value })
}

afterEach(() => {
  host.ipcHandlers.clear()
  host.onApp.mockClear()
  host.setBadgeCount.mockClear()
  host.flashFrame.mockClear()
  host.getFocusedWindow.mockReset()
  host.getFocusedWindow.mockReturnValue(null)
  realPlatform('linux')
})

describe('attention badge', () => {
  it('sets the app badge to the needs-input count on every push', () => {
    createMinimizeToTray({
      focusSession: () => {},
      getIconPath: () => undefined,
      isQuittingForHandoff: () => false,
      log: () => {},
      newSession: () => {},
      preferencesPath: '/nonexistent-prefs.json',
      quickEntryEnabled: () => false,
      restoreMainWindow: () => {},
      summonQuickEntry: () => {}
    })

    pushHandler()(undefined, push({ needsInput: 2, needsYou: 3 }))

    expect(host.setBadgeCount).toHaveBeenCalledWith(2)
  })

  it('badges zero when the renderer omits the count', () => {
    createMinimizeToTray({
      focusSession: () => {},
      getIconPath: () => undefined,
      isQuittingForHandoff: () => false,
      log: () => {},
      newSession: () => {},
      preferencesPath: '/nonexistent-prefs.json',
      quickEntryEnabled: () => false,
      restoreMainWindow: () => {},
      summonQuickEntry: () => {}
    })

    // The helper never sets the count — this is an older renderer's payload.
    pushHandler()(undefined, push({ needsYou: 1 }))

    expect(host.setBadgeCount).toHaveBeenCalledWith(0)
  })

  it('flashes the primary window on Windows when the count rises with nothing focused', () => {
    realPlatform('win32')

    const module = createMinimizeToTray({
      focusSession: () => {},
      getIconPath: () => undefined,
      isQuittingForHandoff: () => false,
      log: () => {},
      newSession: () => {},
      preferencesPath: '/nonexistent-prefs.json',
      quickEntryEnabled: () => false,
      restoreMainWindow: () => {},
      summonQuickEntry: () => {}
    })

    module.registerWindow(windowStub())

    pushHandler()(undefined, push({ needsInput: 1 }))

    expect(host.flashFrame).toHaveBeenCalledWith(true)

    focusHandler()()

    expect(host.flashFrame).toHaveBeenCalledWith(false)
  })

  it('does not flash on Windows when the count falls or a window is focused', () => {
    realPlatform('win32')

    const module = createMinimizeToTray({
      focusSession: () => {},
      getIconPath: () => undefined,
      isQuittingForHandoff: () => false,
      log: () => {},
      newSession: () => {},
      preferencesPath: '/nonexistent-prefs.json',
      quickEntryEnabled: () => false,
      restoreMainWindow: () => {},
      summonQuickEntry: () => {}
    })

    module.registerWindow(windowStub())

    pushHandler()(undefined, push({ needsInput: 3 }))
    host.flashFrame.mockClear()

    pushHandler()(undefined, push({ needsInput: 1 }))

    expect(host.flashFrame).not.toHaveBeenCalled()

    host.getFocusedWindow.mockReturnValue(windowStub())
    pushHandler()(undefined, push({ needsInput: 5 }))

    expect(host.flashFrame).not.toHaveBeenCalled()
  })
})
