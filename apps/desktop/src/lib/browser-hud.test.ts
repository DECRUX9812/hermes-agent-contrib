import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  canHostHudPortal,
  clampHudSize,
  clearStoredHudSize,
  createBrowserHud,
  HUD_DEFAULT_SIZE,
  type HudPortalHost,
  storedHudSize
} from './browser-hud'

type Listener = (event: Event) => void

interface FakePipWindow {
  addEventListener: (type: string, listener: Listener) => void
  close: ReturnType<typeof vi.fn>
  closed: boolean
  dispatch: (type: string) => void
  document: Document
  focus: ReturnType<typeof vi.fn>
  innerHeight: number
  innerWidth: number
  outerHeight: number
  outerWidth: number
  removeEventListener: (type: string, listener: Listener) => void
  resizeTo: ReturnType<typeof vi.fn>
  screen: { availHeight: number; availWidth: number }
}

const GEOMETRY_KEY = 'hermes.hud.pip.geometry.v1'

/**
 * A PiP window stand-in with a REAL jsdom document, because the module under
 * test builds DOM inside it (`createElement`, `<style>`, `<base>`): a hand-rolled
 * object with `createElement: vi.fn()` would prove nothing about the host the
 * HUD is portalled into.
 */
function fakePipWindow(size = { height: 800, width: 1280 }): FakePipWindow {
  const listeners = new Map<string, Set<Listener>>()

  const win: FakePipWindow = {
    addEventListener: (type, listener) => {
      const bucket = listeners.get(type) ?? new Set<Listener>()

      bucket.add(listener)
      listeners.set(type, bucket)
    },
    close: vi.fn(() => {
      win.closed = true
    }),
    closed: false,
    dispatch: type => {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type))
      }
    },
    document: document.implementation.createHTMLDocument('hud'),
    focus: vi.fn(),
    innerHeight: size.height,
    innerWidth: size.width,
    outerHeight: size.height,
    outerWidth: size.width,
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener)
    },
    resizeTo: vi.fn((width: number, height: number) => {
      win.outerWidth = width
      win.outerHeight = height
      win.innerWidth = width
      win.innerHeight = height
    }),
    screen: { availHeight: size.height, availWidth: size.width }
  }

  return win
}

function stubPip(pip: FakePipWindow) {
  const api = {
    requestWindow: vi.fn(async () => pip),
    window: null
  }

  vi.stubGlobal('documentPictureInPicture', api)

  return api
}

const hostSink = () => {
  const sink = vi.fn<(host: HudPortalHost | null) => void>()

  return sink
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('screen', { availHeight: 900, availWidth: 1440 })
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('browser HUD (Document Picture-in-Picture)', () => {
  it('is only offered where Document PiP exists, so the toggle cannot light up dead', () => {
    expect(canHostHudPortal()).toBe(false)

    stubPip(fakePipWindow())

    expect(canHostHudPortal()).toBe(true)
  })

  it('opens a PiP window at the HUD size and builds the portal host inside it', async () => {
    // The app's CSSOM is what gets copied, so give the opener a rule to copy.
    const openerStyle = document.createElement('style')

    openerStyle.textContent = ':root{--hermes-hud-test:1}'
    document.head.append(openerStyle)

    const pip = fakePipWindow()
    const api = stubPip(pip)
    const setHost = hostSink()
    const hud = createBrowserHud({ setHost })

    await expect(hud.open({ sessionId: 'sess-1' })).resolves.toEqual({ ok: true })

    expect(api.requestWindow).toHaveBeenCalledTimes(1)
    expect(api.requestWindow).toHaveBeenCalledWith({ height: 320, width: 620 })
    // Chrome ignores the hint on some Linux builds, so the size is re-applied.
    expect(pip.resizeTo).toHaveBeenCalledWith(620, 320)

    const container = pip.document.getElementById('hermes-hud-portal')

    expect(container).not.toBeNull()
    expect(container?.parentElement).toBe(pip.document.body)
    expect(setHost).toHaveBeenLastCalledWith({
      container,
      document: pip.document,
      window: pip
    })

    // Theme + styles travel into the PiP document: no second stylesheet fetch,
    // and the HUD is already painted when the user first sees the window.
    expect(pip.document.head.querySelector('base')?.getAttribute('href')).toBe(document.baseURI)
    expect(pip.document.head.querySelector('style')?.textContent).toContain('--hermes-hud-test')
    openerStyle.remove()
    expect(pip.document.documentElement.hasAttribute('data-hud-window')).toBe(true)
    expect(pip.document.title).toBe('Hermes HUD')
  })

  it('never opens a second window: a repeat open re-focuses the live one', async () => {
    const pip = fakePipWindow()
    const api = stubPip(pip)
    const hud = createBrowserHud({ setHost: hostSink() })

    await hud.open({ sessionId: 'sess-1' })
    await hud.open({ sessionId: 'sess-2' })

    expect(api.requestWindow).toHaveBeenCalledTimes(1)
    expect(pip.focus).toHaveBeenCalledTimes(1)
    expect(pip.document.querySelectorAll('#hermes-hud-portal')).toHaveLength(1)
  })

  it('reports open:true then open:false on the PiP document pagehide', async () => {
    const pip = fakePipWindow()

    stubPip(pip)

    const setHost = hostSink()
    const hud = createBrowserHud({ setHost })
    const changed = vi.fn()

    hud.onChanged(changed)
    await hud.open({ sessionId: 'sess-9' })

    expect(changed).toHaveBeenCalledWith({ open: true, sessionId: 'sess-9' })

    // The window was dismissed from its own OS controls: the app hears about it
    // through pagehide, exactly like Electron's 'closed' broadcast.
    pip.dispatch('pagehide')

    expect(changed).toHaveBeenLastCalledWith({ open: false, sessionId: 'sess-9' })
    expect(setHost).toHaveBeenLastCalledWith(null)
    expect(pip.document.getElementById('hermes-hud-portal')).toBeNull()
  })

  it('closes once and stays closed: close() is idempotent and cannot double-broadcast', async () => {
    const pip = fakePipWindow()

    stubPip(pip)

    const hud = createBrowserHud({ setHost: hostSink() })
    const changed = vi.fn()

    hud.onChanged(changed)
    await hud.open({})
    changed.mockClear()

    await hud.close()
    await hud.close()

    expect(pip.close).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith({ open: false, sessionId: null })

    // A close after the user already dismissed the window must not throw either.
    await expect(hud.close()).resolves.toEqual({ ok: true })
    expect(pip.close).toHaveBeenCalledTimes(1)
  })

  it('clamps the persisted size to the work area and resetLayout restores the default', async () => {
    localStorage.setItem(GEOMETRY_KEY, JSON.stringify({ height: 40, width: 5000 }))

    // The PiP window does not exist yet when the size is chosen, so the clamp
    // reads the opener's screen — same display, and the only one available.
    vi.stubGlobal('screen', { availHeight: 600, availWidth: 800 })

    const pip = fakePipWindow({ height: 600, width: 800 })

    stubPip(pip)

    const hud = createBrowserHud({ setHost: hostSink() })

    expect(storedHudSize()).toEqual({ height: 40, width: 5000 })

    await hud.open({})

    // Width clamped to the work area minus the frame margin, height to the
    // layout's 160px minimum.
    expect(pip.resizeTo).toHaveBeenCalledWith(752, 160)

    await hud.resetLayout()

    expect(storedHudSize()).toBeNull()
    expect(pip.resizeTo).toHaveBeenLastCalledWith(HUD_DEFAULT_SIZE.width, HUD_DEFAULT_SIZE.height)
  })

  it('degrades with a typed error when Document PiP is missing or refused', async () => {
    const hud = createBrowserHud({ setHost: hostSink() })

    await expect(hud.open({})).resolves.toEqual({ error: 'unsupported', ok: false })

    const setHost = hostSink()

    const api = {
      requestWindow: vi.fn(async () => {
        throw new DOMException('no activation', 'NotAllowedError')
      }),
      window: null
    }

    vi.stubGlobal('documentPictureInPicture', api)

    const refused = createBrowserHud({ setHost })

    await expect(refused.open({})).resolves.toEqual({ error: 'not-allowed', ok: false })
    expect(setHost).not.toHaveBeenCalled()
    // Never throws into React: `store/hud.ts` fires `void api.open(...)`.
    await expect(refused.close()).resolves.toEqual({ ok: true })
  })

  it('clamps every dimension into the screen and the layout minimums', () => {
    expect(clampHudSize({ height: 5000, width: 20 }, { availHeight: 900, availWidth: 1440 })).toEqual({
      height: 852,
      width: 380
    })
    expect(clampHudSize({ height: 300, width: 700 }, { availHeight: 900, availWidth: 1440 })).toEqual({
      height: 300,
      width: 700
    })
    // A display smaller than the minimums still gets a renderable HUD.
    expect(clampHudSize({ height: 40, width: 40 }, { availHeight: 200, availWidth: 200 })).toEqual({
      height: 160,
      width: 380
    })
  })

  it('forgets a geometry it could not parse instead of opening at 0×0', () => {
    localStorage.setItem(GEOMETRY_KEY, '{"height":"tall"}')

    expect(storedHudSize()).toBeNull()

    clearStoredHudSize()

    expect(localStorage.getItem(GEOMETRY_KEY)).toBeNull()
  })
})
