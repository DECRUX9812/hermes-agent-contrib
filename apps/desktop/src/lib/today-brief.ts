import type { SessionDotState } from '@/store/session-dot-state'
import type { CronJob, SessionInfo } from '@/types/hermes'

/**
 * The "Today" brief on an empty chat: a handful of cards, one concern each —
 * not a feed (ChatGPT Pulse / Gemini Daily Brief / Copilot Home all converged
 * on this). Everything is a view over signals the app already holds: the
 * sidebar's per-session dot state and the cron list. No new RPC, nothing
 * generated, so it is instant and never wrong about what it shows.
 */

export type BriefCardId = 'finished' | 'needsYou' | 'recent' | 'running' | 'scheduled'

export interface TodayBrief {
  /** Waiting on the user: a question, an approval, a stalled turn. */
  needsYou: SessionInfo[]
  /** Working right now (including background runs and delegations). */
  running: SessionInfo[]
  /** Finished while the user was elsewhere and not yet read. */
  finished: SessionInfo[]
  /** Enabled scheduled jobs due in the next 24 hours, soonest first. */
  scheduled: CronJob[]
  /** Pick up where you left off — only when nothing above has anything. */
  recent: SessionInfo[]
  /** Full counts per card: the lists above are capped, the badge is not. */
  totals: Record<BriefCardId, number>
}

export const BRIEF_ROW_LIMIT = 3

const DAY_MS = 24 * 60 * 60 * 1000

const recency = (session: SessionInfo) => session.last_active || session.started_at || 0

const byRecency = (a: SessionInfo, b: SessionInfo) => recency(b) - recency(a)

function inState(
  sessions: readonly SessionInfo[],
  dotById: Readonly<Record<string, SessionDotState>>,
  states: ReadonlySet<SessionDotState>
): SessionInfo[] {
  return sessions.filter(session => states.has(dotById[session.id] ?? 'idle')).sort(byRecency)
}

const NEEDS_YOU = new Set<SessionDotState>(['needs-input', 'stalled'])
const RUNNING = new Set<SessionDotState>(['working', 'background'])
const FINISHED = new Set<SessionDotState>(['unread'])

export function deriveTodayBrief({
  cronJobs,
  dotById,
  now = Date.now(),
  sessions
}: {
  cronJobs: readonly CronJob[]
  dotById: Readonly<Record<string, SessionDotState>>
  now?: number
  sessions: readonly SessionInfo[]
}): TodayBrief {
  const live = sessions.filter(session => !session.archived)
  const needsYou = inState(live, dotById, NEEDS_YOU)
  const running = inState(live, dotById, RUNNING)
  const finished = inState(live, dotById, FINISHED)

  const scheduled = cronJobs
    .filter(job => job.enabled && job.next_run_at)
    .map(job => ({ job, at: Date.parse(String(job.next_run_at)) }))
    .filter(({ at }) => Number.isFinite(at) && at >= now - 60_000 && at - now <= DAY_MS)
    .sort((a, b) => a.at - b.at)
    .map(({ job }) => job)

  const busy = needsYou.length + running.length + finished.length + scheduled.length > 0
  const recent = busy ? [] : [...live].sort(byRecency)

  return {
    needsYou: needsYou.slice(0, BRIEF_ROW_LIMIT),
    running: running.slice(0, BRIEF_ROW_LIMIT),
    finished: finished.slice(0, BRIEF_ROW_LIMIT),
    scheduled: scheduled.slice(0, BRIEF_ROW_LIMIT),
    recent: recent.slice(0, BRIEF_ROW_LIMIT),
    totals: {
      needsYou: needsYou.length,
      running: running.length,
      finished: finished.length,
      scheduled: scheduled.length,
      recent: recent.length
    }
  }
}

export type Greeting = 'afternoon' | 'evening' | 'morning' | 'night'

/** Time-of-day greeting for the brief's headline (local clock). */
export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) {
    return 'morning'
  }

  if (hour >= 12 && hour < 17) {
    return 'afternoon'
  }

  if (hour >= 17 && hour < 22) {
    return 'evening'
  }

  return 'night'
}
