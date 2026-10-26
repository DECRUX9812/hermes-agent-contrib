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
  Button,
  cn,
  Codicon,
  GlyphSpinner,
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

interface DeliverablesView {
  ownerKey: string
  items: RailArtifactItem[]
  sessions: ReadonlyMap<string, SessionInfo>
  status: 'loading' | 'ready' | 'error' | 'unavailable'
}

export function BotDeliverablesSection({ owner }: { owner: RosterRow }) {
  const b = useBots()
  const { t } = useI18n()

  const [view, setView] = useState<DeliverablesView>({
    ownerKey: '',
    items: [],
    sessions: new Map(),
    status: 'loading'
  })

  const seq = useRef(0)
  // The roster poll replaces the owner ROW each refresh — only the key is
  // stable, so the fetch must key off it or every poll pays a transcript
  // scrape per session.
  const ownerKey = `${owner?.connectionId || 'local'}::${owner?.name || ''}`
  const ownerRef = useRef(owner)
  ownerRef.current = owner

  const load = useCallback(() => {
    const owner = ownerRef.current
    const key = `${owner?.connectionId || 'local'}::${owner?.name || ''}`
    const current = ++seq.current
    const empty = { ownerKey: key, items: [], sessions: new Map<string, SessionInfo>() }

    if (typeof host.listProfileArtifacts !== 'function' || !owner?.name) {
      setView({ ...empty, status: 'unavailable' })

      return
    }

    setView(prior => ({ ...(prior.ownerKey === key ? prior : empty), status: 'loading' }))

    // Resolve inside the promise so an unroutable remote owner fails visibly,
    // never falling through to the foreground/local connection.
    void Promise.resolve()
      .then(() => host.listProfileArtifacts(botConnectionRoute(owner), { profile: owner.name }))
      .then(result => {
        if (seq.current !== current) {
          return
        }

        setView({
          ownerKey: key,
          items: result.items.slice(0, DELIVERABLES_LIMIT),
          sessions: new Map(result.sessions.map(session => [session.id, session])),
          status: 'ready'
        })
      })
      .catch(() => {
        if (seq.current !== current) {
          return
        }

        setView(prior => ({ ...(prior.ownerKey === key ? prior : empty), status: 'error' }))
      })
  }, [])

  useEffect(() => {
    load()
    const requestSequence = seq

    return () => {
      requestSequence.current++
    }
  }, [load, ownerKey])

  const currentView = view.ownerKey === ownerKey ? view : null
  const items = currentView?.items ?? []
  const sessionsById = currentView?.sessions ?? new Map<string, SessionInfo>()
  const status = currentView?.status ?? 'loading'
  const refreshing = status === 'loading'

  const open = (item: RailArtifactItem) => {
    const owner = ownerRef.current
    const sessionId = itemSessionId(item)

    if (!sessionId) {
      return
    }

    try {
      const route = botConnectionRoute(owner)

      if (typeof armTranscriptReplayJump === 'function') {
        armTranscriptReplayJump(sessionId, item.timestamp)
      }

      void host
        .openSession(sessionId, {
          ...(route ? { route } : {}),
          profile: owner.name,
          intent: 'tab'
        })
        .catch(err => host.notifyError(err, b.deliverables.title))
    } catch (err) {
      host.notifyError(err, b.deliverables.title)
    }
  }

  return (
    <div aria-busy={refreshing} className="px-3 pb-3" data-testid="bot-deliverables">
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <span className="ui-section-label">{b.deliverables.title}</span>
        <span className="flex items-center gap-1.5">
          {items.length ? <span className="text-xs tabular-nums text-(--ui-text-tertiary)">{items.length}</span> : null}
          <Tip label={b.deliverables.refresh}>
            <Button
              aria-label={b.deliverables.refresh}
              disabled={refreshing || status === 'unavailable'}
              onClick={load}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="refresh" spinning={refreshing} />
            </Button>
          </Tip>
        </span>
      </div>
      {status === 'error' ? (
        <div className="grid gap-2 pb-2 text-xs text-(--ui-text-secondary)" role="alert">
          <p>{items.length ? b.deliverables.stale : b.deliverables.failed}</p>
          <Button className="justify-self-start" onClick={load} size="xs" variant="secondary">
            {t.common.retry}
          </Button>
        </div>
      ) : null}
      {refreshing && items.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-xs text-(--ui-text-tertiary)" role="status">
          <GlyphSpinner ariaLabel={b.deliverables.loading} className="text-xs" />
          {b.deliverables.loading}
        </div>
      ) : status === 'unavailable' ? (
        <p className="py-2 text-xs text-(--ui-text-tertiary)">{b.deliverables.unavailable}</p>
      ) : status === 'ready' && items.length === 0 ? (
        <p className="py-2 text-xs leading-relaxed text-(--ui-text-tertiary)">{b.deliverables.empty}</p>
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
                    <span className="block min-w-0 truncate text-xs text-(--ui-text-tertiary)">{sessionTitle}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-(--ui-text-tertiary)">
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
