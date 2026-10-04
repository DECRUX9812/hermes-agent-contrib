/**
 * Page bridge — routes page actions to a content script and serializes
 * conflicting writes per tab so two parallel bots never type into the same
 * field at once (reads/snapshots stay parallel; mutating actions queue).
 *
 * Results come back as separate `action.result` runtime messages (MV3
 * workers can't rely on sendResponse staying alive across worker reaps), so
 * commands are correlated by commandId. Tab-level operations that need the
 * chrome.tabs API (list tabs, activate, screenshot) never reach the content
 * script — they execute right here.
 */

import type { PageActionRequest, PageActionResult } from '../shared/types'

import { rid } from './harness'

const MUTATING = new Set([
  'browser_click', 'browser_type', 'browser_press', 'browser_navigate',
  'browser_back', 'browser_scroll', 'browser_tab_activate',
  'navigate', 'click', 'type', 'press', 'scroll', 'back', 'tab_activate',
  'dom_hide', 'dom_insert', 'dom_style', 'compose',
])

const TIMEOUT_MS = 45000

/** Actions the service worker answers itself (need chrome.tabs, not DOM). */
const SW_LEVEL = new Set(['browser_tabs', 'tabs', 'browser_tab_activate', 'tab_activate', 'browser_screenshot', 'screenshot', 'web.fetch'])

interface Pending {
  resolve: (r: PageActionResult) => void
  timer: ReturnType<typeof setTimeout>
}

export class PageBridge {
  /** Last tab the user interacted with the overlay in — the default target. */
  private anchorTab: number | null = null
  private tails = new Map<number, Promise<unknown>>()
  private pending = new Map<string, Pending>()

  setAnchor(tabId: number) {
    this.anchorTab = tabId
  }

  /** Content scripts report action results here. */
  resolveResult(payload: PageActionResult) {
    const p = this.pending.get(payload.commandId)

    if (!p) {return}
    clearTimeout(p.timer)
    this.pending.delete(payload.commandId)
    p.resolve(payload)
  }

  private async targetTab(): Promise<number> {
    if (this.anchorTab !== null) {
      try {
        const t = await chrome.tabs.get(this.anchorTab)

        if (t && t.id !== undefined) {return t.id}
      } catch { /* fell through — pick active */ }

      this.anchorTab = null
    }

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })

    if (tab?.id === undefined) {throw new Error('no active tab')}

    return tab.id
  }

  private async swLevel(action: string, args: Record<string, unknown>): Promise<PageActionResult> {
    try {
      switch (action) {
        case 'browser_tabs':
        case 'tabs': {
          const tabs = await chrome.tabs.query({})

          return {
            commandId: '',
            ok: true,
            result: tabs.map((t) => ({
              id: t.id,
              url: t.url,
              title: t.title,
              active: t.active,
            })),
          }
        }

        case 'browser_tab_activate':
        case 'tab_activate': {
          const id = (args.tabId ?? args.id) as number | undefined

          if (id === undefined) {return { commandId: '', ok: false, error: 'missing tabId' }}
          await chrome.tabs.update(id, { active: true })
          const t = await chrome.tabs.get(id)

          if (t.windowId !== undefined) {await chrome.windows.update(t.windowId, { focused: true })}
          this.anchorTab = id

          return { commandId: '', ok: true, result: { id } }
        }

        case 'browser_screenshot':
        case 'screenshot': {
          const dataUrl = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, { format: 'jpeg', quality: 60 })

          return { commandId: '', ok: true, result: { dataUrl } }
        }

        case 'web.fetch': {
          // "Already logged in as you" — SW fetch carries the user's cookies
          // for any host the extension has permission for.
          const url = String(args.url ?? '')

          if (!/^https?:\/\//.test(url)) {
            return { commandId: '', ok: false, error: 'bad url' }
          }

          const res = await fetch(url, {
            method: (args.method as string) ?? 'GET',
            headers: args.headers as Record<string, string> | undefined,
            body: args.body as string | undefined,
            credentials: 'include',
            redirect: 'follow',
          })

          const text = (await res.text()).slice(0, 40000)

          return {
            commandId: '',
            ok: true,
            result: { status: res.status, contentType: res.headers.get('content-type'), text, url: res.url },
          }
        }

        default:
          return { commandId: '', ok: false, error: `unknown sw action ${action}` }
      }
    } catch (e) {
      return { commandId: '', ok: false, error: String(e) }
    }
  }

  async run(
    action: string,
    args: Record<string, unknown>,
    meta: { sessionId?: string; commandId?: string; tabId?: number },
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    if (SW_LEVEL.has(action)) {
      const r = await this.swLevel(action, args)

      return { ok: r.ok, result: r.result, error: r.error }
    }

    let tabId: number

    try {
      tabId = meta.tabId ?? (await this.targetTab())
    } catch (e) {
      return { ok: false, error: String(e) }
    }

    const commandId = meta.commandId ?? rid()

    const exec = async (): Promise<PageActionResult> => {
      const request: PageActionRequest = { commandId, action, arguments: args }

      const done = new Promise<PageActionResult>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(commandId)
          resolve({ commandId, ok: false, error: 'action timed out' })
        }, TIMEOUT_MS)

        this.pending.set(commandId, { resolve, timer })
      })

      try {
        await chrome.tabs.sendMessage(tabId, { type: 'action', request })
      } catch (e) {
        const p = this.pending.get(commandId)

        if (p) {
          clearTimeout(p.timer)
          this.pending.delete(commandId)
        }

        return { commandId, ok: false, error: `no overlay on tab ${tabId}: ${String(e)}` }
      }

      return done
    }

    if (!MUTATING.has(action)) {return exec()}

    // Serialize mutating actions per tab.
    const tail = this.tails.get(tabId) ?? Promise.resolve()
    const next = tail.then(exec, exec)
    this.tails.set(
      tabId,
      next.catch(() => undefined),
    )

    return next
  }
}
