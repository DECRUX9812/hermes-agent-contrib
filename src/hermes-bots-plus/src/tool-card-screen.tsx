/**
 * The real screen inside a running browser card.
 *
 * A Bot Chat's local browser draws on the bot's own desktop whenever that
 * desktop is up, so a running browser card can watch the actual screen
 * instead of the newest screenshot. The stream here is watch-only: no lease,
 * no input, no viewer id kept in the shared screen store (that identity
 * belongs to the Screen tab). Anything short of a painted stream leaves the
 * screenshot frame underneath in charge.
 */

import { Codicon } from '@hermes/plugin-sdk'
import { type JSX, useEffect, useRef, useState } from 'react'

import { displayRequest, type DisplayObserveResult, resolveScreenWsUrl, retainBotScreen } from './screen-connection'
import { openBotScreen } from './screen-open'
import { loadRfb } from './screen-pane'
import { setScreenStatus } from './screen-state'
import type { BotMeta, RosterRow } from './types'

const CLOSE_CONTROL_TAKEN = 4000
/** A lease flip closes every watcher once; re-dial that many times, no more. */
const MAX_REDIALS = 2
const MORPH_NAME = 'hbp-screen-morph'
const TARGET_WAIT_MS = 450

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> }
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function findScreenTarget(frame: HTMLElement): Promise<HTMLElement | null> {
  return new Promise(resolve => {
    const started = performance.now()

    const look = () => {
      const target = [...document.querySelectorAll<HTMLElement>('[data-remote-screen]')].find(
        node => !frame.contains(node)
      )

      if (target || performance.now() - started > TARGET_WAIT_MS) {
        resolve(target ?? null)

        return
      }

      // Timers, not frames: a View Transition holds rendering during its update.
      window.setTimeout(look, 16)
    }

    look()
  })
}

/** Open the bot's Screen tab, growing the card's frame into it where the
 *  browser supports View Transitions. */
export async function expandToScreen(frame: HTMLElement, bot: RosterRow, meta: BotMeta | null): Promise<void> {
  const doc = document as ViewTransitionDocument

  if (!doc.startViewTransition || reducedMotion()) {
    openBotScreen(bot, meta)

    return
  }

  let target: HTMLElement | null = null
  frame.style.setProperty('view-transition-name', MORPH_NAME)

  const transition = doc.startViewTransition(async () => {
    frame.style.removeProperty('view-transition-name')
    openBotScreen(bot, meta)
    target = await findScreenTarget(frame)
    target?.style.setProperty('view-transition-name', MORPH_NAME)
  })

  await transition.finished.catch(() => undefined)
  frame.style.removeProperty('view-transition-name')
  ;(target as HTMLElement | null)?.style.removeProperty('view-transition-name')
}

/** Watch-only stream of the bot's screen. Reports `true` once frames paint
 *  and `false` when the stream ends for good. */
export function CardScreenStream({
  bot,
  botKey,
  onLive
}: {
  bot: RosterRow
  /** Stable identity: a roster poll hands over a fresh row object each time,
   *  and that must not re-dial the stream. */
  botKey: string
  onLive: (live: boolean) => void
}): JSX.Element {
  const canvasHost = useRef<HTMLDivElement | null>(null)
  const report = useRef(onLive)
  const botRef = useRef(bot)
  const [painted, setPainted] = useState(false)
  report.current = onLive
  botRef.current = bot

  useEffect(() => {
    const bot = botRef.current
    let disposed = false
    let redials = 0
    let release: () => void = () => undefined
    let socket: null | WebSocket = null
    let client: null | { disconnect: () => void } = null

    const teardown = () => {
      try {
        client?.disconnect()
      } catch {
        // already closed by the bridge
      }

      client = null
      socket?.close()
      socket = null
    }

    const fail = () => {
      if (!disposed) {
        setPainted(false)
        report.current(false)
      }
    }

    const dial = async () => {
      try {
        const Rfb = await loadRfb()
        const observe = await displayRequest<DisplayObserveResult>(bot, 'display.observe')
        setScreenStatus(bot, observe)
        const url = await resolveScreenWsUrl(bot, observe.ticket)

        if (disposed || !canvasHost.current) {
          return
        }

        let closeCode = 0
        const ws = new WebSocket(url)
        ws.binaryType = 'arraybuffer'
        ws.addEventListener('close', event => {
          closeCode = event.code
        })
        socket = ws
        const rfb = new Rfb(canvasHost.current, ws, { shared: true })
        rfb.viewOnly = true
        rfb.scaleViewport = true
        rfb.resizeSession = false
        rfb.focusOnClick = false
        rfb.background = 'transparent'
        rfb.qualityLevel = 5
        rfb.addEventListener('connect', () => {
          if (!disposed) {
            setPainted(true)
            report.current(true)
          }
        })
        rfb.addEventListener('disconnect', event => {
          if (disposed || client !== rfb) {
            return
          }

          client = null
          const evicted = closeCode === CLOSE_CONTROL_TAKEN || (event.detail?.reason ?? '').includes('control-taken')

          if (evicted && redials < MAX_REDIALS) {
            redials += 1
            void dial()

            return
          }

          fail()
        })
        client = rfb
      } catch {
        fail()
      }
    }

    void (async () => {
      release = await retainBotScreen(bot)

      if (disposed) {
        release()

        return
      }

      await dial()
    })()

    return () => {
      disposed = true
      teardown()
      release()
    }
  }, [botKey])

  return (
    <span className="hbp-lv-layer absolute inset-0 block hbp-tc-sunken" data-ready={painted} data-live-screen="">
      <span aria-hidden className="pointer-events-none absolute inset-0 block" ref={canvasHost} />
    </span>
  )
}

/** The click target over a streaming frame: the canvas never sees input. */
export function ScreenExpandButton({
  bot,
  label,
  meta
}: {
  bot: RosterRow
  label: string
  meta: BotMeta | null
}): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)

  return (
    <button
      aria-label={label}
      className="hbp-lv-frame absolute inset-0 block cursor-zoom-in"
      onClick={event => {
        event.stopPropagation()
        const frame = ref.current?.parentElement

        if (frame) {
          void expandToScreen(frame, bot, meta)
        }
      }}
      onKeyDown={event => event.stopPropagation()}
      ref={ref}
      type="button"
    >
      <span className="hbp-lv-zoom absolute right-1.5 bottom-1.5 grid size-6 place-items-center hbp-tc-rc hbp-lv-badge">
        <Codicon name="screen-full" size={12} />
      </span>
    </button>
  )
}
