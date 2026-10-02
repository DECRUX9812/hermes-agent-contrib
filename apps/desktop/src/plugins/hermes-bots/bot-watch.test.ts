/**
 * Watch bot (revamp B5): the roster row's Watch toggle and eye indicator ride
 * the SAME session-watch store the Sessions rail's chip strip drives — keyed
 * by the canonical chat's resolved id, never `last_session` (a side chat
 * must not become the watched surface).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

const { $watchedSessionKeys, isWatchedSessionId, toggleSessionWatched } = await import('@/store/session-watch')

import { botCanonicalSessionId } from './row-helpers'
import type { RosterRow } from './types'

const BOT = {
  canonical_session: { id: 'bot-chat', resolved_id: 'bot-chat-tip' },
  last_session: { id: 'side-chat', last_active: 9_999 },
  name: 'alpha'
} as RosterRow

beforeEach(() => {
  $watchedSessionKeys.set({})
})

describe('watch bot', () => {
  it('toggles the canonical resolved id — a fresher side chat is never the target', () => {
    const target = botCanonicalSessionId(BOT)

    expect(target).toBe('bot-chat-tip')

    expect(toggleSessionWatched(target!)).toBe(true)
    expect(isWatchedSessionId('bot-chat-tip')).toBe(true)
    // The side chat and unrelated ids stay unwatched.
    expect(isWatchedSessionId('side-chat')).toBe(false)
    // Toggling again unwatches — the eye goes out.
    expect(toggleSessionWatched(target!)).toBe(false)
    expect(isWatchedSessionId('bot-chat-tip')).toBe(false)
  })

  it('a bot with no resolved canonical session offers no watch target', () => {
    expect(botCanonicalSessionId({ last_session: { id: 'x' }, name: 'beta' } as RosterRow)).toBeNull()
  })
})
