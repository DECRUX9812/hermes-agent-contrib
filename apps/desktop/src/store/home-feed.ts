import { atom, computed } from 'nanostores'

import { jobState, jobTitle, nextRunOverdueMs } from '@/app/cron/job-state'
import { persistString, storedString } from '@/lib/storage'
import { $attentionItems, type AttentionItem, type AttentionItemKind } from '@/store/attention-inbox'
import { $cronJobs } from '@/store/cron'
import { $sessions } from '@/store/session'
import { storedSessionIdForRuntimeId } from '@/store/session-states'
import type { CronJob, SessionInfo } from '@/types/hermes'

export type HomeFeedItemKind =
  | AttentionItemKind
  | 'cronOverdue'
  | 'cronDue'

export interface HomeFeedItem {
  /** Stable row id: item.id for attention items, `cron:${job.id}` for cron jobs. */
  id: string
  kind: HomeFeedItemKind
  /** Primary label — command, question, site, job title. */
  title: string
  /** Secondary label — detail, session title, schedule expression. */
  caption?: string
  /** Runtime session id if associated with a session. */
  sessionId?: string | null
  /** Cron job id if associated with a cron job. */
  cronJobId?: string
  /** Raw source item for debugging/inspection. */
  rawAttentionItem?: AttentionItem
  rawCronJob?: CronJob
}

export interface HomeFeedSources {
  attentionItems?: readonly AttentionItem[]
  cronJobs?: readonly CronJob[]
  dismissedIds?: readonly string[] | ReadonlySet<string>
  nowMs?: number
  sessions?: readonly SessionInfo[]
}

export const HOME_FEED_DISMISSED_KEY = 'hermes.desktop.home-feed.dismissed.v1'
export const MAX_FEED_ITEMS = 5
const CRON_DUE_WINDOW_MS = 15 * 60 * 1000

/**
 * Priority rank for feed items:
 * 1: approval
 * 2: clarify / secret / sudo / vault prompts
 * 3: error
 * 4: cron overdue
 * 5: cron due within 15min
 */
export function priorityRank(kind: HomeFeedItemKind): number {
  switch (kind) {
    case 'approval':
      return 1

    case 'clarify':

    case 'secret':

    case 'sudo':

    case 'vaultCode':

    case 'vaultSave':

    case 'vaultUnlock':
      return 2

    case 'error':
      return 3

    case 'cronOverdue':
      return 4

    case 'cronDue':
      return 5

    default:
      return 6
  }
}

/**
 * Pure collector that aggregates attention items and due cron jobs,
 * applies priority ordering, filters dismissed items, and caps at 5.
 */
export function collectHomeFeed(src: HomeFeedSources): HomeFeedItem[] {
  const {
    attentionItems = [],
    cronJobs = [],
    dismissedIds = [],
    nowMs = Date.now(),
    sessions = []
  } = src

  const dismissedSet = dismissedIds instanceof Set ? dismissedIds : new Set(dismissedIds)
  const items: HomeFeedItem[] = []

  // 1. Attention items (approvals, prompts, errors)
  for (const item of attentionItems) {
    if (dismissedSet.has(item.id)) {
      continue
    }

    let caption = item.detail

    if (!caption && item.sessionId) {
      const storedId = storedSessionIdForRuntimeId(item.sessionId) ?? item.sessionId
      const session = sessions.find(s => s.id === storedId || s.id === item.sessionId)

      if (session?.title) {
        caption = session.title
      }
    }

    items.push({
      caption,
      id: item.id,
      kind: item.kind,
      rawAttentionItem: item,
      sessionId: item.sessionId,
      title: item.title
    })
  }

  // 2. Cron jobs (overdue > due within 15min)
  for (const job of cronJobs) {
    const state = jobState(job)

    if (state === 'paused' || state === 'completed' || state === 'disabled' || job.enabled === false) {
      continue
    }

    const cronFeedId = `cron:${job.id}`

    if (dismissedSet.has(cronFeedId) || dismissedSet.has(job.id)) {
      continue
    }

    const overdueMs = nextRunOverdueMs(job, nowMs)
    const isOverdue = overdueMs !== null

    let isDueSoon = false

    if (!isOverdue && job.next_run_at) {
      const at = Date.parse(job.next_run_at)

      if (!Number.isNaN(at)) {
        isDueSoon = at <= nowMs + CRON_DUE_WINDOW_MS
      }
    }

    if (!isOverdue && !isDueSoon) {
      continue
    }

    let caption = job.schedule_display || job.schedule?.display || job.schedule?.expr

    if (!caption) {
      caption = job.prompt || (isOverdue ? 'Overdue' : 'Due soon')
    }

    items.push({
      caption,
      cronJobId: job.id,
      id: cronFeedId,
      kind: isOverdue ? 'cronOverdue' : 'cronDue',
      rawCronJob: job,
      title: jobTitle(job)
    })
  }

  // Priority sort (stable sort preserves insertion order within the same priority tier)
  items.sort((a, b) => priorityRank(a.kind) - priorityRank(b.kind))

  return items.slice(0, MAX_FEED_ITEMS)
}

function initialDismissedIds(): string[] {
  const raw = storedString(HOME_FEED_DISMISSED_KEY)

  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)

    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export const $dismissedHomeFeedItemIds = atom<string[]>(initialDismissedIds())

export function dismissHomeFeedItem(id: string): void {
  const current = $dismissedHomeFeedItemIds.get()

  if (current.includes(id)) {
    return
  }

  const next = [...current, id]
  $dismissedHomeFeedItemIds.set(next)
  persistString(HOME_FEED_DISMISSED_KEY, JSON.stringify(next))
}

export function resetDismissedHomeFeedItems(): void {
  $dismissedHomeFeedItemIds.set([])
  persistString(HOME_FEED_DISMISSED_KEY, JSON.stringify([]))
}

export const $homeFeedItems = computed(
  [$attentionItems, $cronJobs, $dismissedHomeFeedItemIds, $sessions],
  (attentionItems, cronJobs, dismissedIds, sessions) =>
    collectHomeFeed({
      attentionItems,
      cronJobs,
      dismissedIds,
      sessions
    })
)
