import { beforeEach, describe, expect, it, vi } from 'vitest'

// Inbound event cards (revamp G5): the strip is a read-only projection of
// signals that already exist — mailbox notes addressed to the bot, the relay
// lane, routine completions. Invariants under test:
//   1. Only events bound to THIS bot card up: a note is addressed when its
//      `to.kind === 'bot'` party matches the bot's handle or profile on its
//      own connection — another bot's mail and another connection's mail
//      never leak in.
//   2. Pending signals persist (open notes, inflight relay) while settled
//      events age out of the window — the strip is "what needs the user now",
//      not a history log.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

import { type BotInboundSignals, deriveInboundEvents, INBOUND_WINDOW_MS } from './bot-events'
import type { MailboxNote } from './mailbox'
import type { GroupMember, RoutineJob } from './types'

const NOW = 1_760_000_000_000

const MEMBER: GroupMember = {
  connectionId: 'local',
  handle: 'research',
  name: 'research'
} as GroupMember

function note(over: Partial<MailboxNote>): MailboxNote {
  return {
    connectionId: 'local',
    created_at: NOW / 1000 - 60,
    id: 'n1',
    status: 'open',
    title: 'Review the draft',
    to: { handle: 'research', kind: 'bot', profile: 'research' },
    updated_at: NOW / 1000 - 60,
    ...over
  }
}

function signals(over: Partial<BotInboundSignals>): BotInboundSignals {
  return {
    attention: null,
    jobs: [],
    member: MEMBER,
    notes: [],
    now: NOW,
    relayInflight: false,
    ...over
  }
}

beforeEach(() => {
  for (const key of Object.keys(host)) {
    delete host[key]
  }
})

describe('deriveInboundEvents', () => {
  it('cards only notes addressed to this bot — handle, profile, or connection mismatch drops them', () => {
    const events = deriveInboundEvents(
      signals({
        notes: [
          note({ id: 'for-bot', to: { handle: 'research', kind: 'bot' } }),
          note({ id: 'for-other', to: { handle: 'other', kind: 'bot', profile: 'other' } }),
          note({ id: 'for-user', to: { kind: 'user', name: 'me' } }),
          note({ connectionId: 'remote', id: 'for-remote-bot', to: { handle: 'research', kind: 'bot' } })
        ]
      })
    )

    expect(events.map(event => event.id)).toEqual(['mail:local:for-bot'])
  })

  it('keeps pending signals but lets settled mail and routine runs age out', () => {
    const stale = (NOW - INBOUND_WINDOW_MS - 60_000) / 1000

    const events = deriveInboundEvents(
      signals({
        notes: [
          // Settled long ago — history, not an event.
          note({ id: 'old-done', status: 'done', updated_at: stale }),
          // Open never ages out: it is still waiting on the user.
          note({ id: 'old-open', status: 'open', updated_at: stale })
        ],
        relayInflight: true,
        jobs: [
          {
            job_id: 'j-stale',
            last_run_at: new Date(NOW - INBOUND_WINDOW_MS - 60_000).toISOString(),
            name: '[bot:research] stale'
          } as RoutineJob,
          {
            job_id: 'j-fresh',
            last_run_at: new Date(NOW - 30_000).toISOString(),
            name: '[bot:research] tidy'
          } as RoutineJob
        ]
      })
    )

    const ids = events.map(event => event.id)

    expect(ids).toContain('relay:inflight')
    expect(ids).toContain('mail:local:old-open')
    expect(ids).not.toContain('mail:local:old-done')
    expect(ids.some(id => id.startsWith('routine:j-stale'))).toBe(false)
    expect(ids.some(id => id.startsWith('routine:j-fresh'))).toBe(true)
  })

  it('surfaces a routine failure with its error and a room-bound note with its link', () => {
    const events = deriveInboundEvents(
      signals({
        attention: { at: NOW - 5000, message: 'delivery failed\nstack', reason: 'unreachable' },
        jobs: [
          {
            job_id: 'j-fail',
            last_delivery_error: '',
            last_fire_error: 'backend offline',
            last_run_at: new Date(NOW - 10_000).toISOString(),
            last_status: 'error',
            name: '[bot:research] digest'
          } as RoutineJob
        ],
        notes: [note({ id: 'room-note', room: 'standup', sender: { kind: 'bot', name: 'ops' } })]
      })
    )

    const byId = Object.fromEntries(events.map(event => [event.id, event]))
    const routine = events.find(event => event.kind === 'routine')
    const mail = byId['mail:local:room-note']
    const attention = byId['relay:attention:' + (NOW - 5000)]

    expect(attention.status).toBe('attention')
    expect(attention.reason).toBe('unreachable')
    expect(routine?.status).toBe('failed')
    expect(routine?.summary).toBe('backend offline')
    expect(routine?.action).toBe('routines')
    expect(mail.action).toBe('group')
    expect(mail.room).toBe('standup')
    expect(mail.label).toBe('ops')
  })
})
