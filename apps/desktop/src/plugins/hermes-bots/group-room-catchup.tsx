/**
 * Catch-up and recap — getting back up to speed without reading the scroll.
 *
 * roomCatchUp / CatchUpCard: "While you were away" — per thread, what changed
 *   since the user last opened the room (new replies, deliveries, who is on it
 *   now) plus anything waiting on them, each line a jump. Pure over the log;
 *   no model call.
 * recapEntries / RecapCard: a model-written recap of a thread (or of what was
 *   missed) in a fixed shape — TL;DR, Decided, Open with owners, Needs you —
 *   through the auxiliary `llm.oneshot` door, so the room's conversations and
 *   their prompt caches are never touched.
 */

import { Button, cn, Codicon, host, relativeTime } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { groupThreadOf } from './group-chat'
import type { RoomEscalation, RoomHandoff } from './group-room-handoffs'
import type { RoomWorkItem } from './group-room-work'
import { useBots } from './i18n'
import type { GroupMessage } from './types'

export interface CatchUpLine {
  delivered: string[]
  escalated: boolean
  fresh: number
  question: boolean
  thread: string
  title: string
  working: string[]
}

export interface RoomCatchUp {
  lines: CatchUpLine[]
  since: number
  total: number
}

export function roomCatchUp(
  log: readonly GroupMessage[],
  anchor: number,
  {
    escalations,
    handoffs,
    items,
    waiting
  }: {
    escalations: readonly RoomEscalation[]
    handoffs: readonly RoomHandoff[]
    items: readonly RoomWorkItem[]
    /** Threads holding a question for the user. */
    waiting: ReadonlySet<string>
  }
): RoomCatchUp {
  const fresh = new Map<string, number>()

  for (const entry of log) {
    if (entry.from?.kind === 'member' && Number(entry.at) > anchor) {
      const thread = groupThreadOf(entry)
      fresh.set(thread, (fresh.get(thread) ?? 0) + 1)
    }
  }

  const escalated = new Set(escalations.map(e => e.handoff.thread))

  const lines = items
    .filter(item => fresh.has(item.thread) || escalated.has(item.thread) || waiting.has(item.thread))
    .map(item => ({
      delivered: handoffs
        .filter(h => h.thread === item.thread && h.status === 'delivered' && h.at > anchor - 86_400_000)
        .map(h => h.task),
      escalated: escalated.has(item.thread),
      fresh: fresh.get(item.thread) ?? 0,
      question: waiting.has(item.thread) && !escalated.has(item.thread),
      thread: item.thread,
      title: item.title,
      working: item.working
    }))
    .sort((a, b) => Number(b.escalated || b.question) - Number(a.escalated || a.question) || b.fresh - a.fresh)

  return { lines, since: anchor, total: [...fresh.values()].reduce((sum, n) => sum + n, 0) }
}

const RECAP_INSTRUCTIONS = [
  'You recap a team chat between a user (the CEO) and their AI teammates, for a busy reader who skims.',
  'Answer with exactly these four sections, each 1-3 very short bullets, using the teammates’ names:',
  '**TL;DR** · **Decided** · **Open — who owns it** · **Needs you**.',
  'Write "none" under a section with nothing in it. No preamble, no closing line, never invent facts.'
].join(' ')

const RECAP_LINE_CHARS = 600
const RECAP_MAX_LINES = 80

/** A model recap of these entries ('' when the model had nothing). */
export async function recapEntries(
  entries: readonly GroupMessage[],
  nameOf: (name: string) => string
): Promise<string> {
  const input = entries
    .slice(-RECAP_MAX_LINES)
    .map(entry => {
      const who = entry.from?.kind === 'user' ? 'User (CEO)' : nameOf(entry.from?.name || '')

      const text = String(entry.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, RECAP_LINE_CHARS)

      return `${who}: ${text}`
    })
    .join('\n')

  const reply = await host.request<{ text?: string }>('llm.oneshot', {
    input,
    instructions: RECAP_INSTRUCTIONS,
    max_tokens: 500,
    task: 'session_ask',
    temperature: 0.2
  })

  return String(reply?.text || '').trim()
}

/** "Recap" on demand, cached until the thread grows. */
export function RecapCard({
  entries,
  label,
  nameOf
}: {
  entries: readonly GroupMessage[]
  label: string
  nameOf: (name: string) => string
}) {
  const b = useBots()
  const r = b.group.recap
  const [state, setState] = useState<{ at: number; error?: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const stale = state && state.at !== entries.length

  const run = async () => {
    setBusy(true)

    try {
      setState({ at: entries.length, text: (await recapEntries(entries, nameOf)) || r.empty })
    } catch {
      setState({ at: entries.length, error: true, text: r.failed })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label={r.title}
      className="flex flex-col gap-1.5 rounded-card border border-line bg-surface-raised px-4 py-3"
      data-testid="group-recap-card"
    >
      <div className="flex items-center gap-2">
        <Codicon className="text-fg-muted" name="sparkle" />
        <span className="text-ui-sm font-medium">{r.title}</span>
        <Button
          className="ml-auto"
          disabled={busy || !entries.length}
          onClick={() => void run()}
          size="sm"
          variant="ghost"
        >
          <Codicon name={busy ? 'loading' : 'refresh'} spinning={busy} />
          {busy ? r.working : state && !stale ? r.again : label}
        </Button>
      </div>
      {state ? (
        <div
          className="text-ui-xs leading-relaxed whitespace-pre-line text-fg-muted"
          data-testid="group-recap-text"
        >
          {state.text.replace(/\*\*/g, '')}
        </div>
      ) : null}
    </section>
  )
}

export interface CatchUpCardProps {
  catchUp: RoomCatchUp
  missed: readonly GroupMessage[]
  nameOf: (name: string) => string
  onDismiss: () => void
  onOpen: (thread: string) => void
}

export function CatchUpCard({ catchUp, missed, nameOf, onDismiss, onOpen }: CatchUpCardProps) {
  const b = useBots()
  const c = b.group.catchUp

  return (
    <section
      aria-label={c.title}
      className="flex flex-col gap-2 rounded-card border border-line bg-surface-raised px-4 py-3"
      data-testid="group-catchup-card"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-ui-sm font-medium">{c.title}</span>
        <span className="text-ui-xs text-fg-muted">
          {c.summary(catchUp.total, catchUp.lines.length, relativeTime(catchUp.since))}
        </span>
        <Button className="ml-auto" onClick={onDismiss} size="sm" variant="ghost">
          {c.dismiss}
        </Button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {catchUp.lines.map(line => (
          <li key={line.thread}>
            <button
              className="flex w-full cursor-pointer items-start gap-2 rounded-row px-2 py-1.5 text-left transition-colors hover:bg-hover"
              data-testid="group-catchup-line"
              onClick={() => onOpen(line.thread)}
              type="button"
            >
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  line.escalated || line.question
                    ? 'bg-warning'
                    : line.working.length
                      ? 'bg-brand'
                      : 'bg-success'
                )}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-ui-sm font-medium">{line.title}</span>
                <span className="text-ui-xs text-fg-muted">
                  {[
                    line.escalated ? c.escalated : '',
                    line.question ? c.question : '',
                    line.fresh ? c.fresh(line.fresh) : '',
                    ...line.delivered.map(task => c.delivered(task)),
                    line.working.length ? c.working(line.working.map(nameOf).join(', ')) : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {missed.length ? <RecapCard entries={missed} label={c.summarize} nameOf={nameOf} /> : null}
    </section>
  )
}
