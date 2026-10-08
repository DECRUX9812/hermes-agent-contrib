import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Team OS slice 5 — the universal Needs You index.
// Invariants under test:
//   1. Only the three explicit categories are ever indexed; a malformed or
//      unknown event normalizes to null and is DROPPED, never recorded.
//   2. The index stays content-free: a classified reason + a bounded ref.
//   3. Recording an artifact-review event attaches the artifact ref and NEVER
//      flips the task status it hangs beside.
//   4. Hydration tolerates garbage — a corrupt blob drops the bad entries (or
//      the whole read) and never throws.
//   5. Cards rank handoff-failed > blocked > artifact-review and dedupe by id.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

import { drain, scriptedStorage } from './group-test-utils'
import {
  $needsYouIndex,
  applyNeedsYouEvent,
  clearNeedsYou,
  hydrateNeedsYou,
  hydrateNeedsYouIndex,
  NEEDS_YOU_PER_BOT,
  NEEDS_YOU_TEXT_MAX,
  needsYouEntriesFor,
  normalizeNeedsYouEvent,
  recordNeedsYouEvent
} from './needs-you'
import type { NeedsYouSubject } from './needs-you'
import { setPluginCtx } from './shared'

const STORAGE_KEY = 'needs-you-index-v1'
const NOW = 1_700_000_000_000

let storage: Map<string, unknown>

const event = (fields: Record<string, unknown> = {}) => ({
  at: NOW,
  bot: 'legacy::alpha',
  category: 'handoff-failed',
  id: 'handoff:e1',
  ...fields
})

beforeEach(() => {
  for (const key of Object.keys(host)) {
    delete host[key]
  }

  storage = new Map()
  setPluginCtx(scriptedStorage(storage))
  $needsYouIndex.set({})
})

afterEach(() => {
  setPluginCtx(null)
})

describe('normalizeNeedsYouEvent', () => {
  it('accepts the three explicit categories with a classified reason and ref', () => {
    expect(normalizeNeedsYouEvent(event(), NOW)).toEqual(event())
    expect(normalizeNeedsYouEvent(event({ category: 'blocked', id: 'dep:1', ref: 'task-9' }), NOW)?.category).toBe(
      'blocked'
    )
    expect(
      normalizeNeedsYouEvent(event({ category: 'artifact-review', id: 'art:1', ref: 'file:///tmp/report.md' }), NOW)
        ?.ref
    ).toBe('file:///tmp/report.md')
  })

  it('drops unknown categories, missing identity and malformed timestamps', () => {
    const drop: unknown[] = [
      null,
      undefined,
      'handoff-failed',
      42,
      [],
      {},
      event({ category: 'needs-input' }),
      event({ category: 'HANDOFF-FAILED' }),
      event({ category: undefined }),
      event({ bot: '' }),
      event({ bot: '   ' }),
      event({ bot: 7 }),
      event({ id: '' }),
      event({ at: Number.NaN }),
      event({ at: 'yesterday' })
    ]

    for (const raw of drop) {
      expect(normalizeNeedsYouEvent(raw, NOW)).toBeNull()
    }
  })

  it('bounds every free-text field so the index can never become a payload channel', () => {
    const entry = normalizeNeedsYouEvent(
      event({ reason: 'x'.repeat(NEEDS_YOU_TEXT_MAX * 3), ref: `file:///${'y'.repeat(NEEDS_YOU_TEXT_MAX * 3)}` }),
      NOW
    )

    expect(entry?.reason).toHaveLength(NEEDS_YOU_TEXT_MAX)
    expect(entry?.ref).toHaveLength(NEEDS_YOU_TEXT_MAX)
    expect(normalizeNeedsYouEvent(event({ reason: '   ' }), NOW)?.reason).toBeUndefined()
  })
})

describe('recordNeedsYouEvent', () => {
  it('surfaces a failed handoff with its category and classified reason', () => {
    expect(recordNeedsYouEvent(event({ reason: 'provider_auth_or_access' }), NOW)).toBe(true)
    expect($needsYouIndex.get()['legacy::alpha']).toEqual([
      { ...event(), reason: 'provider_auth_or_access' }
    ])
  })

  it('drops a malformed or unknown event without touching the index', () => {
    recordNeedsYouEvent(event(), NOW)

    for (const raw of [null, {}, event({ category: 'approval' }), event({ bot: '' })]) {
      expect(recordNeedsYouEvent(raw, NOW)).toBe(false)
    }

    expect(Object.keys($needsYouIndex.get())).toEqual(['legacy::alpha'])
    expect($needsYouIndex.get()['legacy::alpha']).toHaveLength(1)
  })

  it('replaces its own copy on a redelivered event instead of stacking', () => {
    recordNeedsYouEvent(event({ reason: 'first' }), NOW)
    recordNeedsYouEvent(event({ reason: 'second' }), NOW + 1)

    expect($needsYouIndex.get()['legacy::alpha']).toHaveLength(1)
    expect($needsYouIndex.get()['legacy::alpha'][0].reason).toBe('second')
  })

  it('keeps only the highest-ranked cards per bot, up to the per-bot bound', () => {
    recordNeedsYouEvent(event({ id: 'a1', category: 'artifact-review', at: NOW + 1 }), NOW + 1)
    recordNeedsYouEvent(event({ id: 'b1', category: 'blocked', at: NOW + 2 }), NOW + 2)
    recordNeedsYouEvent(event({ id: 'h1', category: 'handoff-failed', at: NOW + 3 }), NOW + 3)
    recordNeedsYouEvent(event({ id: 'h2', category: 'handoff-failed', at: NOW + 4 }), NOW + 4)
    recordNeedsYouEvent(event({ id: 'a2', category: 'artifact-review', at: NOW + 5 }), NOW + 5)

    const entries = $needsYouIndex.get()['legacy::alpha']

    expect(entries).toHaveLength(NEEDS_YOU_PER_BOT)
    expect(entries.map(entry => entry.category)).toEqual([
      'handoff-failed',
      'handoff-failed',
      'blocked',
      'artifact-review'
    ])
    // Newest first inside a rank; the oldest artifact card is the one dropped.
    expect(entries.map(entry => entry.id)).toEqual(['h2', 'h1', 'b1', 'a2'])
  })

  it('persists the index through plugin storage', async () => {
    recordNeedsYouEvent(event(), NOW)
    await drain(() => !storage.has(STORAGE_KEY))

    expect(storage.get(STORAGE_KEY)).toEqual($needsYouIndex.get())
  })
})

describe('clearNeedsYou', () => {
  it('clears one category and leaves the other cards in place', () => {
    recordNeedsYouEvent(event({ id: 'h1' }), NOW)
    recordNeedsYouEvent(event({ id: 'b1', category: 'blocked' }), NOW + 1)

    expect(clearNeedsYou('legacy::alpha', 'handoff-failed')).toBe(true)
    expect($needsYouIndex.get()['legacy::alpha'].map(entry => entry.category)).toEqual(['blocked'])
  })

  it('drops the bot entirely when its last card goes, and no-ops elsewhere', () => {
    recordNeedsYouEvent(event(), NOW)

    expect(clearNeedsYou('legacy::alpha')).toBe(true)
    expect($needsYouIndex.get()['legacy::alpha']).toBeUndefined()
    expect(clearNeedsYou('legacy::alpha')).toBe(false)
    expect(clearNeedsYou('', 'handoff-failed')).toBe(false)
  })
})

describe('applyNeedsYouEvent', () => {
  it('attaches an artifact ref beside the task status and NEVER flips that status', () => {
    const task: NeedsYouSubject = { status: 'review' }

    const next = applyNeedsYouEvent(
      task,
      event({ category: 'artifact-review', id: 'art:1', ref: 'file:///tmp/report.md' }),
      NOW
    )

    expect(next).not.toBe(task)
    expect(next.status).toBe('review')
    expect(task.status).toBe('review')
    expect(next.entries?.[0]).toMatchObject({ category: 'artifact-review', ref: 'file:///tmp/report.md' })
  })

  it('returns the subject untouched for a malformed or unknown event', () => {
    const task: NeedsYouSubject = { status: 'working', entries: [] }

    expect(applyNeedsYouEvent(task, { category: 'artifact' }, NOW)).toBe(task)
    expect(applyNeedsYouEvent(task, null, NOW)).toBe(task)
    expect(task).toEqual({ status: 'working', entries: [] })
  })
})

describe('hydration', () => {
  it('keeps valid entries and drops malformed or unknown ones without throwing', () => {
    const index = hydrateNeedsYouIndex(
      {
        'legacy::alpha': [
          event(),
          { ...event({ id: 'bad' }), category: 'summarize' },
          { ...event({ id: 'worse' }), bot: 'legacy::evil' },
          null,
          'nope',
          { id: 'no-category' }
        ],
        'legacy::bravo': 'not-an-array',
        'legacy::charlie': [event({ id: 'c1', bot: 'legacy::charlie', category: 'blocked' })]
      },
      NOW
    )

    // Unknown categories, non-objects and a bucket-less entry are dropped; a
    // valid entry naming ANOTHER bot is re-stamped into its bucket instead of
    // escaping it.
    expect(index['legacy::alpha']).toHaveLength(2)
    expect(index['legacy::alpha'].map(present => present.id)).toEqual(['handoff:e1', 'worse'])
    expect(index['legacy::alpha'].every(present => present.bot === 'legacy::alpha')).toBe(true)
    expect(index['legacy::bravo']).toBeUndefined()
    expect(index['legacy::charlie']).toHaveLength(1)
    expect(() => hydrateNeedsYouIndex(undefined, NOW)).not.toThrow()
    expect(hydrateNeedsYouIndex('garbage', NOW)).toEqual({})
    expect(hydrateNeedsYouIndex(['garbage'], NOW)).toEqual({})
    expect(hydrateNeedsYouIndex(42, NOW)).toEqual({})
  })

  it('restores the stored index and ignores a corrupt blob', async () => {
    storage.set(STORAGE_KEY, { 'legacy::alpha': [event()] })
    hydrateNeedsYou()
    await drain(() => !$needsYouIndex.get()['legacy::alpha'])

    expect($needsYouIndex.get()['legacy::alpha']).toHaveLength(1)

    $needsYouIndex.set({})
    storage.set(STORAGE_KEY, 'garbage')
    hydrateNeedsYou()
    await drain(() => false)

    expect($needsYouIndex.get()).toEqual({})
  })
})

describe('needsYouEntriesFor', () => {
  const index = {
    alpha: [
      { at: NOW, bot: 'alpha', category: 'artifact-review' as const, id: 'a1' },
      { at: NOW, bot: 'alpha', category: 'blocked' as const, id: 'b1', ref: 'task-9' }
    ],
    'local::alpha': [{ at: NOW, bot: 'local::alpha', category: 'handoff-failed' as const, id: 'h1', reason: 'x' }],
    bravo: [{ at: NOW, bot: 'bravo', category: 'blocked' as const, id: 'other' }]
  }

  it('reads every key the row publishes under, ranked and deduped', () => {
    expect(needsYouEntriesFor(index, ['alpha', 'local::alpha', 'legacy::alpha']).map(entry => entry.id)).toEqual([
      'h1',
      'b1',
      'a1'
    ])
    expect(needsYouEntriesFor(index, ['alpha', 'local::alpha'], 1).map(entry => entry.id)).toEqual(['h1'])
    expect(needsYouEntriesFor(index, ['missing'])).toEqual([])
    expect(needsYouEntriesFor(undefined, ['alpha'])).toEqual([])
    expect(needsYouEntriesFor({ alpha: [null as never] }, ['alpha'])).toEqual([])
  })
})
