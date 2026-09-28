/**
 * Deliverables section for the bot pane (revamp B3): the artifact rail's own
 * derivation, scoped to EVERY persisted session the bot's profile owns —
 * canonical Bot Chat, side-chats, routine-run sessions alike — via
 * `host.listProfileArtifacts`. Read-only: rows jump to the transcript span
 * the artifact came from (the same replay plumbing the Runs feed uses);
 * nothing here previews, promotes, or mutates.
 */

import {
  armTranscriptReplayJump,
  cn,
  Codicon,
  host,
  type RailArtifactItem,
  RowButton,
  type SessionInfo,
  Tip,
  useI18n
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useBots } from './i18n'
import { botConnectionRoute } from './routing'
import { rosterRowAge } from './row-helpers'
import type { RosterRow } from './types'

const DELIVERABLES_LIMIT = 20

const KIND_GLYPH: Record<RailArtifactItem['kind'], string> = {
  artifact: 'file-code',
  file: 'file',
  image: 'file-media',
  link: 'link'
}

/** The session a deliverable belongs to, whichever source produced it. */
function itemSessionId(item: RailArtifactItem): null | string {
  return item.transcript?.sessionId || item.registry?.sessionId || null
}

export function BotDeliverablesSection({ owner }: { owner: RosterRow }) {
  const b = useBots()
  const { t } = useI18n()
  const [items, setItems] = useState<RailArtifactItem[]>([])
  const [sessionsById, setSessionsById] = useState<ReadonlyMap<string, SessionInfo>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const seq = useRef(0)
  // The roster poll replaces the owner ROW each refresh — only the key is
  // stable, so the fetch must key off it or every poll pays a transcript
  // scrape per session.
  const ownerKey = `${owner?.connectionId || 'local'}::${owner?.name || ''}`
  const ownerRef = useRef(owner)
  ownerRef.current = owner

  const load = useCallback(() => {
    const owner = ownerRef.current
    const current = ++seq.current
    let route = null

    try {
      route = botConnectionRoute(owner)
    } catch {
      route = null
    }

    if (typeof host.listProfileArtifacts !== 'function' || !owner?.name) {
      setItems([])
      setSessionsById(new Map())
      setLoaded(true)

      return
    }

    setRefreshing(true)

    void host
      .listProfileArtifacts(route, { profile: owner.name })
      .then(result => {
        if (seq.current !== current) {
          return
        }

        setItems(result.items.slice(0, DELIVERABLES_LIMIT))
        setSessionsById(new Map(result.sessions.map(session => [session.id, session])))
        setLoaded(true)
      })
      .catch(() => {
        if (seq.current !== current) {
          return
        }

        setItems([])
        setSessionsById(new Map())
        setLoaded(true)
      })
      .finally(() => {
        if (seq.current === current) {
          setRefreshing(false)
        }
      })
  }, [])

  useEffect(() => {
    setLoaded(false)
    load()
  }, [load, ownerKey])

  const open = (item: RailArtifactItem) => {
    const owner = ownerRef.current
    const sessionId = itemSessionId(item)

    if (!sessionId) {
      return
    }

    let route = null

    try {
      route = botConnectionRoute(owner)
    } catch {
      route = null
    }

    if (typeof armTranscriptReplayJump === 'function') {
      armTranscriptReplayJump(sessionId, item.timestamp)
    }

    void host.openSession(sessionId, {
      ...(route ? { route } : {}),
      profile: owner.name,
      intent: 'tab'
    })
  }

  return (
    <div className="px-3 pb-1">
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <span className="text-[0.65rem] font-medium uppercase tracking-wider text-(--ui-text-quaternary)">
          {b.deliverables.title}
        </span>
        <span className="flex items-center gap-1.5">
          {items.length ? (
            <span className="text-[0.65rem] tabular-nums text-(--ui-text-quaternary)">{items.length}</span>
          ) : null}
          <Tip label={b.deliverables.refresh}>
            <span
              aria-label={b.deliverables.refresh}
              className="flex cursor-pointer items-center text-[0.6875rem] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-text-secondary)"
              onClick={load}
              role="button"
            >
              <Codicon name="refresh" spinning={refreshing} />
            </span>
          </Tip>
        </span>
      </div>
      {loaded && items.length === 0 ? (
        <div className="pb-1 text-xs text-(--ui-text-quaternary)">{b.deliverables.empty}</div>
      ) : (
        <div className="grid gap-0.5">
          {items.map(item => {
            const session = itemSessionId(item)

            const sessionTitle =
              item.transcript?.sessionTitle || (session ? sessionsById.get(session)?.title || '' : '')

            return (
              <RowButton
                aria-label={item.label}
                className={cn(
                  'flex w-full min-w-0 max-w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors',
                  'hover:bg-(--chrome-action-hover)'
                )}
                key={item.id}
                onClick={() => open(item)}
              >
                <Codicon
                  aria-label={item.kind}
                  className="shrink-0 text-[0.75rem] text-(--ui-text-tertiary)"
                  name={KIND_GLYPH[item.kind] || 'file'}
                />
                <span className="min-w-0 flex-1">
                  <span className="block min-w-0 truncate text-[0.75rem] font-medium text-(--ui-text-secondary)">
                    {item.label}
                  </span>
                  {sessionTitle ? (
                    <span className="block min-w-0 truncate text-[0.6875rem] text-(--ui-text-quaternary)">
                      {sessionTitle}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[0.65rem] text-(--ui-text-quaternary)">
                  {rosterRowAge(item.timestamp, t.sidebar.row)}
                </span>
              </RowButton>
            )
          })}
        </div>
      )}
    </div>
  )
}
