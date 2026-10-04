/**
 * Bot session deck invariants (F1).
 *
 * The deck's one ordering is canonical-first, then last-activity. The pinned
 * facts:
 *
 *  1. The canonical Bot Chat ALWAYS leads the deck even though
 *     `listPersistedSessions` never returns it (canonical chats are hidden,
 *     and `hidden` is a sidebar invariant — not a pane one). The row is
 *     reintroduced from the roster's `canonical_session`, the server-side
 *     (profile, title 'Bot Chat') registry — so identity stays a title
 *     lookup, never a stored-id pin.
 *  2. A listed row that IS the canonical lineage tip (compaction re-ids the
 *     live chat) is not duplicated and still sorts first.
 */

import type { SessionInfo } from '@hermes/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'

import type { RosterRow } from './types'

// The real './canonical-chat' module is loaded (its identity contract is the
// thing under test-adjacency); only its side-effect-bearing siblings are
// stubbed.
vi.mock('@hermes/plugin-sdk', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
  Codicon: () => null,
  host: {},
  RowButton: () => null,
  SessionStatusDot: () => null,
  Tip: ({ children }: { children?: unknown }) => children,
  useI18n: () => ({ t: { sidebar: { row: {} } } })
}))

vi.mock('./data', () => ({ newBotChat: vi.fn() }))
vi.mock('./i18n', () => ({
  useBots: () => ({
    deck: {
      empty: 'empty',
      inbox: 'Inbox',
      newTopic: 'New topic',
      refresh: 'Refresh',
      title: 'Sessions',
      untitled: 'Untitled'
    }
  })
}))
vi.mock('./roster-sections', () => ({ RosterSectionHeader: () => null }))
vi.mock('./routing', () => ({ botConnectionRoute: () => null, botWorkspaceOwnerKey: () => 'bot:porter' }))
vi.mock('./row-helpers', () => ({ rosterRowAge: () => '' }))
vi.mock('./shared', () => ({ getPluginCtx: () => null }))

import { orderDeckSessions } from './bot-session-deck'

const sess = (id: string, lastActive: number): SessionInfo => ({
  ended_at: null,
  id,
  input_tokens: 0,
  is_active: false,
  last_active: lastActive,
  message_count: 0,
  model: null,
  output_tokens: 0,
  preview: null,
  source: null,
  started_at: lastActive,
  title: id,
  tool_call_count: 0
})

const OWNER: RosterRow = {
  canonical_session: { id: 'canon-root', last_active: 10, resolved_id: 'canon-tip', title: 'Bot Chat' },
  name: 'porter'
}

describe('F1 — canonical-first ordering, injected from the registry row', () => {
  it('unions the hidden canonical chat ahead of every listed session', () => {
    const rows = orderDeckSessions(OWNER, [sess('side-1', 900), sess('side-2', 500)])

    expect(rows.map(row => row.id)).toEqual(['canon-tip', 'side-1', 'side-2'])
    expect(rows[0].title).toBe('Bot Chat')
  })

  it('does not duplicate a canonical row the list already surfaced (lineage tip)', () => {
    // A backend that starts returning hidden rows — or a compression tip that
    // was born visible — must not produce a second canonical row.
    const rows = orderDeckSessions(OWNER, [sess('canon-tip', 700), sess('side-1', 900)])

    expect(rows.map(row => row.id)).toEqual(['canon-tip', 'side-1'])
  })

  it('sorts by last activity when the bot has no canonical chat yet', () => {
    const rows = orderDeckSessions({ name: 'porter' }, [sess('a', 1), sess('b', 9), sess('c', 5)])

    expect(rows.map(row => row.id)).toEqual(['b', 'c', 'a'])
  })
})
