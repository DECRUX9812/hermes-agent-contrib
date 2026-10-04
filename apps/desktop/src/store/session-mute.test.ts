import { beforeEach, describe, expect, it } from 'vitest'

import { $sessions } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import {
  $notificationHistory,
  $notifications,
  clearNotificationHistory,
  clearNotifications,
  NOTIFICATION_HISTORY_LIMIT,
  notify
} from './notifications'
import { $mutedSessionIds, isSessionMuted, toggleSessionMuted } from './session-mute'

const row = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, message_count: 1, source: 'cli', started_at: 0, title: id, ...extra }) as SessionInfo

beforeEach(() => {
  window.localStorage.clear()
  $mutedSessionIds.set([])
  $sessions.set([])
  clearNotifications()
  clearNotificationHistory()
})

describe('per-session notification mute', () => {
  it('stores the durable lineage root so the mute survives compression', () => {
    $sessions.set([row('root'), row('tip', { _lineage_root_id: 'root', _lineage_ids: ['root', 'tip'] })])

    expect(toggleSessionMuted('tip')).toBe(true)
    expect($mutedSessionIds.get()).toEqual(['root'])
    expect(isSessionMuted('tip')).toBe(true)
    expect(isSessionMuted('root')).toBe(true)

    expect(toggleSessionMuted('root')).toBe(false)
    expect(isSessionMuted('tip')).toBe(false)
  })

  it('mutes ids that are not in the loaded list too', () => {
    expect(toggleSessionMuted('gone')).toBe(true)
    expect(isSessionMuted('gone')).toBe(true)
    expect(isSessionMuted('other')).toBe(false)
  })

  it('suppresses the toast but keeps the history record', () => {
    toggleSessionMuted('s1')

    notify({ kind: 'info', message: 'done', sessionId: 's1' })

    expect($notifications.get()).toHaveLength(0)
    expect($notificationHistory.get()[0]).toMatchObject({ message: 'done', sessionId: 's1', suppressed: true })
  })

  it('still toasts and records unmuted sessions', () => {
    notify({ kind: 'info', message: 'done', sessionId: 's1' })

    expect($notifications.get()).toHaveLength(1)
    expect($notificationHistory.get()[0]?.suppressed).toBeFalsy()
  })

  it('records unscoped toasts in history', () => {
    notify({ kind: 'success', message: 'saved' })

    expect($notificationHistory.get()[0]).toMatchObject({ kind: 'success', message: 'saved' })
  })

  it('bounds history to the ring size, newest first', () => {
    for (let i = 0; i < NOTIFICATION_HISTORY_LIMIT + 5; i++) {
      notify({ kind: 'info', message: `m${i}` })
    }

    const history = $notificationHistory.get()
    expect(history).toHaveLength(NOTIFICATION_HISTORY_LIMIT)
    expect(history[0]?.message).toBe(`m${NOTIFICATION_HISTORY_LIMIT + 4}`)
    expect(history.at(-1)?.message).toBe('m5')
  })
})
