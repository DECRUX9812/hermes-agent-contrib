/**
 * The Command Room's live behaviour, kept out of the room view:
 *
 *  useRoomClock      — re-render every 30 s, so handoff clocks count down and a
 *                      stalled handoff escalates on time even in a quiet room
 *                      (the protocol reads Date.now() at render).
 *  useNeedsYouAlerts — a toast the moment something NEW waits on the user (an
 *                      escalation, a bot's question) — the notification half
 *                      of human-in-the-loop, so nobody has to watch the room.
 *  roomKeyHandler    — fast navigation: J/K between threads, Esc to All,
 *                      B Room/Board, N new thread, ? help. Ignored while typing.
 *  KeysHelp          — the list behind "?".
 */

import { Button, host } from '@hermes/plugin-sdk'
import type { KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import type { RoomEscalation } from './group-room-handoffs'
import { useBots } from './i18n'

const CLOCK_MS = 30_000

export function useRoomClock(): void {
  const [, setTick] = useState(0)

   
  useEffect(() => {
    const id = window.setInterval(() => setTick(tick => tick + 1), CLOCK_MS)

    return () => window.clearInterval(id)
  }, [])
}

/** Toast each escalation / question that wasn't there on the last render. The
 *  first render only records what already exists — opening a room is not news. */
export function useNeedsYouAlerts(
  escalations: readonly RoomEscalation[],
  questions: readonly { memberKey: string; requestId?: string; thread?: string }[],
  memberName: (memberKey: string) => string
): void {
  const b = useBots()
  const seen = useRef<null | Set<string>>(null)

  const keys = [
    ...escalations.map(e => `esc:${e.kind}:${e.handoff.id}`),
    ...questions.map(q => `q:${q.thread || ''}:${q.memberKey}:${q.requestId || ''}`)
  ]

  const signature = keys.join('|')

  // eslint-disable-next-line no-restricted-syntax -- previous-set tracker: alerts fire on the edge, once per item
  useEffect(() => {
    const before = seen.current
    seen.current = new Set(keys)

    if (!before) {
      return
    }

    for (const e of escalations) {
      if (!before.has(`esc:${e.kind}:${e.handoff.id}`)) {
        host.notify({ kind: 'warning', message: b.group.alerts.escalated(e.handoff.task) })
      }
    }

    for (const q of questions) {
      if (!before.has(`q:${q.thread || ''}:${q.memberKey}:${q.requestId || ''}`)) {
        host.notify({ kind: 'info', message: b.group.alerts.question(memberName(q.memberKey)) })
      }
    }
    // keys/escalations/questions are all captured by `signature`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null

  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))
}

export interface RoomKeyActions {
  focusThread: null | string
  onBoard: () => void
  onHelp: () => void
  onNewThread: () => void
  onOpen: (thread: null | string) => void
  /** Thread ids in the rail's order. */
  threads: readonly string[]
}

/** The room container's keydown: navigation keys only when nobody is typing. */
export function roomKeyHandler(actions: RoomKeyActions) {
  return (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) {
      return
    }

    const at = actions.focusThread ? actions.threads.indexOf(actions.focusThread) : -1

    const step = (delta: number) => {
      const next = actions.threads[Math.min(actions.threads.length - 1, Math.max(0, at + delta))]

      if (next) {
        actions.onOpen(next)
      }
    }

    const keys: Record<string, () => void> = {
      '?': actions.onHelp,
      b: actions.onBoard,
      Escape: () => actions.onOpen(null),
      j: () => step(1),
      k: () => step(at < 0 ? 1 : -1),
      n: actions.onNewThread
    }

    const run = keys[event.key]

    if (run) {
      event.preventDefault()
      run()
    }
  }
}

export function KeysHelp({ onClose }: { onClose: () => void }) {
  const b = useBots()
  const k = b.group.keys

  return (
    <div
      aria-label={k.title}
      className="absolute bottom-20 left-3 z-40 flex w-64 flex-col gap-1.5 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3 shadow-lg"
      data-testid="group-keys-help"
      role="dialog"
    >
      <div className="flex items-center">
        <span className="text-[0.75rem] font-semibold text-foreground">{k.title}</span>
        <Button className="ml-auto h-6 px-2 text-[0.6875rem]" onClick={onClose} size="sm" variant="ghost">
          Esc
        </Button>
      </div>
      {[k.next, k.all, k.board, k.newThread, k.help].map(line => (
        <div className="font-mono text-[0.6875rem] text-(--ui-text-secondary)" key={line}>
          {line}
        </div>
      ))}
    </div>
  )
}
