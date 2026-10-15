/**
 * The room's right-hand slot: the members panel by default, a thread while
 * one is open. It is the one place the room's side content lives, at every
 * width:
 *
 *  wide   (room >= 1024 px)  inline panel, 280–440 px, resizable from its
 *                            left edge; folding it leaves the avatar strip.
 *  medium (560–1023 px)      the avatar strip inline; the panel opens over the
 *                            conversation as a sheet from the right.
 *  narrow (< 560 px)         nothing inline; the header's face pile opens the
 *                            sheet.
 *
 * Resizing writes the width straight to the element while the pointer moves
 * (one write per frame, no React render) and stores it once on release.
 */

import { Button, cn, Codicon, Tip, useValue } from '@hermes/plugin-sdk'
import type { KeyboardEvent, ReactNode, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { $roomPrefs, setAsideWidth } from './group-room-prefs'
import { useRoomText } from './room-i18n'

export type RoomLayout = 'compact' | 'medium' | 'narrow' | 'wide' | 'xwide'

export const ASIDE_DEFAULT = 320
export const ASIDE_MIN = 280
export const ASIDE_MAX = 440
const KEY_STEP = 16

const LAYOUT_STEPS: [number, RoomLayout][] = [
  [1280, 'xwide'],
  [1024, 'wide'],
  [768, 'medium'],
  [560, 'compact']
]

export function roomLayoutFor(width: number): RoomLayout {
  return LAYOUT_STEPS.find(([min]) => width >= min)?.[1] ?? 'narrow'
}

/** Inline panels fit only on wide rooms; below that the panel is a sheet. */
export function asideInline(layout: RoomLayout): boolean {
  return layout === 'wide' || layout === 'xwide'
}

export function clampAsideWidth(width: number): number {
  return Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, Math.round(width)))
}

/** The sheet's width on medium rooms: the stored aside width, never below
 *  360. Exported so the room's reading column reserves exactly this much
 *  while the sheet is open — the column shrinks with the panel instead of
 *  running under it. */
export function roomSheetWidth(stored: number | undefined): number {
  return Math.max(clampAsideWidth(stored || ASIDE_DEFAULT), 360)
}

/** The room's width bucket. Re-renders only when the bucket changes, never
 *  per pixel of a window drag. An unmeasured room (0 px: not laid out yet, or
 *  hidden) keeps the full layout rather than collapsing everything. */
export function useRoomLayout(ref: RefObject<HTMLElement | null>): RoomLayout {
  const [layout, setLayout] = useState<RoomLayout>('xwide')

  useLayoutEffect(() => {
    const el = ref.current

    if (!el) {
      return
    }

    const initial = el.getBoundingClientRect().width

    if (initial) {
      setLayout(roomLayoutFor(initial))
    }

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width

      if (width) {
        setLayout(roomLayoutFor(width))
      }
    })

    observer.observe(el)

    return () => observer.disconnect()
  }, [ref])

  return layout
}

export interface GroupRoomAsideProps {
  /** Folded to the strip by the user (wide rooms). */
  collapsed: boolean
  label: string
  layout: RoomLayout
  onExpand: () => void
  /** Close the sheet (medium and narrow rooms). */
  onSheetClose: () => void
  panel: ReactNode
  /** Changes when the panel's content swaps (members ↔ a thread) so the new
   *  content slides in. */
  panelKey: string
  sheetOpen: boolean
  strip: ReactNode
}

function ResizeHandle({ target }: { target: RefObject<HTMLElement | null> }) {
  const r = useRoomText()
  const stored = useValue($roomPrefs).asideWidth
  const width = clampAsideWidth(stored || ASIDE_DEFAULT)
  const drag = useRef<{ frame: number; startWidth: number; startX: number; width: number } | null>(null)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !target.current) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { frame: 0, startWidth: target.current.getBoundingClientRect().width, startX: event.clientX, width }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current

    if (!state) {
      return
    }

    state.width = clampAsideWidth(state.startWidth + (state.startX - event.clientX))

    if (!state.frame) {
      state.frame = requestAnimationFrame(() => {
        state.frame = 0

        if (target.current) {
          target.current.style.width = `${state.width}px`
        }
      })
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current
    drag.current = null

    if (!state) {
      return
    }

    cancelAnimationFrame(state.frame)
    event.currentTarget.releasePointerCapture(event.pointerId)

    if (target.current) {
      target.current.style.width = `${state.width}px`
    }

    setAsideWidth(state.width)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: KEY_STEP, ArrowRight: -KEY_STEP }

    const next =
      event.key in step
        ? clampAsideWidth(width + step[event.key])
        : event.key === 'Home'
          ? ASIDE_MAX
          : event.key === 'End'
            ? ASIDE_MIN
            : null

    if (next !== null) {
      event.preventDefault()
      setAsideWidth(next)
    }
  }

  return (
    <div
      aria-label={r.asideResize}
      aria-orientation="vertical"
      aria-valuemax={ASIDE_MAX}
      aria-valuemin={ASIDE_MIN}
      aria-valuenow={width}
      className="group/sash focus-ring absolute inset-y-0 -left-[3px] z-10 w-1.5 cursor-col-resize touch-none"
      data-testid="group-aside-resize"
      onDoubleClick={() => setAsideWidth(ASIDE_DEFAULT)}
      onKeyDown={onKeyDown}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="separator"
      tabIndex={0}
    >
      <span
        aria-hidden
        className="mx-auto block h-full w-px bg-transparent transition-colors duration-(--dur-fast) group-hover/sash:bg-line-strong group-focus-visible/sash:bg-line-strong"
      />
    </div>
  )
}

/** Slides new content in, but not the content the room first opened with. */
function useSlideOnChange(key: string): boolean {
  const first = useRef(key)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    if (key !== first.current) {
      setChanged(true)
    }
  }, [key])

  return changed || key !== first.current
}

export function GroupRoomAside(props: GroupRoomAsideProps) {
  const r = useRoomText()
  const panelRef = useRef<HTMLElement | null>(null)
  const stored = useValue($roomPrefs).asideWidth
  const width = clampAsideWidth(stored || ASIDE_DEFAULT)
  const slide = useSlideOnChange(props.panelKey)
  const inline = asideInline(props.layout)
  const showPanelInline = inline && !props.collapsed
  const showStrip = !showPanelInline && props.layout !== 'narrow'
  const { onSheetClose, sheetOpen } = props
  const sheet = !inline && sheetOpen

  useEffect(() => {
    if (!sheet) {
      return
    }

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onSheetClose()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, onSheetClose])

  const content = (
    <div
      className={cn('flex min-h-0 flex-1 flex-col', slide && 'motion-slide-in')}
      data-testid="group-aside-content"
      key={props.panelKey}
    >
      {props.panel}
    </div>
  )

  return (
    <>
      {showPanelInline ? (
        <aside
          aria-label={props.label}
          className="relative flex min-h-0 shrink-0 flex-col border-l border-line bg-surface"
          data-testid="group-room-aside"
          ref={panelRef}
          style={{ width }}
        >
          <ResizeHandle target={panelRef} />
          {content}
        </aside>
      ) : null}
      {showStrip ? (
        <div
          className="flex w-14 shrink-0 flex-col items-center gap-2 border-l border-line bg-surface py-2"
          data-testid="group-room-strip"
        >
          <Tip label={r.asideExpand} side="left">
            <Button
              aria-label={r.asideExpand}
              className="text-fg-muted hover:text-fg"
              onClick={props.onExpand}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="layout-sidebar-right" />
            </Button>
          </Tip>
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto">{props.strip}</div>
        </div>
      ) : null}
      {sheet ? (
        <>
          <div aria-hidden className="absolute inset-0 z-20" onPointerDown={onSheetClose} />
          <aside
            aria-label={props.label}
            className="motion-slide-in absolute inset-y-0 right-0 z-30 flex min-h-0 max-w-[calc(100%-3rem)] flex-col border-l border-line bg-surface shadow-e3"
            data-testid="group-room-sheet"
            style={{ width: roomSheetWidth(stored) }}
          >
            {content}
          </aside>
        </>
      ) : null}
    </>
  )
}
