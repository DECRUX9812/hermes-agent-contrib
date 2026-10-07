/**
 * Contract tests for the 3D-Pane PageContextService (architecture §9,
 * VAL-CONTEXT-004).
 *
 * The source order, the selection cap, the failure handling (a guest whose
 * `executeJavaScript` rejects or hangs) and the 800 ms bound are all proven
 * through injected window/guest handles, so no Electron is booted. The service
 * reuses the AnchorService's guest selection (`collectHostCandidates` +
 * `pickHermesGuest`), which is why a hidden host, a minimized host and a
 * destroyed guest are skipped here exactly as they are for the anchor.
 */

import { describe, expect, it } from 'vitest'

import type { ScreenRect } from '../src/app/pane3d/protocol'

import type { AnchorGuestCandidate } from './pane3d-anchor-pick'
import type { AnchorHostWindow, AnchorOsWindow } from './pane3d-anchor-types'
import {
  CONTEXT_TIMEOUT_MS,
  type ContextGuestHandle,
  createPageContextService,
  normalizeSelection,
  SELECTION_MAX_CHARS
} from './pane3d-context'

const rect = (x: number, y: number, width: number, height: number): ScreenRect => ({ height, width, x, y })

const URL = 'http://127.0.0.1:5181/x-post.html'
const TITLE = 'Ada on X: "Look at this generative shader"'
const GUEST_ID = 7

interface BrowserOptions {
  detached?: boolean
  destroyed?: boolean
  executeJavaScript?: (code: string) => Promise<unknown>
  hostMinimized?: boolean
  hostVisible?: boolean
  probe?: () => Promise<AnchorGuestCandidate[]>
  selection?: string
  title?: string
  url?: string
  visible?: boolean
  webContentsId?: number
}

/** One host window plus its in-app-browser guest, wired to each other by id. */
function browser(options: BrowserOptions = {}): { guest: ContextGuestHandle; host: AnchorHostWindow; id: number } {
  const id = options.webContentsId ?? GUEST_ID

  const candidate: AnchorGuestCandidate = {
    active: true,
    rect: rect(20, 30, 800, 600),
    title: options.title ?? TITLE,
    visible: options.visible ?? true,
    webContentsId: id
  }

  const host: AnchorHostWindow = {
    getContentBounds: () => rect(0, 0, 1920, 1080),
    getZoomFactor: () => 0.9,
    id: 1,
    isDestroyed: () => false,
    isFocused: () => true,
    isMinimized: () => options.hostMinimized ?? false,
    isVisible: () => options.hostVisible ?? true,
    on: () => {},
    probeWebviews: options.probe ?? (async () => [candidate]),
    removeListener: () => {}
  }

  const guest: ContextGuestHandle = {
    executeJavaScript: options.executeJavaScript ?? (async () => options.selection ?? ''),
    getHost: () => (options.detached ? null : host),
    getTitle: () => options.title ?? TITLE,
    getURL: () => options.url ?? URL,
    isDestroyed: () => options.destroyed ?? false,
    on: () => {},
    removeListener: () => {},
    webContentsId: id
  }

  return { guest, host, id }
}

function makeService(
  options: {
    browsers?: { guest: ContextGuestHandle; host: AnchorHostWindow }[]
    os?: AnchorOsWindow | null
    osError?: boolean
    timeoutMs?: number
  } = {}
) {
  const browsers = options.browsers ?? []

  return createPageContextService({
    enumerateOsWindow: async () => {
      if (options.osError) {
        throw new Error('enumeration failed')
      }

      return options.os ?? null
    },
    listGuests: () => browsers.map(entry => entry.guest),
    listHosts: () => browsers.map(entry => entry.host),
    now: () => 1_000,
    timeoutMs: options.timeoutMs
  })
}

const osWindow = (over: Partial<AnchorOsWindow> = {}): AnchorOsWindow => ({
  app: 'Firefox',
  bounds: rect(100, 100, 1200, 800),
  title: 'Generative shaders — MDN',
  ...over
})

// ── normalizeSelection ─────────────────────────────────────────────────────

describe('normalizeSelection', () => {
  it('trims a string selection', () => {
    expect(normalizeSelection('  hello world  ')).toBe('hello world')
  })

  it('caps the selection at 4000 characters', () => {
    const long = 'x'.repeat(SELECTION_MAX_CHARS + 250)

    expect(normalizeSelection(long)).toHaveLength(SELECTION_MAX_CHARS)
  })

  it('treats a blank or non-string selection as absent', () => {
    expect(normalizeSelection('   ')).toBeNull()
    expect(normalizeSelection(null)).toBeNull()
    expect(normalizeSelection(42)).toBeNull()
  })
})

// ── source order ───────────────────────────────────────────────────────────

describe('PageContextService source order', () => {
  it('captures url, title and selection from the in-app browser guest first', async () => {
    const { guest, host } = browser({ selection: '  Look at this generative shader  ' })
    const context = await makeService({ browsers: [{ guest, host }], os: osWindow() }).capture()

    expect(context).toEqual({
      capturedAt: 1_000,
      selection: 'Look at this generative shader',
      source: 'hermes-browser',
      title: TITLE,
      url: URL
    })
  })

  it('falls back to the frontmost foreign OS window with title and app', async () => {
    const context = await makeService({ os: osWindow() }).capture()

    expect(context).toEqual({
      app: 'Firefox',
      capturedAt: 1_000,
      source: 'os-window',
      title: 'Generative shaders — MDN'
    })
  })

  it('returns none when there is no in-app page and no OS window', async () => {
    const context = await makeService().capture()

    expect(context).toEqual({ capturedAt: 1_000, source: 'none' })
  })
})

// ── failure handling ───────────────────────────────────────────────────────

describe('PageContextService failure handling', () => {
  it('omits the selection when executeJavaScript fails, without throwing', async () => {
    const { guest, host } = browser({
      executeJavaScript: async () => {
        throw new Error('guest gone')
      }
    })

    const context = await makeService({ browsers: [{ guest, host }] }).capture()

    expect(context.source).toBe('hermes-browser')
    expect(context.url).toBe(URL)
    expect(context.title).toBe(TITLE)
    expect('selection' in context).toBe(false)
  })

  it('omits a whitespace-only selection', async () => {
    const { guest, host } = browser({ selection: '   \n  ' })
    const context = await makeService({ browsers: [{ guest, host }] }).capture()

    expect('selection' in context).toBe(false)
  })

  it('treats a rejected host probe as no guest and falls back', async () => {
    const { guest, host } = browser({
      probe: async () => {
        throw new Error('host renderer hung')
      }
    })

    const context = await makeService({ browsers: [{ guest, host }], os: osWindow() }).capture()

    expect(context.source).toBe('os-window')
  })

  it('never throws when OS enumeration fails', async () => {
    await expect(makeService({ osError: true }).capture()).resolves.toEqual({ capturedAt: 1_000, source: 'none' })
  })
})

// ── skipped sources ────────────────────────────────────────────────────────

describe('PageContextService skips unusable browser sources', () => {
  it('skips a destroyed guest even when it still reports a rect', async () => {
    const { guest, host } = browser({ destroyed: true })
    const context = await makeService({ browsers: [{ guest, host }], os: osWindow() }).capture()

    expect(context.source).toBe('os-window')
    expect(context.title).toBe('Generative shaders — MDN')
  })

  it('skips a hidden host (HUD mode) and falls back to the OS window', async () => {
    const { guest, host } = browser({ hostVisible: false })
    const context = await makeService({ browsers: [{ guest, host }], os: osWindow() }).capture()

    expect(context.source).toBe('os-window')
  })

  it('skips a minimized host and falls back to the OS window', async () => {
    const { guest, host } = browser({ hostMinimized: true })
    const context = await makeService({ browsers: [{ guest, host }], os: osWindow() }).capture()

    expect(context.source).toBe('os-window')
  })

  it('skips a guest that is not visible in its host and returns none without a window', async () => {
    const { guest, host } = browser({ visible: false })
    const context = await makeService({ browsers: [{ guest, host }] }).capture()

    expect(context.source).toBe('none')
  })

  it('skips a guest whose host reports it as hidden', async () => {
    const { guest, host } = browser({ visible: false })
    const context = await makeService({ browsers: [{ guest, host }], os: osWindow() }).capture()

    expect(context.source).toBe('os-window')
  })
})

// ── bounded ────────────────────────────────────────────────────────────────

describe('PageContextService is bounded', () => {
  it('resolves with the default 800 ms budget when the guest never answers', async () => {
    const { guest, host } = browser({ executeJavaScript: () => new Promise<unknown>(() => {}) })
    const started = Date.now()
    const context = await makeService({ browsers: [{ guest, host }] }).capture()
    const elapsed = Date.now() - started

    expect(context).toEqual({ capturedAt: 1_000, source: 'none' })
    expect(elapsed).toBeLessThanOrEqual(CONTEXT_TIMEOUT_MS + 150)
  })

  it('resolves with none when an injected budget elapses, even with a pending OS enumeration', async () => {
    const service = createPageContextService({
      enumerateOsWindow: () => new Promise<AnchorOsWindow | null>(() => {}),
      listGuests: () => [],
      listHosts: () => [],
      timeoutMs: 30
    })

    const started = Date.now()
    const context = await service.capture()

    expect(context.source).toBe('none')
    expect(Date.now() - started).toBeLessThan(400)
  })
})
