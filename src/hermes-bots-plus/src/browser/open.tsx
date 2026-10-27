/**
 * The Hermes Browser workspace: one main-window tab that holds the user's web
 * tabs, the bots' live screens and their browsing activity. Everything that
 * used to open a page somewhere else (the preview row, chat links, "Open page"
 * on a tool card, a bot's Screen) lands here.
 */

import * as sdk from '@hermes/plugin-sdk'
import { host } from '@hermes/plugin-sdk'

import { botSelectionKey } from '../data'
import { displayName } from '../labels'
import { noteScreenTabClosed, noteScreenTabOpened } from '../screen-autoraise'
import { getPluginCtx, ID } from '../shared'
import type { BotMeta, RosterRow } from '../types'

import { dropView } from './api'
import { browserText } from './browser-i18n'
import {
  $activeTab,
  $tabs,
  addTab,
  blankWebTab,
  type BotTab,
  type BrowserTab,
  getTab,
  navigateTab,
  newTabId,
  patchTab,
  removeTab
} from './store'
import { isWebUrl } from './url'
import {
  $floatGeometry,
  $surface,
  type DockSide,
  floatMounted,
  floatUnavailableText,
  mountFloat,
  patchGeometry,
  setSurface,
  unmountFloat
} from './float'
import { BrowserWorkspace } from './workspace'

export const BROWSER_WORKSPACE = `${ID}:browser`
export const BROWSER_PANE = `plugin-workspace:${BROWSER_WORKSPACE}`
/** The docked browser: a pane of its own with a declared width, so the pane
 *  shell treats it like a sidebar. Its width is the shell's per-pane width
 *  override (written by the shell's own splitter, saved with the layout), so a
 *  docked browser comes back at the size you left it, across reloads. */
/** The host scopes a plugin's registrations as `<plugin id>:<id>` (plugin id: plugin.tsx). */
export const BROWSER_DOCK_PANE = 'hermes-bots-plus:browser-dock'
const DOCK_WIDTH = '30rem'

let closeWorkspace: (() => void) | null = null
let closeDock: (() => void) | null = null
let dockSide: DockSide | null = null
/** Set while the tab closes only to move the browser to another surface. */
let moving = false

export function browserAvailable(): boolean {
  return typeof host.openWorkspace === 'function'
}

export function browserOpen(): boolean {
  return closeWorkspace !== null || closeDock !== null || floatMounted()
}

/** Seed the docked pane's width through the shell's own store, when this
 *  Hermes exports it; otherwise the shell's default width applies until the
 *  user drags the splitter (which the shell then remembers itself). */
function seedDockWidth(width: number | undefined) {
  const setWidth = (sdk as { setPaneWidthOverride?: (id: string, width: number | undefined) => void }).setPaneWidthOverride

  if (width && typeof setWidth === 'function') {
    setWidth(BROWSER_DOCK_PANE, Math.round(width))
  }
}

/** Leave whichever tiled surface (tab or dock) holds the browser now, keeping its tabs. */
function leaveTiled() {
  moving = true

  try {
    closeWorkspace?.()
    closeDock?.()
  } finally {
    moving = false
  }

  closeWorkspace = null
  closeDock = null
  dockSide = null
}

/** Screens stream only while watched: closing the browser stops them. Web and
 *  activity tabs stay for the next open, like a restored window. */
function forgetLiveTabs() {
  for (const tab of $tabs.get()) {
    if (tab.kind === 'bot') {
      noteScreenTabClosed(tab.bot)
    } else if (tab.kind === 'web' && tab.mode === 'remote') {
      dropView(tab.id)
    }
  }

  const kept = $tabs.get().filter(tab => tab.kind !== 'bot')
  $tabs.set(kept)

  if (!kept.some(tab => tab.id === $activeTab.get())) {
    $activeTab.set(kept[kept.length - 1]?.id ?? null)
  }
}

function ensureTab() {
  if (!$tabs.get().length) {
    addTab(blankWebTab())
  }
}

const floatProps = { onClose: closeFloatingBrowser, onDock: (side: DockSide, width?: number) => dockBrowser(side, width), onToTab: browserToTab }

function showFloating(): boolean {
  ensureTab()

  if ($floatGeometry.get().min) {
    patchGeometry({ min: false })
  }

  if (!floatMounted()) {
    void mountFloat(floatProps).then(ok => {
      if (!ok) {
        setSurface('tab')
        host.notify({ kind: 'info', message: floatUnavailableText() })
        showBrowser()
      }
    })
  }

  return true
}

/** Move the browser (and its tabs, unchanged) into the floating window. */
export function floatBrowser(): void {
  leaveTiled()
  setSurface('float')
  showFloating()
}

/** Floating window → back into a workspace tab. */
export function browserToTab(): void {
  unmountFloat()
  leaveTiled()
  setSurface('tab')
  showBrowser()
}

/** Dock the browser to a side of the main window (a pane, not an overlay). */
export function dockBrowser(side: DockSide, width?: number): void {
  if (dockSide === side && closeDock) {
    host.revealPane(BROWSER_DOCK_PANE)

    return
  }

  unmountFloat()
  leaveTiled()
  setSurface(side)
  seedDockWidth(width)
  showBrowser()
}

/** Close the browser wherever it is (the docked pane's own close button). */
export function closeBrowser(): void {
  closeWorkspace?.()
  closeDock?.()
  closeWorkspace = null
  closeDock = null
  dockSide = null
  closeFloatingBrowser()
}

function openDock(side: DockSide): boolean {
  const ctx = getPluginCtx()

  if (!ctx?.register) {
    return false
  }

  ensureTab()

  const dispose = ctx.register({
    area: 'panes',
    // The host scopes this to BROWSER_DOCK_PANE.
    id: 'browser-dock',
    title: browserText().title,
    render: () => <BrowserWorkspace docked={side} />,
    data: {
      dock: { pane: 'workspace', pos: side },
      placement: side,
      width: DOCK_WIDTH,
      minWidth: '22rem',
      maxWidth: '70vw',
      // Closing goes through the browser's own close button, which also stops
      // live screens; a stray tab-menu Close would leave them streaming.
      uncloseable: true
    }
  })

  closeDock = () => {
    dispose()

    if (!moving) {
      forgetLiveTabs()
    }
  }
  dockSide = side
  host.revealPane(BROWSER_DOCK_PANE)

  return true
}

export function closeFloatingBrowser(): void {
  unmountFloat()
  forgetLiveTabs()
  setSurface('tab')
}

/** The keyboard toggle: float the browser, or minimise / restore the window. */
export function toggleFloatingBrowser(): void {
  if ($surface.get() !== 'float' || !floatMounted()) {
    floatBrowser()

    return
  }

  patchGeometry({ min: !$floatGeometry.get().min })
}

/** Show the browser, opening its workspace tab (or floating window) the first time. */
export function showBrowser(): boolean {
  const surface = $surface.get()

  if (surface === 'float' && browserAvailable()) {
    return showFloating()
  }

  if ((surface === 'left' || surface === 'right') && browserAvailable()) {
    if (closeDock && dockSide === surface) {
      host.revealPane(BROWSER_DOCK_PANE)

      return true
    }

    if (openDock(surface)) {
      return true
    }

    setSurface('tab')
  }

  if (closeWorkspace) {
    host.revealPane(BROWSER_PANE)

    return true
  }

  if (!browserAvailable()) {
    host.notify({ kind: 'info', message: browserText().needsUpdate })

    return false
  }

  ensureTab()

  closeWorkspace = host.openWorkspace(BROWSER_WORKSPACE, {
    title: browserText().title,
    minWidth: '24rem',
    render: () => <BrowserWorkspace />,
    onClose: () => {
      closeWorkspace = null

      if (!moving) {
        forgetLiveTabs()
      }
    }
  })

  return true
}

export function toggleBrowser(): void {
  showBrowser()
}

/** Open `url` in the browser: reuse a blank tab or the tab already on that
 *  page, otherwise open a new tab. Returns false for a non-web URL. */
export function openInBrowser(url: string, options: { background?: boolean } = {}): boolean {
  if (!isWebUrl(url)) {
    return false
  }

  if (!showBrowser()) {
    return false
  }

  const tabs = $tabs.get()
  const same = tabs.find(tab => tab.kind === 'web' && (tab.url === url || tab.target === url))

  if (same) {
    $activeTab.set(same.id)

    return true
  }

  const active = getTab($activeTab.get())

  if (active?.kind === 'web' && !active.target) {
    navigateTab(active.id, url)

    return true
  }

  addTab(blankWebTab(url), !options.background)

  return true
}

export function newBrowserTab(): void {
  if (showBrowser()) {
    addTab(blankWebTab())
  }
}

/** A bot's live screen as a browser tab (Take over / Hand back live there). */
export function openBotInBrowser(bot: RosterRow, meta?: BotMeta | null): void {
  if (!showBrowser()) {
    return
  }

  const key = botSelectionKey(bot)
  const existing = $tabs.get().find(tab => tab.kind === 'bot' && tab.key === key)

  if (existing) {
    patchTab<BotTab>(existing.id, { bot, meta: meta ?? null })
    $activeTab.set(existing.id)

    return
  }

  addTab({
    id: newTabId('bot'),
    kind: 'bot',
    key,
    bot,
    meta: meta ?? null,
    title: browserText().botTab(displayName(bot, meta ?? null))
  })
  noteScreenTabOpened(bot)
}

export function botScreenOpen(bot: RosterRow): boolean {
  const key = botSelectionKey(bot)

  return browserOpen() && $tabs.get().some(tab => tab.kind === 'bot' && tab.key === key)
}

/** Follow a bot's browsing (its tool card group) in a tab. */
export function openActivityInBrowser(key: string, title: string, step: null | number = null): void {
  if (!showBrowser()) {
    return
  }

  const existing = $tabs.get().find(tab => tab.kind === 'activity' && tab.key === key)

  if (existing) {
    patchTab(existing.id, { step })
    $activeTab.set(existing.id)

    return
  }

  addTab({ id: newTabId('activity'), kind: 'activity', key, title, step })
}

export function closeBrowserTab(id: string): void {
  const closed: BrowserTab | undefined = removeTab(id)

  if (closed?.kind === 'bot') {
    noteScreenTabClosed(closed.bot)
  } else if (closed?.kind === 'web') {
    dropView(closed.id)
  }

  if (!$tabs.get().length) {
    addTab(blankWebTab())
  }
}

/** Plugin teardown: close the workspace and forget every tab. */
export function disposeBrowser(): void {
  closeWorkspace?.()
  closeDock?.()
  closeWorkspace = null
  closeDock = null
  dockSide = null
  unmountFloat()
  $tabs.set([])
  $activeTab.set(null)
}
