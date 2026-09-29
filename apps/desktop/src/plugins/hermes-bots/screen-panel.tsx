/**
 * Computer panel — the screen hero graduated into a docked control surface.
 * Sits at the top of the bot's Routines pane (already docked beside the bot's
 * chat tiles), so the computer lives next to the conversation it belongs to.
 *
 * Everything here is presentation over the existing `display.*` plumbing: the
 * frame polls `display.thumbnail` (shared `useLiveThumbnail`), the status chip
 * reads `portalTone`, take over / hand back mint a viewer through
 * `display.observe` + `display.lease.*` exactly like the Screen pane does, and
 * the frame itself still opens the full pane for real keyboard/mouse control.
 */

import { Button, Codicon, GlyphSpinner, host, Tip, useValue } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { botSelectionKey } from './data'
import { useBots } from './i18n'
import {
  acquireScreenLease,
  canOpenBotWorkdir,
  copyBotScreenshot,
  openBotWorkdir,
  releaseScreenLease,
  restartBotScreen
} from './screen-actions'
import { displayRequest, type DisplayThumbnail, leaseHeldBy } from './screen-connection'
import { openBotScreen } from './screen-open'
import { type PortalTone, useScreenPortalState } from './screen-portal'
import { $screenState, screenStateFor } from './screen-state'
import type { BotMeta, RosterRow } from './types'

const REFRESH_MS = 4000
const STALE_AFTER = 3

/** Poll `display.thumbnail` while the screen runs: IntersectionObserver- and
 *  `document.hidden`-gated, and a suppressed answer (a human holds the screen)
 *  never ages into "stale". Owned by the panel — the only live-frame consumer
 *  since the hero graduated into it. */
export function useLiveThumbnail(bot: RosterRow, running: boolean) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  // Consecutive failed refreshes; past STALE_AFTER the frame is shown dimmed as "last seen" so a
  // dead gateway never keeps looking live. Success resets it.
  const [misses, setMisses] = useState(0)
  // The backend withholds frames while a human holds the screen; that is a
  // deliberate answer, not a failed refresh, so it never ages into "stale".
  const [suppressed, setSuppressed] = useState(false)
  const boxRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!running) {
      setDataUrl(null)
      setMisses(0)
      setSuppressed(false)

      return
    }

    let cancelled = false
    let timer: number | null = null
    let visible = true

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(entries => {
            visible = entries.some(entry => entry.isIntersecting)
          })

    if (observer && boxRef.current) {
      observer.observe(boxRef.current)
    }

    const tick = () => {
      if (cancelled) {
        return
      }

      if (!visible || document.hidden) {
        timer = window.setTimeout(tick, REFRESH_MS)

        return
      }

      void displayRequest<DisplayThumbnail>(bot, 'display.thumbnail')
        .then(result => {
          if (!cancelled) {
            setDataUrl(result.data_url ?? null)
            setSuppressed(result.suppressed === 'human_has_control')
            setMisses(0)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setMisses(prev => prev + 1) // the last good frame stays up, marked stale past STALE_AFTER
          }
        })
        .finally(() => {
          if (!cancelled) {
            timer = window.setTimeout(tick, REFRESH_MS)
          }
        })
    }

    tick()

    return () => {
      cancelled = true
      observer?.disconnect()

      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [bot, running])

  return { dataUrl, boxRef, stale: misses >= STALE_AFTER, suppressed }
}

const MIN_FRAME_HEIGHT = 120
const MAX_FRAME_HEIGHT = 480
const DEFAULT_FRAME_HEIGHT = 170

/** Module-level so the height survives bot switches and pane remounts. */
let frameHeight = DEFAULT_FRAME_HEIGHT

const CHIP_CLASS: Record<PortalTone, string> = {
  live: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  human: 'bg-red-500/15 text-red-600 dark:text-red-400',
  other: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  off: 'bg-muted text-muted-foreground',
  missing: 'bg-muted text-muted-foreground',
  unsupported: 'bg-muted text-muted-foreground',
  unavailable: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground'
}

export function BotComputerPanel({ bot, meta }: { bot: RosterRow; meta?: BotMeta | null }) {
  // A profile switch must discard the previous owner's pixels before painting.
  return <ComputerPanelContent bot={bot} key={botSelectionKey(bot)} meta={meta} />
}

function ComputerPanelContent({ bot, meta }: { bot: RosterRow; meta?: BotMeta | null }) {
  const t = useBots()
  const { lease, tone } = useScreenPortalState(bot)
  const running = tone === 'live' || tone === 'human' || tone === 'other'
  const { dataUrl, boxRef, stale, suppressed } = useLiveThumbnail(bot, running)
  const viewer = screenStateFor(useValue($screenState), bot)?.viewer ?? null
  const iHold = leaseHeldBy(lease, viewer)
  const humanOther = lease?.holder === 'human' && !iHold

  const [height, setHeight] = useState(frameHeight)
  const [busy, setBusy] = useState<string | null>(null)

  const chip = {
    live: t.screen.portalWatching,
    human: t.screen.portalYouControl,
    other: t.screen.portalOtherControls,
    off: t.screen.portalStopped,
    missing: t.screen.portalNotInstalled,
    unsupported: t.screen.portalUnsupported,
    unavailable: t.screen.portalUnavailable,
    unknown: t.screen.heroConnecting
  }[tone]

  // The frame's accessible name carries the suppressed/stale truth (like the hero's did),
  // so the status chip is the fallback rather than the other way around.
  const caption = suppressed ? t.screen.heroSuppressed : stale ? t.screen.heroStale : ''

  const act = (key: string, work: () => Promise<unknown>, fallback: string) => {
    if (busy) {
      return
    }

    setBusy(key)
    void work()
      .catch(error => host.notifyError(error, fallback))
      .finally(() => setBusy(current => (current === key ? null : current)))
  }

  // Take over lands the lease AND opens the full pane: control without the RFB
  // stream is blind (the thumbnail is suppressed while a human holds the lease),
  // so the one-click path goes straight to the surface that can drive.
  const takeOver = () =>
    act(
      'takeover',
      async () => {
        await acquireScreenLease(bot)
        openBotScreen(bot, meta ?? null)
      },
      t.screen.takeOver
    )

  const handBack = (force = false) => act('handback', () => releaseScreenLease(bot, force), t.screen.handBack)

  const copyShot = () =>
    act(
      'copy',
      async () => {
        await copyBotScreenshot(bot)
        host.notify({ kind: 'success', message: t.screen.screenshotCopied })
      },
      t.screen.screenshotFailed
    )

  const restart = () => act('restart', () => restartBotScreen(bot), t.screen.restartFailed)

  const openWorkdir = () =>
    act(
      'workdir',
      async () => {
        const opened = await openBotWorkdir(bot)

        if (!opened) {
          host.notify({ kind: 'error', message: t.screen.workdirUnavailable })
        }
      },
      t.screen.workdirFailed
    )

  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startHeight = height
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)

    const onMove = (move: globalThis.PointerEvent) => {
      const next = Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, startHeight + move.clientY - startY))
      frameHeight = next
      setHeight(next)
    }

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  const unsupported = tone === 'unsupported' || tone === 'unavailable'

  return (
    <section
      aria-label={t.screen.panelTitle}
      className="overflow-hidden rounded-lg border border-(--ui-stroke-secondary)"
    >
      <div className="flex items-center gap-1.5 border-b border-(--ui-stroke-secondary) px-2 py-1">
        <Codicon className="text-(--ui-text-tertiary)" name="device-desktop" size="0.8rem" />
        <span className="text-[0.65rem] font-medium text-(--ui-text-secondary)">{t.screen.panelTitle}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-medium ${CHIP_CLASS[tone]}`}>{chip}</span>
        <span className="grow" />
        <Tip label={t.screen.openFullPane}>
          <Button
            aria-label={t.screen.openFullPane}
            disabled={unsupported}
            onClick={() => openBotScreen(bot, meta ?? null)}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="screen-full" />
          </Button>
        </Tip>
        <Tip label={t.screen.copyScreenshot}>
          <Button
            aria-label={t.screen.copyScreenshot}
            disabled={unsupported || !running || busy !== null}
            onClick={copyShot}
            size="icon-xs"
            variant="ghost"
          >
            {busy === 'copy' ? <GlyphSpinner /> : <Codicon name="copy" />}
          </Button>
        </Tip>
        <Tip label={t.screen.restartScreen}>
          <Button
            aria-label={t.screen.restartScreen}
            disabled={unsupported || tone === 'missing' || busy !== null}
            onClick={restart}
            size="icon-xs"
            variant="ghost"
          >
            {busy === 'restart' ? <GlyphSpinner /> : <Codicon name="debug-restart" />}
          </Button>
        </Tip>
        {canOpenBotWorkdir(bot) ? (
          <Tip label={t.screen.openWorkdir}>
            <Button
              aria-label={t.screen.openWorkdir}
              disabled={busy !== null}
              onClick={openWorkdir}
              size="icon-xs"
              variant="ghost"
            >
              {busy === 'workdir' ? <GlyphSpinner /> : <Codicon name="folder-opened" />}
            </Button>
          </Tip>
        ) : null}
      </div>

      {!unsupported ? (
        <>
          <div className="relative bg-black" style={{ height }}>
            <button
              aria-label={`${t.screen.portalTitle}: ${caption || chip}`}
              className={`absolute inset-0 block size-full overflow-hidden text-left ${tone === 'human' ? 'ring-2 ring-inset ring-red-500/80' : tone === 'other' ? 'ring-2 ring-inset ring-amber-500/70' : ''}`}
              onClick={() => openBotScreen(bot, meta ?? null)}
              ref={boxRef}
              type="button"
            >
              {dataUrl ? (
                <img
                  alt=""
                  className={
                    stale
                      ? 'absolute inset-0 size-full object-cover opacity-40 grayscale'
                      : 'absolute inset-0 size-full object-cover'
                  }
                  draggable={false}
                  src={dataUrl}
                />
              ) : (
                <span className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08),transparent_70%)]">
                  <Codicon
                    className="text-[2.25rem] text-white/30"
                    name={running ? 'loading' : tone === 'missing' ? 'cloud-download' : 'vm'}
                  />
                </span>
              )}
            </button>
            {caption ? (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-black/0 px-2.5 pb-1.5 pt-4 text-[0.65rem] text-white/70">
                {caption}
              </span>
            ) : null}
          </div>
          <div
            aria-label={t.screen.resizePanel}
            className="h-1.5 cursor-ns-resize bg-(--chrome-action-hover)/40 transition-colors hover:bg-(--chrome-action-hover)"
            onPointerDown={onDragStart}
            role="separator"
          />
          <div className="flex items-center gap-2 border-t border-(--ui-stroke-secondary) px-2 py-1.5">
            {iHold ? (
              <Button disabled={busy !== null} onClick={() => handBack()} size="sm" variant="secondary">
                {busy === 'handback' ? <GlyphSpinner /> : <Codicon name="debug-continue" />} {t.screen.handBack}
              </Button>
            ) : (
              <>
                {humanOther ? (
                  <Tip label={t.screen.handBackForceHint}>
                    <Button disabled={busy !== null} onClick={() => handBack(true)} size="sm" variant="secondary">
                      <Codicon name="debug-continue" /> {t.screen.handBackForce}
                    </Button>
                  </Tip>
                ) : null}
                <Button disabled={busy !== null || !running} onClick={takeOver} size="sm">
                  {busy === 'takeover' ? <GlyphSpinner /> : <Codicon name="record-keys" />} {t.screen.takeOver}
                </Button>
              </>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
