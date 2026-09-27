import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Teaching-moment dismissal (revamp G9): a cleared tip stays cleared per bot
// on this device — persisted to plugin storage, never to the backend.
// Invariants under test:
//   1. dismissBotTip writes the cleared id under the bot's own key and leaves
//      every other bot's dismissal set untouched.
//   2. hydrateDismissedBotTips restores what storage holds and ignores a
//      malformed value — a corrupt blob must not break the first-run tips.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

import { $dismissedBotTips, dismissBotTip, hydrateDismissedBotTips } from './bot-tips'
import { drain, scriptedStorage } from './group-test-utils'
import { setPluginCtx } from './shared'

const STORAGE_KEY = 'bot-tips-dismissed-v1'

let storage: Map<string, unknown>

beforeEach(() => {
  for (const key of Object.keys(host)) {
    delete host[key]
  }

  storage = new Map()
  setPluginCtx(scriptedStorage(storage))
  $dismissedBotTips.set({})
})

afterEach(() => {
  setPluginCtx(null)
})

describe('dismissed tip state', () => {
  it('persists a dismissal under the bot’s own key only', async () => {
    dismissBotTip('bot:research', 'computer')
    dismissBotTip('bot:research', 'schedule')
    dismissBotTip('bot:ops', 'computer')

    await drain(() => !storage.has(STORAGE_KEY))

    expect($dismissedBotTips.get()['bot:research']).toEqual(['computer', 'schedule'])
    expect($dismissedBotTips.get()['bot:ops']).toEqual(['computer'])

    const persisted = storage.get(STORAGE_KEY) as Record<string, string[]>
    expect(persisted['bot:research']).toEqual(['computer', 'schedule'])
    expect(persisted['bot:ops']).toEqual(['computer'])
  })

  it('restores stored dismissals on hydrate and shrugs off a malformed blob', async () => {
    storage.set(STORAGE_KEY, { 'bot:research': ['computer', 'bogus-id'], other: 'not-an-array' })

    hydrateDismissedBotTips()
    await drain(() => Object.keys($dismissedBotTips.get()).length < 1)

    expect($dismissedBotTips.get()['bot:research']).toEqual(['computer', 'bogus-id'])
    expect($dismissedBotTips.get().other).toBeUndefined()

    $dismissedBotTips.set({})
    storage.set(STORAGE_KEY, 'garbage')
    hydrateDismissedBotTips()
    await drain(() => false)

    expect($dismissedBotTips.get()).toEqual({})
  })
})
