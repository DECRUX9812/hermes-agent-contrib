/** The browser's backend calls, all on this plugin's own dashboard API
 *  (`/api/plugins/hermes-bots-plus/browser/...`). */

import { getPluginCtx } from '../shared'

export interface ProbeResult {
  url: string
  loopback: boolean
  reachable: boolean
  status?: number
  finalUrl?: string
  embeddable?: boolean | null
  reason?: string
  title?: string
}

export type ViewAction =
  | { kind: 'back' | 'forward' | 'reload' }
  | { kind: 'click'; x: number; y: number }
  | { kind: 'key'; key: string }
  | { kind: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { kind: 'type'; text: string }

export interface ViewFrame {
  image: null | string
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  width: number
  height: number
  error: null | string
}

function rest() {
  const ctx = getPluginCtx()

  if (!ctx?.rest) {
    throw new Error('plugin api unavailable')
  }

  return ctx.rest
}

export function probePage(url: string): Promise<ProbeResult> {
  const origin = typeof location === 'undefined' ? '' : location.origin
  const query = `url=${encodeURIComponent(url)}&origin=${encodeURIComponent(origin)}`

  return rest()<ProbeResult>(`/browser/probe?${query}`, { timeoutMs: 8000 })
}

export function viewPage(body: {
  tab: string
  url?: string
  action?: ViewAction
  width: number
  height: number
}): Promise<ViewFrame> {
  return rest()<ViewFrame>('/browser/view', { method: 'POST', body, timeoutMs: 30000 })
}

export function dropView(tab: string): void {
  try {
    void rest()(`/browser/view/${encodeURIComponent(tab)}`, { method: 'DELETE', timeoutMs: 5000 }).catch(() => undefined)
  } catch {
    // no backend: nothing to drop
  }
}

/** Can this browser reach `url` itself? An opaque no-cors answer means yes. */
export async function reachableHere(url: string, timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: controller.signal })

    return true
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

export type BrowserMode = 'cloud' | 'local' | 'other'

export interface BrowserModeInfo {
  profile: string
  mode: BrowserMode
  provider: string
  headed: boolean
}

export interface BrowserModeChange extends BrowserModeInfo {
  backup: string
}

/** Where a local profile's browser tool runs (read from that profile's config). */
export function getBrowserMode(profile: string): Promise<BrowserModeInfo> {
  return rest()<BrowserModeInfo>(`/browser/mode/${encodeURIComponent(profile)}`, { timeoutMs: 8000 })
}

/** Switch a local profile between its cloud browser and a local headed one.
 *  The server backs the config up before it writes. */
export function setBrowserMode(profile: string, mode: 'cloud' | 'local'): Promise<BrowserModeChange> {
  return rest()<BrowserModeChange>('/browser/mode', { method: 'POST', body: { profile, mode }, timeoutMs: 15000 })
}
