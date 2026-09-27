/**
 * Bot Screen panel actions — lease control, restart, clipboard copy and the
 * bot's workdir, all driven through the existing `display.*` / `config.*` RPCs
 * and the desktop's own window bridge. No new backend surface: the panel is a
 * presentation layer over the same calls the full Screen pane makes.
 */

import { requestForBot, resolveBotConnectionRoute } from './routing'
import { botCanonicalSessionId } from './row-helpers'
import {
  type DisplayLease,
  type DisplayObserveResult,
  displayRequest,
  type DisplayStatus,
  type DisplayThumbnail,
  type ScreenViewer,
  viewerHash
} from './screen-connection'
import {
  $screenState,
  screenStateFor,
  setScreenLease,
  setScreenStatus,
  setScreenViewer
} from './screen-state'
import type { RosterRow } from './types'

/** Mint (or reuse) this window's viewer id for `bot`. The lease names its holder by
 *  hash, so taking over from the panel needs the same server-minted identity the
 *  pane presents on attach — minted here through `display.observe`, whose single-use
 *  stream ticket we deliberately never spend (it expires unused). */
export async function ensureScreenViewer(bot: RosterRow): Promise<ScreenViewer> {
  const existing = screenStateFor($screenState.get(), bot)?.viewer ?? null

  if (existing) {
    return existing
  }

  const observe = await displayRequest<DisplayObserveResult>(bot, 'display.observe', {})
  const viewer: ScreenViewer = { id: observe.viewer_id, hash: await viewerHash(observe.viewer_id) }
  setScreenStatus(bot, observe)
  setScreenViewer(bot, viewer)

  return viewer
}

/** Grab the human lease for `bot`. Unlike the pane's version this mints a viewer on
 *  demand — the panel has no RFB attach to mint one as a side effect. */
export async function acquireScreenLease(bot: RosterRow): Promise<DisplayLease> {
  const viewer = await ensureScreenViewer(bot)

  const result = await displayRequest<{ lease: DisplayLease }>(bot, 'display.lease.acquire', {
    viewer_id: viewer.id
  })

  setScreenLease(bot, result.lease)

  return result.lease
}

/** Release control. `force` drops a lease this window no longer owns (a reload minted
 *  a fresh viewer id while the old one still held), same escape hatch as the pane. */
export async function releaseScreenLease(bot: RosterRow, force = false): Promise<void> {
  const viewer = screenStateFor($screenState.get(), bot)?.viewer ?? null

  const result = await displayRequest<{ lease: DisplayLease }>(
    bot,
    'display.lease.release',
    force ? { force: true } : { viewer_id: viewer?.id }
  )

  setScreenLease(bot, result.lease)
}

/** Bounce the screen session. `force` lets restart succeed even while a human lease
 *  is held — a deliberate reset, not something a held lease should veto silently. */
export async function restartBotScreen(bot: RosterRow): Promise<DisplayStatus> {
  await displayRequest(bot, 'display.stop', { force: true }).catch(() => undefined)
  const next = await displayRequest<DisplayStatus>(bot, 'display.start')
  setScreenStatus(bot, next)

  return next
}

/** JPEG data URL → PNG blob, via canvas. The thumbnail ships JPEG but clipboard
 *  image writes are only dependable as PNG. */
async function frameDataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Could not decode the screen frame'))
    image.src = dataUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas is unavailable')
  }

  context.drawImage(image, 0, 0)

  return await new Promise((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not encode the screen frame'))), 'image/png')
  )
}

/** Copy the bot's latest frame to the clipboard. Never writes an empty entry:
 *  a suppressed or absent frame rejects instead of clearing the clipboard. */
export async function copyBotScreenshot(bot: RosterRow): Promise<void> {
  const shot = await displayRequest<DisplayThumbnail>(bot, 'display.thumbnail')
  const dataUrl = shot?.data_url

  if (!dataUrl) {
    throw new Error('No screen frame to copy')
  }

  const blob = await frameDataUrlToPngBlob(dataUrl)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

/** The workdir affordance opens the user's own terminal / file manager on this
 *  machine, so it only exists for bots whose host IS this machine — the same
 *  local-only rule the session actions menu applies to remote connections. */
export function canOpenBotWorkdir(bot: RosterRow | null | undefined): boolean {
  if (!bot || bot.remoteSource === true || resolveBotConnectionRoute(bot).route?.mode === 'remote') {
    return false
  }

  const bridge = window.hermesDesktop

  return (
    typeof bridge?.openSessionInTerminal === 'function' ||
    typeof bridge?.revealPath === 'function' ||
    typeof bridge?.openDir === 'function'
  )
}

/** Open the bot's workdir. The existing session affordance is "Open in Terminal"
 *  (a user terminal at the session's cwd): use it when the canonical chat exists —
 *  it is read server-side by title, so this never invents or stores a session id.
 *  Without a chat yet, or without the terminal bridge, fall back to revealing the
 *  profile's project directory (`config.get 'project'` → terminal.cwd). */
export async function openBotWorkdir(bot: RosterRow): Promise<boolean> {
  const bridge = window.hermesDesktop

  const project = await requestForBot<{ cwd?: null | string }>(bot, 'config.get', { key: 'project' }).catch(
    () => null
  )

  const cwd = project?.cwd?.trim() || undefined
  const sessionId = botCanonicalSessionId(bot)

  if (sessionId && typeof bridge?.openSessionInTerminal === 'function') {
    const result = await bridge.openSessionInTerminal(sessionId, { cwd, profile: bot.name }).catch(() => null)

    if (result?.ok) {
      return true
    }
  }

  if (cwd && typeof bridge?.revealPath === 'function') {
    if (await bridge.revealPath(cwd).catch(() => false)) {
      return true
    }
  }

  if (cwd && typeof bridge?.openDir === 'function') {
    const result = await bridge.openDir(cwd).catch(() => null)

    return result?.ok === true
  }

  return false
}
