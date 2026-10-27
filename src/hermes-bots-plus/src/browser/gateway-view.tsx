/** A page rendered by the browser on the Hermes machine and streamed here as
 *  frames: for sites that refuse to be framed, and for dev servers that only
 *  exist on that machine. Clicks, wheel and keys go back to the page. */

import { Button, Codicon } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useRef, useState, type WheelEvent } from 'react'

import { CrossfadeShot } from '../tool-card-live'

import { type ViewAction, viewPage } from './api'
import { useBrowserText } from './browser-i18n'
import { remoteKeyRoute } from './focus'
import { patchTab, reloadTab, setRemoteCommand, type WebTab } from './store'

const POLL_MS = 1500
const TYPE_FLUSH_MS = 140
const WHEEL_FLUSH_MS = 90


interface Frame {
  image: string
  width: number
  height: number
}

export function GatewayView({ tab, visible }: { tab: WebTab; visible: boolean }) {
  const text = useBrowserText()
  const boxRef = useRef<HTMLDivElement>(null)
  const sinkRef = useRef<HTMLTextAreaElement>(null)
  const shotRef = useRef<HTMLSpanElement>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [failed, setFailed] = useState<null | string>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef(0)
  const alive = useRef(true)
  const typed = useRef('')
  const typeTimer = useRef(0)
  const wheel = useRef({ dx: 0, dy: 0, x: 0, y: 0, timer: 0 })

  useEffect(() => {
    alive.current = true

    return () => {
      alive.current = false
    }
  }, [])

  const run = useCallback(
    (body: { url?: string; action?: ViewAction }) => {
      pending.current += 1
      queue.current = queue.current.then(async () => {
        const box = boxRef.current
        const width = Math.round(box?.clientWidth || 1024)
        const height = Math.round(box?.clientHeight || 720)

        try {
          const result = await viewPage({ tab: tab.id, width, height, ...body })

          if (!alive.current) {
            return
          }

          if (!result.image) {
            setFailed(result.error || text.remoteFailed)
            patchTab<WebTab>(tab.id, { loading: false })

            return
          }

          setFailed(null)
          setFrame({ image: result.image, width: result.width, height: result.height })
          patchTab<WebTab>(tab.id, {
            loading: false,
            url: result.url || tab.url,
            title: result.title || '',
            remoteBack: result.canGoBack,
            remoteForward: result.canGoForward
          })
        } catch (error) {
          if (alive.current) {
            setFailed(error instanceof Error ? error.message : String(error))
            patchTab<WebTab>(tab.id, { loading: false })
          }
        } finally {
          pending.current -= 1
        }
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.id]
  )

  // Navigate on every new load of this tab.
  useEffect(() => {
    if (tab.target) {
      setFailed(null)
      run({ url: tab.target })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.nav, tab.id])

  // Toolbar back/forward/reload drive the gateway page's own history.
  useEffect(() => {
    setRemoteCommand(tab.id, kind => {
      patchTab<WebTab>(tab.id, { loading: true })
      run({ action: { kind } })
    })

    return () => setRemoteCommand(tab.id, null)
  }, [run, tab.id])

  // Keep the picture fresh while it's on screen.
  useEffect(() => {
    if (!visible || failed) {
      return
    }

    const timer = window.setInterval(() => {
      if (pending.current === 0 && document.visibilityState === 'visible') {
        run({})
      }
    }, POLL_MS)

    return () => window.clearInterval(timer)
  }, [failed, run, visible])

  const toPage = (clientX: number, clientY: number) => {
    const shot = shotRef.current

    if (!shot || !frame) {
      return null
    }

    const rect = shot.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * frame.width
    const y = ((clientY - rect.top) / rect.height) * frame.height

    return x < 0 || y < 0 || x > frame.width || y > frame.height ? null : { x: Math.round(x), y: Math.round(y) }
  }

  const flushTyped = () => {
    window.clearTimeout(typeTimer.current)

    if (typed.current) {
      run({ action: { kind: 'type', text: typed.current } })
      typed.current = ''
    }
  }

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    sinkRef.current?.focus({ preventScroll: true })
    const point = toPage(event.clientX, event.clientY)

    if (point) {
      flushTyped()
      run({ action: { kind: 'click', ...point } })
    }
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const point = toPage(event.clientX, event.clientY) ?? { x: 10, y: 10 }
    const state = wheel.current
    state.dx += event.deltaX
    state.dy += event.deltaY
    state.x = point.x
    state.y = point.y

    if (!state.timer) {
      state.timer = window.setTimeout(() => {
        const { dx, dy, x, y } = state
        state.dx = 0
        state.dy = 0
        state.timer = 0
        run({ action: { kind: 'scroll', x, y, dx, dy } })
      }, WHEEL_FLUSH_MS)
    }
  }

  // Keys reach the page through a hidden text field, so the app sees "typing
  // in a field": its bare-key shortcuts and type-to-chat stand down, while
  // Cmd/Ctrl chords (the palette) still work. See focus.ts.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const floating = Boolean(boxRef.current?.closest('[data-hermes-browser-float]'))
    const route = remoteKeyRoute(event.nativeEvent, floating)

    if (route === 'text') {
      event.preventDefault()
      typed.current += event.key
      window.clearTimeout(typeTimer.current)
      typeTimer.current = window.setTimeout(flushTyped, TYPE_FLUSH_MS)
    } else if (route === 'key') {
      event.preventDefault()
      flushTyped()
      run({ action: { kind: 'key', key: event.key } })
    }
  }

  if (failed && !frame) {
    return (
      <div className="hbb-center">
        <div className="hbb-card hbb-enter">
          <span className="hbb-card-icon" data-tone="warn">
            <Codicon name="warning" size={20} />
          </span>
          <h3>{text.remoteFailed}</h3>
          <p>{failed}</p>
          <div className="hbb-actions">
            <Button onClick={() => reloadTab(tab.id)} size="sm">
              <Codicon name="refresh" />
              {text.tryAgain}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      aria-label={tab.title || tab.url}
      className="hbb-remote"
      data-hermes-browser-remote=""
      data-terminal=""
      onClick={onClick}
      onWheel={onWheel}
      ref={boxRef}
      role="application"
    >
      <textarea
        aria-label={text.pageKeys}
        autoCapitalize="off"
        autoComplete="off"
        className="hbb-keysink"
        data-browser-keysink=""
        onChange={event => {
          event.currentTarget.value = ''
        }}
        onKeyDown={onKeyDown}
        ref={sinkRef}
        spellCheck={false}
        value=""
      />
      {frame && (
        <span
          className="relative block"
          ref={shotRef}
          style={{ aspectRatio: `${frame.width} / ${frame.height}`, width: '100%', maxHeight: '100%' }}
        >
          <CrossfadeShot src={frame.image} />
        </span>
      )}
    </div>
  )
}
