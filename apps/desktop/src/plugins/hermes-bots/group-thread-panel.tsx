/**
 * One thread beside the room: its header, its entries, and its own reply box.
 * Opening a thread no longer filters the room's log, so the reader keeps
 * their place in the conversation, and the main composer keeps starting new
 * threads while this box continues this one.
 */

import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'

const NEAR_BOTTOM_PX = 96

export interface GroupThreadPanelProps {
  /** The thread's entries, already rendered by the room. */
  children: ReactNode
  composer: ReactNode
  /** Grows as entries land; the panel follows the tail while the reader is there. */
  entryCount: number
  header: ReactNode
  onClose: () => void
  thread: string
}

export function GroupThreadPanel({ children, composer, entryCount, header, onClose, thread }: GroupThreadPanelProps) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    stick.current = true
    const el = scroller.current

    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [thread])

  useEffect(() => {
    const el = scroller.current

    if (el && stick.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [entryCount])

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      data-testid="group-thread-panel"
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          onClose()
        }
      }}
    >
      {header}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="group-thread-log"
        onScroll={event => {
          const el = event.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
        }}
        ref={scroller}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1 px-2.5 pt-1 pb-2">{children}</div>
      </div>
      <div className="border-t border-line p-2">{composer}</div>
    </section>
  )
}
