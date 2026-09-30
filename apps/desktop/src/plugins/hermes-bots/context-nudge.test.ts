import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Long-context nudge (bot-mode topics): a dismissible suggestion on a canonical
// Bot Chat grown long. Invariants under test:
//   1. contextNudgeEligible fires on either signal (long transcript OR heavy
//      token prefix) and stays quiet on small/absent readings.
//   2. A dismissal suppresses the card until the transcript has grown
//      NUDGE_REGROWTH_FACTOR past where it was dismissed — a nag-free
//      reminder, not a permanent hide.
//   3. dismissContextNudge writes only that bot's key; hydrate restores the
//      stored map and ignores malformed entries.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

import {
  $dismissedNudgeCounts,
  contextNudgeEligible,
  contextNudgeSuppressed,
  dismissContextNudge,
  hydrateDismissedNudges,
  NUDGE_MIN_INPUT_TOKENS,
  NUDGE_MIN_MESSAGES,
  NUDGE_REGROWTH_FACTOR
} from './context-nudge'
import { drain, scriptedStorage } from './group-test-utils'
import { setPluginCtx } from './shared'

const STORAGE_KEY = 'bot-context-nudge-dismissed-v1'

let storage: Map<string, unknown>

beforeEach(() => {
  for (const key of Object.keys(host)) {
    delete host[key]
  }

  storage = new Map()
  setPluginCtx(scriptedStorage(storage))
  $dismissedNudgeCounts.set({})
})

afterEach(() => {
  setPluginCtx(null)
})

describe('context nudge eligibility', () => {
  it('fires on a long transcript or a heavy token prefix, not on small chats', () => {
    expect(contextNudgeEligible({ message_count: NUDGE_MIN_MESSAGES })).toBe(true)
    expect(contextNudgeEligible({ input_tokens: NUDGE_MIN_INPUT_TOKENS })).toBe(true)
    expect(contextNudgeEligible({ message_count: NUDGE_MIN_MESSAGES - 1, input_tokens: NUDGE_MIN_INPUT_TOKENS - 1 })).toBe(
      false
    )
    expect(contextNudgeEligible({ message_count: 5 })).toBe(false)
    expect(contextNudgeEligible({})).toBe(false)
    expect(contextNudgeEligible(null)).toBe(false)
    expect(contextNudgeEligible({ message_count: Number.NaN, input_tokens: Number.NaN })).toBe(false)
  })
})

describe('context nudge suppression', () => {
  it('hides until the transcript grows the regrowth factor past dismissal', () => {
    const dismissedAt = 100

    expect(contextNudgeSuppressed(dismissedAt, { message_count: dismissedAt })).toBe(true)
    expect(contextNudgeSuppressed(dismissedAt, { message_count: dismissedAt * NUDGE_REGROWTH_FACTOR - 1 })).toBe(true)
    expect(contextNudgeSuppressed(dismissedAt, { message_count: dismissedAt * NUDGE_REGROWTH_FACTOR })).toBe(false)
    // Never dismissed → never suppressed; a missing size read → stay suppressed.
    expect(contextNudgeSuppressed(null, { message_count: 10_000 })).toBe(false)
    expect(contextNudgeSuppressed(dismissedAt, null)).toBe(true)
    expect(contextNudgeSuppressed(dismissedAt, { input_tokens: 9_000_000 })).toBe(true)
  })
})

describe('dismissed nudge state', () => {
  it('persists a dismissal under the bot’s own key only', async () => {
    dismissContextNudge('bot:research', 120)
    dismissContextNudge('bot:ops', 40)

    await drain(() => !storage.has(STORAGE_KEY))

    expect($dismissedNudgeCounts.get()).toEqual({ 'bot:research': 120, 'bot:ops': 40 })
    expect(storage.get(STORAGE_KEY)).toEqual({ 'bot:research': 120, 'bot:ops': 40 })
  })

  it('restores stored dismissals on hydrate and shrugs off malformed entries', async () => {
    storage.set(STORAGE_KEY, { 'bot:research': 120, bad: 'x', neg: -1 })

    hydrateDismissedNudges()
    await drain(() => Object.keys($dismissedNudgeCounts.get()).length < 1)

    expect($dismissedNudgeCounts.get()).toEqual({ 'bot:research': 120 })
  })
})
