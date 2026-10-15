import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  $cronSessions,
  $messagingSessions,
  $sessions,
  $unlistedSessionOwnerRows,
  carryListedRowFields
} from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import { resolveStoredSession } from './utils'

const makeSession = (over: Partial<SessionInfo>): SessionInfo =>
  ({
    archived: false,
    cwd: '/tmp',
    hidden: false,
    id: 's1',
    is_internal_child: false,
    last_active: 100,
    model: 'mock',
    preview: null,
    profile: 'default',
    source: 'desktop',
    started_at: 100,
    title: null,
    ...over
  }) as SessionInfo

describe('carryListedRowFields', () => {
  it('carries preview and unread from a listed row onto a by-id resolved row that lacks them', () => {
    const existing = makeSession({
      id: 'session-42',
      preview: 'Draft the weekly team update',
      unread: true
    })

    const incoming = makeSession({
      id: 'session-42',
      preview: null,
      title: null,
      unread: undefined
    })

    const merged = carryListedRowFields([existing], incoming, 'session-42')

    expect(merged.preview).toBe('Draft the weekly team update')
    expect(merged.unread).toBe(true)
  })

  it('keeps the incoming preview and unread when the incoming row already provides them', () => {
    const existing = makeSession({
      id: 'session-42',
      preview: 'Old preview',
      unread: true
    })

    const incoming = makeSession({
      id: 'session-42',
      preview: 'New preview from server',
      unread: false
    })

    const merged = carryListedRowFields([existing], incoming, 'session-42')

    expect(merged.preview).toBe('New preview from server')
    expect(merged.unread).toBe(false)
  })

  it('preserves incoming row identity when there are no fields to carry', () => {
    const existing = makeSession({ id: 'other-session' })
    const incoming = makeSession({ id: 'session-42', preview: 'Already has preview' })

    const merged = carryListedRowFields([existing], incoming, 'session-42')

    expect(merged).toBe(incoming)
  })
})

describe('resolveStoredSession listed-row fields carry', () => {
  beforeEach(() => {
    $sessions.set([])
    $cronSessions.set([])
    $messagingSessions.set([])
    $unlistedSessionOwnerRows.set([])
  })

  afterEach(() => {
    $sessions.set([])
    $cronSessions.set([])
    $messagingSessions.set([])
    $unlistedSessionOwnerRows.set([])
  })

  it('preserves the sidebar row first-prompt preview across a by-id resolve', async () => {
    // Models the exact reload sequence:
    // 1. The batched sidebar endpoint loaded the row with preview = prompt text, title = null.
    // 2. The window reloads and useRouteResume triggers a cold-start resolveStoredSession.
    // 3. The by-id resolve returns a row with preview = null.
    // 4. The sidebar must retain the prompt-derived preview so the row button text stays visible.
    const listedRow = makeSession({
      id: '20261015_080000_abc',
      preview: 'Draft the weekly team update',
      profile: 'default',
      title: null
    })

    $sessions.set([listedRow])

    const resolved = await resolveStoredSession('20261015_080000_abc')

    expect(resolved?.id).toBe('20261015_080000_abc')
    expect(resolved?.preview).toBe('Draft the weekly team update')

    const sessionInStore = $sessions.get().find(s => s.id === '20261015_080000_abc')

    expect(sessionInStore?.preview).toBe('Draft the weekly team update')
  })
})
