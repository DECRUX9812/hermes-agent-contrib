import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readKey } from '@/lib/storage'
import type { AttentionItem } from '@/store/attention-inbox'
import type { CronJob, SessionInfo } from '@/types/hermes'

import {
  $dismissedHomeFeedItemIds,
  collectHomeFeed,
  dismissHomeFeedItem,
  HOME_FEED_DISMISSED_KEY,
  priorityRank,
  resetDismissedHomeFeedItems
} from './home-feed'

const BASE_TIME = 1_700_000_000_000 // Fixed epoch ms for deterministic tests

function makeAttentionItem(
  kind: AttentionItem['kind'],
  id: string,
  overrides?: Partial<AttentionItem>
): AttentionItem {
  return {
    id,
    kind,
    sessionId: 'session-1',
    title: `Title for ${kind} (${id})`,
    ...overrides
  }
}

function makeCronJob(
  id: string,
  overrides?: Partial<CronJob>
): CronJob {
  return {
    enabled: true,
    id,
    name: `Cron Job ${id}`,
    next_run_at: new Date(BASE_TIME + 5 * 60 * 1000).toISOString(),
    schedule_display: 'Every 10m',
    state: 'scheduled',
    ...overrides
  }
}

describe('home-feed store & collector', () => {
  beforeEach(() => {
    resetDismissedHomeFeedItems()
  })

  afterEach(() => {
    resetDismissedHomeFeedItems()
  })

  describe('collectHomeFeed', () => {
    it('returns empty array when sources are empty or missing', () => {
      expect(collectHomeFeed({})).toEqual([])
      expect(collectHomeFeed({ attentionItems: [], cronJobs: [] })).toEqual([])
    })

    it('collects fixtures for each kind properly', () => {
      const attentionKinds: AttentionItem['kind'][] = [
        'approval',
        'clarify',
        'error',
        'secret',
        'sudo',
        'vaultCode',
        'vaultSave',
        'vaultUnlock'
      ]

      const attentionItems = attentionKinds.map(kind =>
        makeAttentionItem(kind, `item-${kind}`, { detail: `Detail for ${kind}` })
      )

      // Overdue cron job: next_run_at was 30 mins ago (> 15m grace)
      const overdueCron = makeCronJob('job-overdue', {
        name: 'Overdue Job',
        next_run_at: new Date(BASE_TIME - 30 * 60 * 1000).toISOString()
      })

      // Due soon cron job: next_run_at is in 5 mins (<= 15m window)
      const dueSoonCron = makeCronJob('job-due-soon', {
        name: 'Due Soon Job',
        next_run_at: new Date(BASE_TIME + 5 * 60 * 1000).toISOString()
      })

      // Pass only one of each category so cap at 5 doesn't truncate this check
      const feedApproval = collectHomeFeed({
        attentionItems: [makeAttentionItem('approval', 'app-1', { detail: 'Allow bash command' })],
        nowMs: BASE_TIME
      })

      expect(feedApproval).toHaveLength(1)
      expect(feedApproval[0].kind).toBe('approval')
      expect(feedApproval[0].caption).toBe('Allow bash command')

      const feedClarify = collectHomeFeed({
        attentionItems: [makeAttentionItem('clarify', 'cla-1', { detail: 'Which branch?' })],
        nowMs: BASE_TIME
      })

      expect(feedClarify[0].kind).toBe('clarify')

      const feedError = collectHomeFeed({
        attentionItems: [makeAttentionItem('error', 'err-1', { detail: 'Connection refused' })],
        nowMs: BASE_TIME
      })

      expect(feedError[0].kind).toBe('error')

      const feedSecret = collectHomeFeed({
        attentionItems: [makeAttentionItem('secret', 'sec-1', { detail: 'GITHUB_TOKEN' })],
        nowMs: BASE_TIME
      })

      expect(feedSecret[0].kind).toBe('secret')

      const feedSudo = collectHomeFeed({
        attentionItems: [makeAttentionItem('sudo', 'sud-1', { detail: 'apt-get install' })],
        nowMs: BASE_TIME
      })

      expect(feedSudo[0].kind).toBe('sudo')

      const feedVaultCode = collectHomeFeed({
        attentionItems: [makeAttentionItem('vaultCode', 'vc-1', { detail: 'Enter 2FA' })],
        nowMs: BASE_TIME
      })

      expect(feedVaultCode[0].kind).toBe('vaultCode')

      const feedVaultSave = collectHomeFeed({
        attentionItems: [makeAttentionItem('vaultSave', 'vs-1', { detail: 'github.com' })],
        nowMs: BASE_TIME
      })

      expect(feedVaultSave[0].kind).toBe('vaultSave')

      const feedVaultUnlock = collectHomeFeed({
        attentionItems: [makeAttentionItem('vaultUnlock', 'vu-1', { detail: 'Bitwarden' })],
        nowMs: BASE_TIME
      })

      expect(feedVaultUnlock[0].kind).toBe('vaultUnlock')

      const feedOverdue = collectHomeFeed({
        cronJobs: [overdueCron],
        nowMs: BASE_TIME
      })

      expect(feedOverdue[0].kind).toBe('cronOverdue')
      expect(feedOverdue[0].title).toBe('Overdue Job')
      expect(feedOverdue[0].cronJobId).toBe('job-overdue')

      const feedDueSoon = collectHomeFeed({
        cronJobs: [dueSoonCron],
        nowMs: BASE_TIME
      })

      expect(feedDueSoon[0].kind).toBe('cronDue')
      expect(feedDueSoon[0].title).toBe('Due Soon Job')
      expect(feedDueSoon[0].cronJobId).toBe('job-due-soon')
    })

    it('enforces priority ordering: approval > prompts > error > cron overdue > cron due within 15min', () => {
      const items = [
        makeAttentionItem('error', 'err-1'),
        makeAttentionItem('clarify', 'cla-1'),
        makeAttentionItem('approval', 'app-1'),
        makeAttentionItem('secret', 'sec-1')
      ]

      const overdueJob = makeCronJob('job-overdue', {
        next_run_at: new Date(BASE_TIME - 30 * 60 * 1000).toISOString()
      })

      const dueSoonJob = makeCronJob('job-due', {
        next_run_at: new Date(BASE_TIME + 10 * 60 * 1000).toISOString()
      })

      const feed = collectHomeFeed({
        attentionItems: items,
        cronJobs: [dueSoonJob, overdueJob],
        nowMs: BASE_TIME
      })

      // We expect order:
      // 1. approval (rank 1)
      // 2. clarify (rank 2)
      // 3. secret (rank 2)
      // 4. error (rank 3)
      // 5. cronOverdue (rank 4)
      // (dueSoonJob would be 6th and capped off by max 5)
      expect(feed).toHaveLength(5)
      expect(feed.map(f => f.kind)).toEqual([
        'approval',
        'clarify',
        'secret',
        'error',
        'cronOverdue'
      ])
    })

    it('caps results at 5 items', () => {
      const approvals = Array.from({ length: 8 }, (_, i) =>
        makeAttentionItem('approval', `app-${i}`)
      )

      const feed = collectHomeFeed({
        attentionItems: approvals,
        nowMs: BASE_TIME
      })

      expect(feed).toHaveLength(5)
      expect(feed.map(f => f.id)).toEqual(['app-0', 'app-1', 'app-2', 'app-3', 'app-4'])
    })

    it('filters out dismissed items by item id or cron job id', () => {
      const items = [
        makeAttentionItem('approval', 'app-1'),
        makeAttentionItem('approval', 'app-2')
      ]

      const cronJobs = [
        makeCronJob('job-1', { next_run_at: new Date(BASE_TIME + 2 * 60 * 1000).toISOString() }),
        makeCronJob('job-2', { next_run_at: new Date(BASE_TIME + 3 * 60 * 1000).toISOString() })
      ]

      // Dismiss app-1 and cron:job-1 (or job-2 directly)
      const feed = collectHomeFeed({
        attentionItems: items,
        cronJobs,
        dismissedIds: ['app-1', 'cron:job-1', 'job-2'],
        nowMs: BASE_TIME
      })

      expect(feed).toHaveLength(1)
      expect(feed[0].id).toBe('app-2')
    })

    it('ignores disabled, paused, or completed cron jobs and distant future jobs', () => {
      const cronJobs = [
        makeCronJob('paused-job', {
          next_run_at: new Date(BASE_TIME + 2 * 60 * 1000).toISOString(),
          state: 'paused'
        }),
        makeCronJob('disabled-job', {
          enabled: false,
          next_run_at: new Date(BASE_TIME + 2 * 60 * 1000).toISOString()
        }),
        makeCronJob('completed-job', {
          next_run_at: new Date(BASE_TIME + 2 * 60 * 1000).toISOString(),
          state: 'completed'
        }),
        makeCronJob('distant-job', {
          next_run_at: new Date(BASE_TIME + 60 * 60 * 1000).toISOString() // 1 hour away
        })
      ]

      const feed = collectHomeFeed({
        cronJobs,
        nowMs: BASE_TIME
      })

      expect(feed).toEqual([])
    })

    it('falls back to session title when attention item detail is missing', () => {
      const items = [
        makeAttentionItem('clarify', 'cla-1', { detail: undefined, sessionId: 'rt-session-1' })
      ]

      const sessions: SessionInfo[] = [
        {
          id: 'rt-session-1',
          message_count: 5,
          title: 'Deployment debugging'
        } as SessionInfo
      ]

      const feed = collectHomeFeed({
        attentionItems: items,
        nowMs: BASE_TIME,
        sessions
      })

      expect(feed).toHaveLength(1)
      expect(feed[0].caption).toBe('Deployment debugging')
    })
  })

  describe('dismissal persistence', () => {
    it('persists dismissed items to storage and updates reactive atom', () => {
      expect($dismissedHomeFeedItemIds.get()).toEqual([])

      dismissHomeFeedItem('card-1')
      expect($dismissedHomeFeedItemIds.get()).toEqual(['card-1'])
      expect(readKey(HOME_FEED_DISMISSED_KEY)).toBe(JSON.stringify(['card-1']))

      // Deduplicates repeated dismiss
      dismissHomeFeedItem('card-1')
      expect($dismissedHomeFeedItemIds.get()).toEqual(['card-1'])

      dismissHomeFeedItem('card-2')
      expect($dismissedHomeFeedItemIds.get()).toEqual(['card-1', 'card-2'])
      expect(readKey(HOME_FEED_DISMISSED_KEY)).toBe(JSON.stringify(['card-1', 'card-2']))

      resetDismissedHomeFeedItems()
      expect($dismissedHomeFeedItemIds.get()).toEqual([])
      expect(readKey(HOME_FEED_DISMISSED_KEY)).toBe(JSON.stringify([]))
    })
  })

  describe('priorityRank', () => {
    it('returns expected numeric ranks', () => {
      expect(priorityRank('approval')).toBe(1)
      expect(priorityRank('clarify')).toBe(2)
      expect(priorityRank('secret')).toBe(2)
      expect(priorityRank('sudo')).toBe(2)
      expect(priorityRank('vaultCode')).toBe(2)
      expect(priorityRank('vaultSave')).toBe(2)
      expect(priorityRank('vaultUnlock')).toBe(2)
      expect(priorityRank('error')).toBe(3)
      expect(priorityRank('cronOverdue')).toBe(4)
      expect(priorityRank('cronDue')).toBe(5)
    })
  })
})
