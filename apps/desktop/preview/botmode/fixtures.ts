/**
 * DEV ONLY — fixture data for the offline Bot Mode screenshot harness.
 *
 * Representative but static: several bots, one active room with a handful of
 * messages, a needs-you flag, routine runs (tasks timeline), and a recent
 * session (history tab). Times are relative to load so day dividers
 * (Today / Yesterday) paint the way the live app paints them.
 */
import type { GroupMember, RosterRow, RoutineJob } from '@/plugins/hermes-bots/types'

const HOUR = 3600_000
const now = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()

export const FIXTURE_ROOM = 'Design Room'

export const FIXTURE_ROSTER: RosterRow[] = [
  {
    connectionId: 'local',
    description: 'Deep-dive research runs with cited sources',
    last_session: {
      id: 'sess-morning-brief',
      last_active: Math.floor(now / 1000) - 3600,
      message_count: 42,
      preview: 'Drafted the Q3 layout comparison with citations.',
      title: 'Morning brief write-up'
    },
    name: 'research'
  },
  {
    connectionId: 'local',
    description: 'Build, repair, and verify passes',
    last_session: {
      id: 'sess-build-health',
      last_active: Math.floor(now / 1000) - 7200,
      message_count: 17,
      preview: 'Fixed the rail overlap and re-ran checks.',
      title: 'Rail overlap fix'
    },
    name: 'builder'
  },
  {
    connectionId: 'local',
    description: 'Meeting notes and decision logs',
    last_session: {
      id: 'sess-staff-notes',
      last_active: Math.floor(now / 1000) - 26 * 3600,
      message_count: 9,
      preview: 'Staff sync notes: rail scope agreed for Friday.',
      title: 'Staff sync notes'
    },
    name: 'scribe'
  },
  {
    connectionId: 'local',
    description: 'Overnight web watch, quiet until something moves',
    name: 'scout'
  }
]

export const FIXTURE_MEMBERS: GroupMember[] = FIXTURE_ROSTER.slice(0, 3).map(bot => ({
  connectionId: bot.connectionId,
  name: bot.name
}))

export const FIXTURE_LOG = [
  {
    at: now - 5 * HOUR,
    from: { kind: 'user' as const, name: 'You' },
    id: 'm1',
    text: 'Kickoff: the new rail layout is in scope for Friday. Research, pull the options.',
    thread: 'a'
  },
  {
    at: now - 5 * HOUR + 9 * 60_000,
    from: { kind: 'member' as const, name: 'research' },
    id: 'm2',
    text: 'Pulled three layout options with trade-offs. Summary: keep the right rail, move tasks above history, collapse saved into a chip row.',
    thread: 'a'
  },
  {
    at: now - 4 * HOUR,
    from: { kind: 'member' as const, name: 'builder' },
    id: 'm3',
    text: '@user the middle option needs a gateway change before Friday. Flagging before I start cutting code.',
    thread: 'a'
  },
  {
    at: now - 3 * HOUR,
    from: { kind: 'member' as const, name: 'scribe' },
    id: 'm4',
    text: 'Noted decisions so far: 1) keep the right rail, 2) move tasks above history. Open question: gateway change for the middle option.',
    thread: 'a'
  },
  {
    at: now - 2 * HOUR,
    from: { kind: 'user' as const, name: 'You' },
    id: 'm5',
    text: 'Agreed on 1) and 2). Ship the middle option behind the flag; gateway change can land next week.',
    thread: 'a'
  },
  {
    at: now - 1 * HOUR,
    from: { kind: 'member' as const, name: 'research' },
    id: 'm6',
    text: 'On it — first pass will be ready for review tonight with the citations attached.',
    thread: 'a'
  }
]

export const ROUTINE_JOBS: RoutineJob[] = [
  {
    enabled: true,
    job_id: 'j-brief',
    last_run_at: iso(now - 1 * HOUR),
    last_status: 'ok',
    name: '[bot:research] Morning brief',
    schedule: 'every 1h',
    state: 'scheduled'
  },
  {
    enabled: true,
    job_id: 'j-triage',
    last_run_at: iso(now - 3 * HOUR),
    last_status: 'ok',
    name: '[bot:research] Inbox triage',
    schedule: 'every 6h',
    state: 'scheduled'
  },
  {
    enabled: true,
    job_id: 'j-audit',
    last_fire_error: 'gateway timeout',
    last_run_at: iso(now - 26 * HOUR),
    last_status: 'error',
    name: '[bot:research] Nightly audit',
    schedule: 'every 1d',
    state: 'scheduled'
  },
  {
    enabled: true,
    job_id: 'j-digest',
    last_run_at: iso(now - 50 * 60_000),
    last_status: 'ok',
    name: '[bot:research] Evening digest',
    schedule: 'every 12h',
    state: 'scheduled'
  }
]
