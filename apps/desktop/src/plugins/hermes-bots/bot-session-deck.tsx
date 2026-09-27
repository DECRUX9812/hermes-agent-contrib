/**
 * Sessions section for the bot pane (revamp F1): every session the bot's
 * profile owns — the canonical Bot Chat, side-chats, routine-run sessions —
 * as live rows with a status dot, title, and last activity. Click opens the
 * session in a tile beside the chat; "New chat" spawns a side-chat through
 * the existing newBotChat flow — never a second Bot Chat.
 *
 * Identity: the canonical badge resolves off the roster row's
 * `canonical_session` — the (profile, title 'Bot Chat') registry the gateway
 * resolves server-side — via `isCanonicalChatOnScreen`, which matches the
 * durable id AND its compression tip. No stored-id pin, no recency.
 *
 * Data: `host.listPersistedSessions` reads the profile's persisted rows
 * through the owning source's primary REST backend — it never dials the
 * bot's own gateway, so rendering the deck can't cold-spawn an inactive
 * profile backend. That endpoint excludes hidden rows, and the canonical
 * chat is ALWAYS hidden: the deck unions the registry row in itself. Hiding
 * is a sidebar invariant only — it does not extend to this pane.
 */

import {
  cn,
  Codicon,
  host,
  type PluginProfileRoute,
  RowButton,
  type SessionInfo,
  SessionStatusDot,
  Tip,
  useI18n
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'

import { CANONICAL_CHAT_TITLE, isCanonicalChatOnScreen } from './canonical-chat'
import { newBotChat } from './data'
import { useBots } from './i18n'
import { RosterSectionHeader } from './roster-sections'
import { botConnectionRoute } from './routing'
import { rosterRowAge } from './row-helpers'
import type { CanonicalSession, RosterRow } from './types'

const DECK_LIMIT = 50

/** The registry row as a list-shaped SessionInfo — the REST list never
 *  returns it (canonical chats are hidden), so the deck reintroduces it from
 *  the roster's `canonical_session` projection. `resolved_id` is the live
 *  compression tip: the id the chat on screen actually answers to. */
function canonicalSessionRow(canonical: CanonicalSession): SessionInfo | null {
  const id = canonical.resolved_id || canonical.id

  if (!id) {
    return null
  }

  // Only the fields the deck paints: id, title, preview, last activity. The
  // rest of SessionInfo is present-but-defaulted so a sort or badge that
  // touches it reads a stable value rather than undefined drift.
  return {
    ended_at: null,
    id,
    input_tokens: 0,
    is_active: false,
    last_active: canonical.last_active ?? 0,
    message_count: 0,
    model: null,
    output_tokens: 0,
    preview: canonical.preview ?? null,
    source: null,
    started_at: canonical.last_active ?? 0,
    title: canonical.title ?? CANONICAL_CHAT_TITLE,
    tool_call_count: 0
  }
}

/** Canonical first, then most-recently-active — the deck's one ordering. */
export function orderDeckSessions(owner: RosterRow, listed: SessionInfo[]): SessionInfo[] {
  const sessions = [...listed]
  const canonical = owner?.canonical_session
  const canonicalRow = canonical ? canonicalSessionRow(canonical) : null

  // A backend that starts returning hidden rows hands the deck the canonical
  // row twice — the injected one is dropped only when a listed row IS the
  // registry row or its lineage tip.
  const listedCanonical = canonical ? sessions.some(s => isCanonicalChatOnScreen(owner, s.id)) : false

  if (canonicalRow && !listedCanonical) {
    sessions.unshift(canonicalRow)
  }

  const activity = (s: SessionInfo) => Math.max(s.last_active ?? 0, s.started_at ?? 0)

  return sessions.sort((a, b) => {
    const aCanonical = canonicalRow ? isCanonicalChatOnScreen(owner, a.id) : false
    const bCanonical = canonicalRow ? isCanonicalChatOnScreen(owner, b.id) : false

    if (aCanonical !== bCanonical) {
      return aCanonical ? -1 : 1
    }

    return activity(b) - activity(a)
  })
}

export function BotSessionDeck({ owner }: { owner: RosterRow }) {
  const b = useBots()
  const { t } = useI18n()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const seq = useRef(0)
  // Same trap as BotDeliverablesSection: the roster poll replaces the owner
  // ROW each refresh — only the key is stable.
  const ownerKey = `${owner?.connectionId || 'local'}::${owner?.name || ''}`
  const ownerRef = useRef(owner)
  ownerRef.current = owner

  const load = useCallback(() => {
    const owner = ownerRef.current
    const current = ++seq.current
    let route: PluginProfileRoute | null = null

    try {
      route = botConnectionRoute(owner)
    } catch {
      route = null
    }

    if (typeof host.listPersistedSessions !== 'function' || !owner?.name) {
      setSessions([])
      setLoaded(true)

      return
    }

    setRefreshing(true)

    void host
      .listPersistedSessions(route, { limit: DECK_LIMIT, profile: owner.name })
      .then(result => {
        if (seq.current !== current) {
          return
        }

        setSessions(result?.sessions ?? [])
        setLoaded(true)
      })
      .catch(() => {
        if (seq.current !== current) {
          return
        }

        setSessions([])
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

  const rows = orderDeckSessions(owner, sessions)

  const open = (row: SessionInfo) => {
    const owner = ownerRef.current
    let route: PluginProfileRoute | null = null

    try {
      route = botConnectionRoute(owner)
    } catch {
      route = null
    }

    void host.openSession(row.id, {
      ...(route ? { route } : {}),
      profile: owner.name,
      // Beside the canonical chat, never in its place.
      intent: 'tab'
    })
  }

  const newChat = () => {
    const owner = ownerRef.current

    if (owner) {
      newBotChat(owner)
    }
  }

  return (
    <div className="px-3 pb-1">
      <RosterSectionHeader
        action={
          <span className="flex items-center gap-1.5 pr-1">
            <Tip label={b.deck.refresh}>
              <span
                aria-label={b.deck.refresh}
                className="flex cursor-pointer items-center text-[0.6875rem] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-text-secondary)"
                onClick={load}
                role="button"
              >
                <Codicon name="refresh" spinning={refreshing} />
              </span>
            </Tip>
            <Tip label={b.deck.newChat}>
              <span
                aria-label={b.deck.newChat}
                className="flex cursor-pointer items-center text-[0.6875rem] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-text-secondary)"
                onClick={newChat}
                role="button"
              >
                <Codicon name="add" />
              </span>
            </Tip>
          </span>
        }
        collapsed={collapsed}
        count={rows.length}
        icon="list-unordered"
        label={b.deck.title}
        onToggle={() => setCollapsed(v => !v)}
      />
      {collapsed ? null : loaded && rows.length === 0 ? (
        <div className="pb-1 text-xs text-(--ui-text-quaternary)">{b.deck.empty}</div>
      ) : (
        <div className="grid gap-0.5">
          {rows.map(row => {
            const canonical = isCanonicalChatOnScreen(owner, row.id)
            const label = row.title?.trim() || row.preview?.trim() || b.deck.untitled
            const atMs = Math.max(row.last_active ?? 0, row.started_at ?? 0) * 1000

            return (
              <RowButton
                aria-label={label}
                className={cn(
                  'flex w-full min-w-0 max-w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors',
                  'hover:bg-(--chrome-action-hover)'
                )}
                key={row.id}
                onClick={() => open(row)}
              >
                <SessionStatusDot session={row} storedSessionId={row.id} />
                <span className="min-w-0 flex-1">
                  <span className="block min-w-0 truncate text-[0.75rem] font-medium text-(--ui-text-secondary)">
                    {label}
                  </span>
                </span>
                {canonical ? (
                  <span className="shrink-0 rounded-full border border-(--ui-stroke-secondary) px-1.5 text-[0.6rem] uppercase tracking-wider text-(--ui-text-quaternary)">
                    {b.deck.canonical}
                  </span>
                ) : null}
                <span className="shrink-0 text-[0.65rem] text-(--ui-text-quaternary)">
                  {atMs ? rosterRowAge(atMs, t.sidebar.row) : ''}
                </span>
              </RowButton>
            )
          })}
        </div>
      )}
    </div>
  )
}
