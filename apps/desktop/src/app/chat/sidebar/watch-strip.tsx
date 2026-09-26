import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { OverflowTip } from '@/components/ui/tooltip'
import type { SessionInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { triggerHaptic } from '@/lib/haptics'
import { normalizeProfileKey } from '@/store/profile'
import { $cronSessions, $messagingSessions, $sessions, sessionMatchesStoredId } from '@/store/session'
import { $watchedSessionKeys, sessionWatchKey, unwatchSession, watchedSessionEntries } from '@/store/session-watch'

import { SessionStatusDot } from '../session-status-dot'

interface SessionWatchStripProps {
  /** Same door a sidebar row's click takes (in-place resume, profile-aware). */
  onOpen: (sessionId: string, session?: SessionInfo) => void
}

function resolveWatchedSession(
  pools: readonly (readonly SessionInfo[])[],
  profile: string,
  durableId: string
): SessionInfo | undefined {
  // Prefer a row in the watch's own profile (twins across profiles share no
  // durable ids, but an exact profile match is still the honest answer), then
  // fall back to any pool row carrying the id under another profile's key —
  // better a slightly off chip than none.
  let fallback: SessionInfo | undefined

  for (const pool of pools) {
    for (const session of pool) {
      if (!sessionMatchesStoredId(session, durableId)) {
        continue
      }

      if (normalizeProfileKey(session.profile) === profile) {
        return session
      }

      fallback ??= session
    }
  }

  return fallback
}

/**
 * The rail's watch strip: every watched session as a compact live chip — the
 * same status dot a sidebar row paints, plus a truncated title — pinned at the
 * TOP of the Sessions column so a running conversation stays one click away
 * however far down it scrolls. Hidden entirely when nothing is watched.
 */
export function SessionWatchStrip({ onOpen }: SessionWatchStripProps) {
  const { t } = useI18n()
  const watch = t.sidebar.watch
  const watchedKeys = useStore($watchedSessionKeys)
  const sessions = useStore($sessions)
  const messagingSessions = useStore($messagingSessions)
  const cronSessions = useStore($cronSessions)

  const chips = useMemo(() => {
    if (Object.keys(watchedKeys).length === 0) {
      return []
    }

    const pools = [sessions, messagingSessions, cronSessions] as const

    return watchedSessionEntries().map(entry => ({
      ...entry,
      key: sessionWatchKey(entry.profile, entry.durableId),
      session: resolveWatchedSession(pools, entry.profile, entry.durableId)
    }))
  }, [watchedKeys, sessions, messagingSessions, cronSessions])

  if (chips.length === 0) {
    return null
  }

  return (
    <div
      aria-label={watch.strip}
      className="flex shrink-0 items-center gap-1 overflow-x-auto overscroll-x-contain px-0.5 pb-1"
      role="group"
    >
      {chips.map(({ durableId, key, profile, session }) => {
        const label = session ? sessionTitle(session) : t.sidebar.row.untitledChat(durableId)

        return (
          <div
            className="group/watch-chip relative flex min-w-0 max-w-36 shrink-0 items-center"
            key={key}
          >
            <button
              className="flex min-w-0 items-center gap-1.5 rounded-full border border-(--ui-stroke-tertiary) bg-(--ui-sidebar-surface-background) py-0.5 pl-1.5 pr-1.5 text-[0.6875rem] leading-none text-(--ui-text-secondary) transition-colors hover:border-(--ui-stroke-secondary) hover:text-(--ui-text-primary) group-hover/watch-chip:pr-5"
              onClick={() => {
                triggerHaptic('selection')
                onOpen(session?.id ?? durableId, session)
              }}
              type="button"
            >
              <SessionStatusDot session={session} storedSessionId={durableId} />
              <OverflowTip label={label} placement="row">
                <span className="min-w-0 truncate">{label}</span>
              </OverflowTip>
            </button>
            <button
              aria-label={watch.stop}
              className="absolute right-1 grid size-3.5 place-items-center rounded-full text-(--ui-text-tertiary) opacity-0 transition-opacity hover:text-(--ui-text-primary) focus-visible:opacity-100 group-hover/watch-chip:opacity-100"
              onClick={() => {
                triggerHaptic('selection')
                unwatchSession(profile, durableId)
              }}
              type="button"
            >
              <Codicon name="close" size="0.625rem" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
