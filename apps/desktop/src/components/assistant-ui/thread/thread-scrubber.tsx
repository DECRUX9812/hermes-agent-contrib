import { useStore } from '@nanostores/react'
import { type FC, useCallback, useEffect, useRef, useState } from 'react'

import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  $hideThreadTimeline,
  scrubberFractionToScrollTop,
  type ScrubberMarker,
  scrubberMarkerFraction,
  type ScrubberMarkerKind,
  scrubberViewportWindow
} from '@/store/thread-timeline'

import { ownViewport } from './timeline'

/** Marker → type color: user prompts ride the accent, tool rows the quiet
 *  tertiary, pending approvals the amber the rail already uses for attention. */
const KIND_CLASS: Record<ScrubberMarkerKind, string> = {
  approval: 'bg-amber-500',
  tool: 'bg-(--ui-text-tertiary) opacity-60',
  user: 'bg-(--theme-primary)'
}

const MARKER_SELECTORS: [selector: string, kind: ScrubberMarkerKind][] = [
  ['[data-message-id]', 'user'],
  ['[data-tool-row]', 'tool'],
  ['[data-slot="tool-approval-card"]', 'approval']
]

function sameMarkers(a: readonly ScrubberMarker[], b: readonly ScrubberMarker[]): boolean {
  return a.length === b.length && a.every((m, i) => m.kind === b[i].kind && m.fraction === b[i].fraction)
}

/** Hidden panes never measure; the timeline's hide preference gates both. */
export const ThreadScrubber: FC = () => {
  const paneVisible = usePaneVisible()
  const hidden = useStore($hideThreadTimeline)

  return paneVisible && !hidden ? <ActiveThreadScrubber /> : null
}

/**
 * Density minimap along the transcript scrollbar: every user message, tool
 * row, and approval card as a type-colored tick at its document fraction, with
 * a viewport-window band behind them. Click or drag anywhere on the strip to
 * jump; arrow keys walk the scroll position.
 */
const ActiveThreadScrubber: FC = () => {
  const { t } = useI18n()
  const root = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [markers, setMarkers] = useState<readonly ScrubberMarker[]>([])
  const [window_, setWindow] = useState({ height: 1, top: 0 })
  const [percent, setPercent] = useState(0)

  const measure = useCallback(() => {
    const viewport = ownViewport(root.current)

    if (!viewport) {
      return
    }

    const scrollHeight = viewport.scrollHeight
    const clientHeight = viewport.clientHeight
    // Document origin in client coordinates: rect.top - scrollTop.
    const originTop = viewport.getBoundingClientRect().top - viewport.scrollTop
    const next: ScrubberMarker[] = []

    for (const [selector, kind] of MARKER_SELECTORS) {
      for (const element of viewport.querySelectorAll<HTMLElement>(selector)) {
        next.push({
          fraction: scrubberMarkerFraction(element.getBoundingClientRect().top - originTop, scrollHeight),
          kind
        })
      }
    }

    setMarkers(previous => (sameMarkers(previous, next) ? previous : next))
    setWindow(scrubberViewportWindow(viewport.scrollTop, scrollHeight, clientHeight))
    setPercent(
      Math.round(
        (scrollHeight > clientHeight ? viewport.scrollTop / (scrollHeight - clientHeight) : 0) * 100
      )
    )
  }, [])

  useEffect(() => {
    const viewport = ownViewport(root.current)

    if (!viewport) {
      return
    }

    let frame = 0

    const compute = () => {
      frame = 0
      measure()
    }

    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(compute)
      }
    }

    const content = viewport.querySelector('[data-slot="aui_thread-content"]')
    const mutations = new MutationObserver(schedule)
    const resizes = new ResizeObserver(schedule)

    if (content) {
      mutations.observe(content, { childList: true, subtree: true })
      resizes.observe(content)
    }

    resizes.observe(viewport)
    viewport.addEventListener('scroll', schedule, { passive: true })
    schedule()

    return () => {
      mutations.disconnect()
      resizes.disconnect()
      viewport.removeEventListener('scroll', schedule)
      cancelAnimationFrame(frame)
    }
  }, [measure])

  const jumpTo = useCallback((clientY: number) => {
    const strip = root.current
    const viewport = ownViewport(strip)

    if (!strip || !viewport) {
      return
    }

    const rect = strip.getBoundingClientRect()
    const fraction = rect.height > 0 ? (clientY - rect.top) / rect.height : 0
    viewport.scrollTop = scrubberFractionToScrollTop(fraction, viewport.scrollHeight, viewport.clientHeight)
  }, [])

  const step = useCallback((delta: number) => {
    const viewport = ownViewport(root.current)

    if (!viewport) {
      return
    }

    viewport.scrollTop = Math.max(
      0,
      Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + delta)
    )
  }, [])

  return (
    <div
      aria-label={t.assistant.thread.timelineScrubber}
      aria-orientation="vertical"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%`}
      className="absolute inset-y-0 right-0 z-30 w-2.5 cursor-pointer touch-none select-none"
      data-slot="thread-scrubber"
      data-suppress-pane-reveal=""
      onKeyDown={event => {
        const viewport = ownViewport(root.current)
        const page = viewport ? viewport.clientHeight * 0.9 : 200
        const delta = { ArrowDown: 80, ArrowUp: -80, End: Number.MAX_SAFE_INTEGER, Home: -Number.MAX_SAFE_INTEGER, PageDown: page, PageUp: -page }[event.key]

        if (delta === undefined) {
          return
        }

        event.preventDefault()
        step(delta)
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
      onPointerDown={event => {
        dragging.current = true
        root.current?.setPointerCapture(event.pointerId)
        jumpTo(event.clientY)
      }}
      onPointerMove={event => {
        if (dragging.current) {
          jumpTo(event.clientY)
        }
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      ref={root}
      role="slider"
      tabIndex={0}
    >
      {/* Viewport window: where the transcript is looking right now. */}
      <span
        aria-hidden
        className="absolute inset-x-0 rounded-full bg-(--ui-text-tertiary)/15"
        style={{ height: `${window_.height * 100}%`, top: `${window_.top * 100}%` }}
      />
      {markers.map((marker, index) => (
        <span
          aria-hidden
          className={cn('absolute right-0.5 h-0.5 w-1.5 rounded-full', KIND_CLASS[marker.kind])}
          data-scrubber-kind={marker.kind}
          key={index}
          style={{ top: `calc(${marker.fraction * 100}% - 0.0625rem)` }}
        />
      ))}
    </div>
  )
}
