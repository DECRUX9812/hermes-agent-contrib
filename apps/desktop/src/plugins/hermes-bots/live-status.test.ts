/**
 * A1 — the roster row's live status line. The invariants:
 *  - the line describes a LIVE signal (dot state, routine run, group round,
 *    worker heartbeat), never a clock: fresh last_active alone can never
 *    paint "working" — a finished turn leaves activity behind;
 *  - priority follows what the user should see first: needs-input outranks
 *    everything, a stalled/working turn outranks background machinery;
 *  - when nothing reports, the fallback is 'idle' (reachable) or 'unknown'
 *    (unreachable) — the row never invents work.
 *
 * A2 — the attention rollup. The badge counts the session owner the events
 * PROVED, so a same-named bot on another connection never inherits items it
 * doesn't own, and the hidden canonical chat contributes its unread marker
 * even when the owner ladder cannot resolve it.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  botAttentionCount,
  botLiveStatus,
  runningRoutineTitles,
  sessionOwnerMatchesBot
} from './live-status'
import type { RosterRow } from './types'

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom, computed } = await import('nanostores')

  return {
    atom,
    computed,
    host: { state: { connectionId: { get: () => 'local' } } },
    jobState: (job: { enabled?: boolean; state?: null | string }) =>
      (typeof job.state === 'string' ? job.state.trim() : '') || (job.enabled === false ? 'disabled' : 'scheduled'),
    queryClient: undefined,
    useQuery: vi.fn(),
    useValue: vi.fn()
  }
})

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'hermes-bots' }))

const bot = (fields: Partial<RosterRow>) => fields as RosterRow

describe('botLiveStatus', () => {
  it('needs-input outranks a live turn and an in-flight routine', () => {
    expect(
      botLiveStatus({ dot: 'needs-input', group: true, routines: ['Sweep'], tool: 'terminal' }).kind
    ).toBe('needs-input')
  })

  it('reports the turn phase the canonical dot carries, with the tool when known', () => {
    expect(botLiveStatus({ dot: 'working' })).toEqual({ detail: undefined, kind: 'working' })
    expect(botLiveStatus({ dot: 'working', tool: 'web_search' })).toEqual({
      detail: 'web_search',
      kind: 'working'
    })
    // Stalled is honest, not hidden: the turn is live but quiet.
    expect(botLiveStatus({ dot: 'stalled' }).kind).toBe('stalled')
  })

  it('surfaces an in-flight routine when the chat itself is quiet', () => {
    expect(botLiveStatus({ routines: ['Inbox sweep'] })).toEqual({ detail: 'Inbox sweep', kind: 'routine' })
    expect(botLiveStatus({ routines: [] }).kind).toBe('idle')
  })

  it('reads group participation and delegated workers as activity', () => {
    expect(botLiveStatus({ group: true }).kind).toBe('group')
    expect(botLiveStatus({ worker: true }).kind).toBe('delegated')
    expect(botLiveStatus({ dot: 'background' }).kind).toBe('background')
  })

  it('falls back to idle on a reachable source — recency alone never claims busy', () => {
    // A row with a fresh last_active and no live signal is QUIET: a finished
    // turn leaves last_active behind forever, so the clock cannot speak.
    expect(botLiveStatus({ reachable: true }).kind).toBe('idle')
    expect(botLiveStatus({}).kind).toBe('idle')
  })

  it('reads unknown on an unreachable source rather than guessing idle', () => {
    expect(botLiveStatus({ reachable: false }).kind).toBe('unknown')
    // A live claim still wins over reachability — stale-proof: a blocked bot
    // that was mid-turn stays reported.
    expect(botLiveStatus({ dot: 'working', reachable: false }).kind).toBe('working')
  })
})

describe('runningRoutineTitles', () => {
  const jobs = [
    { id: 'j1', enabled: true, name: '[bot:ops] Inbox sweep', state: 'running' },
    { id: 'j2', enabled: true, name: '[bot:other] Ledger', state: 'running' },
    { id: 'j3', enabled: true, name: '[bot:ops] Old run', state: 'completed' },
    { id: 'j4', enabled: true, name: 'Untagged job', state: 'running' }
  ]

  const ops = bot({ name: 'ops' })

  it('lists only RUNNING jobs tagged for this bot', () => {
    expect(runningRoutineTitles(jobs, ops)).toEqual(['Inbox sweep'])
    expect(runningRoutineTitles(jobs, bot({ name: 'other' }))).toEqual(['Ledger'])
  })

  it('ignores the untagged and the finished', () => {
    expect(runningRoutineTitles([], ops)).toEqual([])
    expect(runningRoutineTitles(jobs, bot({ name: 'nobody' }))).toEqual([])
  })
})

describe('botAttentionCount', () => {
  const base = { canonicalDot: undefined, canonicalOwnedByBot: false, flagged: false }

  it('sums the owner-scoped counts under every key the bot can publish', () => {
    const local = bot({ connectionId: 'local', name: 'ops' })

    expect(
      botAttentionCount(local, {
        ...base,
        activeConnectionId: 'local',
        ownerCounts: { 'conn:local::ops': 2, ops: 1 }
      })
    ).toBe(3)
  })

  it('a same-named bot on another connection inherits nothing', () => {
    const remote = bot({ connectionId: 'ssh-1', name: 'ops', remoteSource: true })

    expect(
      botAttentionCount(remote, {
        ...base,
        activeConnectionId: 'local',
        ownerCounts: { ops: 4, 'conn:local::ops': 1, 'conn:ssh-1::ops': 2 }
      })
    ).toBe(2)
  })

  it('adds the hidden canonical chat\'s unread dot only when the ladder missed it', () => {
    const local = bot({ connectionId: 'local', name: 'ops' })

    // Owner ladder never sees the hidden chat: the dot counts here.
    expect(
      botAttentionCount(local, {
        ...base,
        activeConnectionId: 'local',
        canonicalDot: 'unread',
        ownerCounts: {}
      })
    ).toBe(1)

    // …but when the session DID resolve to this bot, ownerCounts already
    // holds it — adding again would double the badge.
    expect(
      botAttentionCount(local, {
        ...base,
        activeConnectionId: 'local',
        canonicalDot: 'unread',
        canonicalOwnedByBot: true,
        ownerCounts: { 'conn:local::ops': 1 }
      })
    ).toBe(1)
  })

  it('counts the recorded failure flag once', () => {
    const local = bot({ connectionId: 'local', name: 'ops' })

    expect(botAttentionCount(local, { ...base, activeConnectionId: 'local', flagged: true, ownerCounts: {} })).toBe(1)
  })
})

describe('sessionOwnerMatchesBot', () => {
  it('matches on connection AND profile — never profile alone across sources', () => {
    const remote = bot({ connectionId: 'ssh-1', name: 'ops' })

    expect(sessionOwnerMatchesBot({ connectionId: 'ssh-1', profile: 'ops' }, remote, 'local')).toBe(true)
    expect(sessionOwnerMatchesBot({ connectionId: 'local', profile: 'ops' }, remote, 'local')).toBe(false)
    // A bare-profile owner (primary socket) reaches only ambient bots.
    expect(sessionOwnerMatchesBot({ connectionId: '', profile: 'ops' }, remote, 'local')).toBe(false)
    expect(
      sessionOwnerMatchesBot({ connectionId: '', profile: 'ops' }, bot({ connectionId: 'local', name: 'ops' }), 'local')
    ).toBe(true)
  })

  it('honours targetProfile for aliased remote routes', () => {
    const remote = bot({ connectionId: 'ssh-1', name: 'ops-2' })

    expect(
      sessionOwnerMatchesBot({ connectionId: 'ssh-1', profile: 'ops', targetProfile: 'ops-2' }, remote, 'local')
    ).toBe(true)
  })
})
