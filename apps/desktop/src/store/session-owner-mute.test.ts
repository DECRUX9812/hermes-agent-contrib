import { beforeEach, describe, expect, it } from 'vitest'

import { $sessions } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import {
  $ownerNotifyModes,
  isSessionNotificationMuted,
  ownerNotifyModeForSession,
  setOwnerNotifyMode
} from './session-mute'

const row = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, message_count: 1, source: 'cli', started_at: 0, title: id, ...extra }) as SessionInfo

beforeEach(() => {
  window.localStorage.clear()
  $ownerNotifyModes.set({})
  $sessions.set([])
})

describe('per-bot (owner-scoped) notification modes', () => {
  it('covers every session owned by the profile — canonical chat, side-chats, and sessions minted after the mute', () => {
    $sessions.set([row('bot-chat', { profile: 'nova' }), row('side-1', { profile: 'nova' })])

    setOwnerNotifyMode('local::nova', 'muted')

    expect(isSessionNotificationMuted('bot-chat')).toBe(true)
    expect(isSessionNotificationMuted('side-1')).toBe(true)

    // A cron/side session that did not exist when the bot was muted is covered too.
    $sessions.set([...$sessions.get(), row('cron-late', { profile: 'nova' })])
    expect(isSessionNotificationMuted('cron-late')).toBe(true)

    // Other profiles are untouched.
    $sessions.set([...$sessions.get(), row('other', { profile: 'rex' })])
    expect(isSessionNotificationMuted('other')).toBe(false)
  })

  it('keeps quiet-hours mode distinct from mute and scopes by connection', () => {
    $sessions.set([row('local-s', { profile: 'nova' }), row('remote-s', { profile: 'nova', connection_id: 'ssh-1' })])

    setOwnerNotifyMode('ssh-1::nova', 'quiet')

    expect(ownerNotifyModeForSession('remote-s')).toBe('quiet')
    expect(ownerNotifyModeForSession('local-s')).toBeUndefined()
    // Quiet is not a hard mute — the native gate decides when the window is active.
    expect(isSessionNotificationMuted('remote-s')).toBe(false)

    setOwnerNotifyMode('ssh-1::nova', null)
    expect(ownerNotifyModeForSession('remote-s')).toBeUndefined()
  })
})
