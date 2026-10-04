/**
 * Chat-header gate (G7) — which session headers may wear the bot's persona
 * chip (role + model quick-swap).
 *
 * The invariant is the canonical-chat identity itself: only a session whose
 * (profile, title) pair is exactly (bot name, 'Bot Chat') resolves a roster
 * row. A side-chat, a routine-run session, or an ordinary Sessions-mode chat
 * on the same profile — anything titled anything else — renders nothing, and
 * no stored session id is ever consulted.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('./canonical-chat', () => ({ CANONICAL_CHAT_TITLE: 'Bot Chat' }))

import { botHeaderRow } from './bot-header'
import type { RosterRow } from './types'

const roster = [{ name: 'alpha' }, { name: 'alpha@conn-2', targetProfile: 'alpha' }, { name: 'beta' }] as RosterRow[]

describe('botHeaderRow', () => {
  it('resolves the roster row for the canonical Bot Chat only', () => {
    expect(botHeaderRow(roster, 'alpha', 'Bot Chat')?.name).toBe('alpha')
    // A remote-sourced row resolves through its target profile too.
    expect(botHeaderRow(roster, 'alpha@conn-2', 'Bot Chat')?.targetProfile).toBe('alpha')
  })

  it('renders nothing on any other session, even on the same profile', () => {
    // Side-chats, routine runs, Sessions-mode chats — any other title.
    expect(botHeaderRow(roster, 'alpha', 'Follow-up chat')).toBeNull()
    expect(botHeaderRow(roster, 'alpha', 'Bot Chat — replay')).toBeNull()
    expect(botHeaderRow(roster, 'alpha', '')).toBeNull()
  })

  it('renders nothing without a profile or a roster row', () => {
    expect(botHeaderRow(roster, null, 'Bot Chat')).toBeNull()
    expect(botHeaderRow(roster, 'ghost-profile', 'Bot Chat')).toBeNull()
    expect(botHeaderRow(null, 'alpha', 'Bot Chat')).toBeNull()
  })
})
