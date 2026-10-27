/**
 * Hermes Browser state: one surface, three kinds of tab.
 *
 *   web       the user's own browsing (address bar, history, framed or gateway view)
 *   bot       a bot's live screen, the existing Screen pane with Take over / Hand back
 *   activity  what a bot's browser tool is doing, fed by its tool card in the chat
 *
 * Plain nanostores so the tool cards, the chat link interception and the
 * browser workspace all speak to one place.
 */

import { atom } from 'nanostores'

import type { BrowserBackend } from '../browser-backend'
import type { BotMeta, RosterRow } from '../types'

/** How a web tab is currently showing its page. */
export type WebMode =
  | 'blocked' // the site refuses frames: offer the gateway view or a new tab
  | 'checking' // asking the gateway about the page
  | 'frame' // in an iframe, straight from the viewer's browser
  | 'idle' // new tab, nothing loaded
  | 'remote' // rendered by the gateway's browser and streamed as frames
  | 'unreachable' // neither the viewer nor the gateway can reach it

export interface WebTab {
  id: string
  kind: 'web'
  /** The address shown in the bar. */
  url: string
  title: string
  /** The address the current load asked for. */
  target: string
  /** Bumped by every navigation (including reload) so views reload even for the same URL. */
  nav: number
  history: string[]
  index: number
  mode: WebMode
  loading: boolean
  /** Why it is blocked or unreachable ('csp', 'x-frame-options', 'unreachable', an error text). */
  reason?: string
  /** Gateway view history, when the page is rendered there. */
  remoteBack?: boolean
  remoteForward?: boolean
  /** The user asked for the gateway view for this page. */
  preferRemote?: boolean
}

export interface BotTab {
  id: string
  kind: 'bot'
  key: string
  bot: RosterRow
  meta: BotMeta | null
  title: string
}

export interface ActivityTab {
  id: string
  kind: 'activity'
  /** The tool card group key it follows. */
  key: string
  title: string
  /** A chosen step, or null to follow the latest. */
  step: null | number
}

export type BrowserTab = ActivityTab | BotTab | WebTab

export interface ActivityStep {
  tool: string
  status: string
  state: string
  url: string
  shot: string
}

/** What a bot's browser tool card last showed, keyed by the card group. */
export interface ActivitySnapshot {
  key: string
  botName: string
  running: boolean
  steps: ActivityStep[]
  sessionId: null | string
  runtimeId: null | string
  /** The bot doing the browsing, when known, and whether its browser draws on its screen. */
  bot: null | RosterRow
  onDesktop: boolean
  /** Where its browser runs: `elsewhere` (a cloud browser) can be watched, not taken over. */
  backend: BrowserBackend
}

export const $tabs = atom<BrowserTab[]>([])
export const $activeTab = atom<null | string>(null)
export const $activity = atom<Record<string, ActivitySnapshot>>({})

let nextId = 1

export function newTabId(kind: BrowserTab['kind']): string {
  return `${kind}-${Date.now().toString(36)}-${nextId++}`
}

export function getTab(id: null | string): BrowserTab | undefined {
  return id ? $tabs.get().find(tab => tab.id === id) : undefined
}

export function addTab(tab: BrowserTab, activate = true): void {
  $tabs.set([...$tabs.get(), tab])

  if (activate || !$activeTab.get()) {
    $activeTab.set(tab.id)
  }
}

export function patchTab<T extends BrowserTab>(id: string, patch: Partial<T>): void {
  $tabs.set($tabs.get().map(tab => (tab.id === id ? ({ ...tab, ...patch } as BrowserTab) : tab)))
}

/** Close a tab and activate its neighbour, as browsers do. Returns the closed tab. */
export function removeTab(id: string): BrowserTab | undefined {
  const tabs = $tabs.get()
  const index = tabs.findIndex(tab => tab.id === id)

  if (index < 0) {
    return undefined
  }

  const closed = tabs[index]
  const rest = tabs.filter(tab => tab.id !== id)
  $tabs.set(rest)

  if ($activeTab.get() === id) {
    $activeTab.set(rest[Math.min(index, rest.length - 1)]?.id ?? null)
  }

  return closed
}

export function blankWebTab(url = ''): WebTab {
  return {
    id: newTabId('web'),
    kind: 'web',
    url,
    title: '',
    target: url,
    nav: url ? 1 : 0,
    history: url ? [url] : [],
    index: url ? 0 : -1,
    mode: url ? 'checking' : 'idle',
    loading: Boolean(url)
  }
}

/** Load `url` in a web tab, pushing it on the tab's history. */
export function navigateTab(id: string, url: string): void {
  const tab = getTab(id)

  if (!tab || tab.kind !== 'web') {
    return
  }

  const history = [...tab.history.slice(0, tab.index + 1), url]
  patchTab<WebTab>(id, {
    url,
    target: url,
    title: '',
    nav: tab.nav + 1,
    history,
    index: history.length - 1,
    mode: 'checking',
    loading: true,
    reason: undefined,
    preferRemote: false
  })
}

export function stepHistory(id: string, delta: -1 | 1): void {
  const tab = getTab(id)

  if (!tab || tab.kind !== 'web') {
    return
  }

  const index = tab.index + delta

  if (index < 0 || index >= tab.history.length) {
    return
  }

  const url = tab.history[index]
  patchTab<WebTab>(id, { url, target: url, title: '', index, nav: tab.nav + 1, mode: 'checking', loading: true, reason: undefined })
}

export function reloadTab(id: string): void {
  const tab = getTab(id)

  if (tab?.kind === 'web' && tab.target) {
    patchTab<WebTab>(id, { nav: tab.nav + 1, loading: true })
  }
}

export function publishActivity(snapshot: ActivitySnapshot): void {
  const all = $activity.get()
  const prev = all[snapshot.key]

  if (prev && activitySignature(prev) === activitySignature(snapshot)) {
    return
  }

  $activity.set({ ...all, [snapshot.key]: snapshot })
}

function activitySignature(s: ActivitySnapshot): string {
  return `${s.running}|${s.botName}|${s.onDesktop}|${s.backend}|${s.bot ? 1 : 0}|${s.steps.map(step => `${step.state}:${step.status}:${step.url}:${step.shot.slice(-48)}`).join(',')}`
}

const LINKS_KEY = 'hermes-bots-plus.browser.links'

function readLinksHere(): boolean {
  try {
    return globalThis.localStorage?.getItem(LINKS_KEY) !== 'system'
  } catch {
    return true
  }
}

/** Chat links open in the Hermes Browser (true) or the user's own browser. */
export const $linksHere = atom<boolean>(readLinksHere())

export function setLinksHere(value: boolean): void {
  $linksHere.set(value)

  try {
    globalThis.localStorage?.setItem(LINKS_KEY, value ? 'here' : 'system')
  } catch {
    // private mode: keep it for this session
  }
}

/** Commands for a tab whose page is rendered by the gateway (its own history). */
const remoteCommands = new Map<string, (kind: 'back' | 'forward' | 'reload') => void>()

export function setRemoteCommand(id: string, run: ((kind: 'back' | 'forward' | 'reload') => void) | null): void {
  if (run) {
    remoteCommands.set(id, run)
  } else {
    remoteCommands.delete(id)
  }
}

export function remoteCommand(id: string, kind: 'back' | 'forward' | 'reload'): boolean {
  const run = remoteCommands.get(id)
  run?.(kind)

  return Boolean(run)
}
