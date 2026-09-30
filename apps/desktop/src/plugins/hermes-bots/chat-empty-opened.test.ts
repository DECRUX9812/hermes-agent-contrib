/**
 * A brand-new Bot Chat is on screen before the roster poll reports it as the
 * bot's canonical_session. The empty-state hero must still name its bot then —
 * but only for the chat this window opened for that bot, never another session.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  const stub: unknown = new Proxy(function stubbed() {}, {
    apply: () => stub,
    get: (_target, key) => (key === 'then' ? undefined : stub)
  })

  return new Proxy({ atom } as Record<string, unknown>, {
    get: (target, key) =>
      typeof key === 'symbol' || key in target ? target[key as string] : key === 'then' ? undefined : stub,
    has: () => true
  })
})

vi.mock('./data', () => ({
  $botMeta: {},
  $lastRoster: {},
  botRosterKey: (bot: { connectionId?: string; name: string }) => `${bot.connectionId || 'local'}:${bot.name}`
}))

import { botForOpenedChat } from './chat-empty'
import type { RosterRow } from './types'

const roster = [{ name: 'atlas' }, { name: 'quill' }] as RosterRow[]
const opened = { key: 'local:atlas', openedRegistryId: 'sess-atlas', openedSessionId: 'sess-atlas' }

describe('botForOpenedChat', () => {
  it('names the bot whose chat was just opened while that chat is on screen', () => {
    expect(botForOpenedChat(roster, opened, 'sess-atlas')?.name).toBe('atlas')
  })

  it('never lends that bot to a different session', () => {
    expect(botForOpenedChat(roster, opened, 'sess-other')).toBeNull()
    expect(botForOpenedChat(roster, null, 'sess-atlas')).toBeNull()
    expect(botForOpenedChat(roster, opened, '')).toBeNull()
  })
})
