import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { type ChatMessage, chatMessageText } from '@/lib/chat-messages'
import { iconSize, X } from '@/lib/icons'
import { formatAgo } from '@/lib/time'
import { useStoreSelector } from '@/lib/use-session-slice'
import { $sessions, sessionMatchesStoredId, sessionPinId } from '@/store/session'
import { $sessionRecapDismissedIds, dismissSessionRecap } from '@/store/session-recap'
import { $todoProgressBySession } from '@/store/todos'

import { useSessionView } from './session-view'

/** A stored session only recaps when its tail is this stale (#13). */
export const SESSION_RECAP_IDLE_MS = 30 * 60 * 1000

const PREVIEW_MAX_CHARS = 140

export interface SessionRecap {
  /** First line of the newest assistant reply, trimmed for the strip. */
  lastAssistantLine: string | null
  /** Unix seconds when the newest visible message ended — idle check + age. */
  lastActivitySec: number
  /** Visible user messages — the transcript's turn count. */
  userTurns: number
}

const firstLine = (text: string): string => {
  const line = text.trim().split('\n', 1)[0] ?? ''

  return line.length > PREVIEW_MAX_CHARS ? `${line.slice(0, PREVIEW_MAX_CHARS - 1)}…` : line
}

/**
 * Derive the "where it left off" snapshot from a settled transcript — pure,
 * no model call, no RPC. Returns null when the tail is missing, still
 * streaming, or fresher than the idle threshold.
 */
export function buildSessionRecap(
  messages: readonly ChatMessage[],
  idleMs: number = SESSION_RECAP_IDLE_MS,
  nowMs: number = Date.now()
): SessionRecap | null {
  let last: ChatMessage | undefined
  let lastAssistant: ChatMessage | undefined
  let userTurns = 0

  for (const message of messages) {
    if (message.hidden || message.interim) {
      continue
    }

    // An in-flight turn is live state, not a point the session "left off" —
    // the whole strip stays quiet until it lands.
    if (message.pending) {
      return null
    }

    if (message.role === 'user') {
      userTurns += 1
    } else if (message.role === 'assistant' && chatMessageText(message).trim()) {
      lastAssistant = message
    }

    last = message
  }

  const lastActivitySec = last?.completedAt ?? last?.timestamp

  if (!last || !lastActivitySec || nowMs - lastActivitySec * 1000 < idleMs) {
    return null
  }

  return {
    lastAssistantLine: lastAssistant ? firstLine(chatMessageText(lastAssistant)) : null,
    lastActivitySec,
    userTurns
  }
}

/**
 * Small dismissible card above a settled stored-session transcript, in normal
 * flow so it never covers the messages:
 * "where it left off" — last reply preview, turn count, time-ago, plan
 * progress. Offers, never hijacks: no focus move, no navigation. Mount is
 * gated on the settled signals by the caller, so `view.$messages` is read
 * one-shot at mount — subscribing it would repaint the strip per streamed
 * token. Dismissal persists per session (store/session-recap.ts).
 */
export function SessionRecapCard({ storedSessionId }: { storedSessionId: string }) {
  const { t } = useI18n()
  const view = useSessionView()

  // Dismissal keys on the durable lineage id (same scope as the composer
  // draft), so a compression-rotated tip stays dismissed.
  const pinKey = useStoreSelector($sessions, sessions => {
    const session = sessions.find(s => sessionMatchesStoredId(s, storedSessionId))

    return session ? sessionPinId(session) : storedSessionId
  })

  const dismissed = useStoreSelector($sessionRecapDismissedIds, ids => ids.includes(pinKey))
  const todoProgress = useStoreSelector($todoProgressBySession, progress => progress[pinKey] ?? null)

  const recap = useMemo(() => buildSessionRecap(view.$messages.get()), [view])

  if (!recap || dismissed) {
    return null
  }

  const r = t.assistant.sessionRecap

  const meta = [
    r.title,
    formatAgo(recap.lastActivitySec * 1000, t.agents),
    r.turns(recap.userTurns),
    todoProgress ? r.todo(todoProgress) : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className="mx-auto mt-2 w-full max-w-xl shrink-0 px-4"
      data-slot="session-recap"
    >
      <div className="flex items-center gap-2 rounded-card border border-line bg-surface-raised px-3 py-2" role="status">
        <div className="min-w-0 flex-1">
          <div className="text-ui-xs text-fg-muted">{meta}</div>
          {recap.lastAssistantLine ? (
            <div className="truncate text-ui-sm text-fg-secondary">{recap.lastAssistantLine}</div>
          ) : null}
        </div>
        <Button
          aria-label={r.dismiss}
          onClick={() => dismissSessionRecap(pinKey)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <X className={iconSize.xs} />
        </Button>
      </div>
    </div>
  )
}
