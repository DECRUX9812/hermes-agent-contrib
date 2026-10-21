import { beforeEach, describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import { $composerSuggestionsBySession } from '../composer-suggestions'
import { $sessions } from '../session'

import {
  $proactiveNudgesEnabled,
  __resetNudgesForTests,
  nudgeChips,
  processDotStates,
  setProactiveNudgesEnabled
} from './nudges'

const STORAGE_KEY = 'hermes:proactive-nudges'

function session(id: string, over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    archived: false,
    cwd: null,
    ended_at: null,
    id,
    input_tokens: 0,
    is_active: false,
    last_active: 1_800_000_000,
    message_count: 2,
    model: null,
    output_tokens: 0,
    preview: null,
    source: null,
    started_at: 1_800_000_000,
    title: id,
    tool_call_count: 0,
    ...over
  }
}

const offeredKeys = (id: string): string[] =>
  ($composerSuggestionsBySession.get()[id] ?? []).map(suggestion => `${suggestion.provider}:${suggestion.id}`)

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY)
  $proactiveNudgesEnabled.set(false)
  $sessions.set([])
  $composerSuggestionsBySession.set({})
  __resetNudgesForTests()
})

describe('nudgeChips', () => {
  it.each([
    'Committed the fix and pushed it to the branch.',
    'I opened a PR with the patch.',
    'The diff is ready for review.'
  ])('offers the PR chip when the settle text reads as finished code work: %s', text => {
    const chips = nudgeChips(text)

    expect(chips.map(chip => chip.id)).toEqual(['pr', 'followup'])
    expect(chips.every(chip => chip.provider === 'nudges')).toBe(true)
    expect(chips.every(chip => chip.label && chip.tip && chip.doneLabel)).toBe(true)
  })

  it.each(['Here is the summary you asked for.', 'The report is attached above.', 'Your bookings are listed below.'])(
    'skips the PR chip when nothing signals code work: %s',
    text => {
      expect(nudgeChips(text).map(chip => chip.id)).toEqual(['followup'])
    }
  )

  it('invoking a chip drafts text without sending', async () => {
    const [chip] = nudgeChips('Committed the change.')

    await expect(chip.invoke({ cancelled: () => false, sessionId: 's1' })).resolves.toBeUndefined()
  })
})

describe('proactive nudges preference', () => {
  it('is opt-in: off by default and persists when enabled', () => {
    expect($proactiveNudgesEnabled.get()).toBe(false)

    setProactiveNudgesEnabled(true)
    expect($proactiveNudgesEnabled.get()).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')

    setProactiveNudgesEnabled(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
  })
})

describe('settle detection', () => {
  it('offers nudges when a live session settles to unread', () => {
    setProactiveNudgesEnabled(true)
    $sessions.set([session('unread-settle', { preview: 'Committed the fix.' })])

    processDotStates({ 'unread-settle': 'working' })
    processDotStates({ 'unread-settle': 'unread' })

    expect(offeredKeys('unread-settle')).toEqual(['nudges:pr', 'nudges:followup'])
  })

  it('offers nudges when a live session drops out of the map (idle)', () => {
    setProactiveNudgesEnabled(true)
    $sessions.set([session('idle-settle', { preview: 'All done.' })])

    processDotStates({ 'idle-settle': 'working' })
    processDotStates({})

    expect(offeredKeys('idle-settle')).toEqual(['nudges:followup'])
  })

  it('stays quiet while the opt-in is off', () => {
    $sessions.set([session('opted-out', { preview: 'Committed the fix.' })])

    processDotStates({ 'opted-out': 'working' })
    processDotStates({ 'opted-out': 'unread' })

    expect(offeredKeys('opted-out')).toEqual([])
  })

  it('does not nudge a session that was never seen working (startup unread rows)', () => {
    setProactiveNudgesEnabled(true)
    $sessions.set([session('stale-unread', { preview: 'Committed the fix.' })])

    processDotStates({ 'stale-unread': 'unread' })

    expect(offeredKeys('stale-unread')).toEqual([])
  })

  it('withdraws the offer the moment the session starts working again', () => {
    setProactiveNudgesEnabled(true)
    $sessions.set([session('re-worked', { preview: 'All done.' })])

    processDotStates({ 're-worked': 'working' })
    processDotStates({ 're-worked': 'unread' })
    expect(offeredKeys('re-worked')).not.toEqual([])

    processDotStates({ 're-worked': 'working' })
    expect(offeredKeys('re-worked')).toEqual([])
  })

  it('treats a blocked prompt as still live — answering it resumes, not settles', () => {
    setProactiveNudgesEnabled(true)
    $sessions.set([session('blocked', { preview: 'Waiting on you.' })])

    processDotStates({ blocked: 'needs-input' })
    processDotStates({ blocked: 'working' })

    expect(offeredKeys('blocked')).toEqual([])
  })

  it('switching the pref off withdraws pending nudges', () => {
    setProactiveNudgesEnabled(true)
    $sessions.set([session('pref-off-a'), session('pref-off-b')])

    processDotStates({ 'pref-off-a': 'working', 'pref-off-b': 'working' })
    processDotStates({})
    expect(offeredKeys('pref-off-a')).not.toEqual([])
    expect(offeredKeys('pref-off-b')).not.toEqual([])

    setProactiveNudgesEnabled(false)
    expect(offeredKeys('pref-off-a')).toEqual([])
    expect(offeredKeys('pref-off-b')).toEqual([])
  })
})
