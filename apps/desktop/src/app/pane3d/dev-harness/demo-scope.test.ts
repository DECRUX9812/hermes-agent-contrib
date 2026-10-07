/**
 * Contract tests for the launch demo's SCOPE (architecture §8.9, §11; scrutiny
 * round 1, blocker 3).
 *
 * The demo's chart and its automatic presentation belong to the ONE task the
 * demo's own composer submits. `lastDemo` stays in the snapshot but decides
 * nothing, so a task the user asks for afterwards keeps its ordinary result
 * card with no chart. These tests drive the real executor, the real task
 * session and the real presenter together — the same seam the pane uses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installChartPresenter } from '../director/chart-live'
import { $chartPresentation, setChartPresentation } from '../director/chart-state'
import { dispatch } from '../director/director'
import { $avatars, $feed, $taskCards, $transitions, type AvatarRuntime, pane3dRuntime } from '../director/store'
import { setTaskExecutor, submitTask } from '../director/tasks'
import type { AvatarId, PageContext } from '../protocol'
import { AVATAR_IDS } from '../protocol'

import { DEMO_CHART } from './demo-data'
import { DevHarnessExecutor } from './dev-executor'
import { LAUNCH_DEMO_DRAFT } from './launch-demo'

// The pane installs the presenter once, at its composition point.
installChartPresenter()

const context: PageContext = {
  capturedAt: 42,
  source: 'hermes-browser',
  title: 'Ada on X',
  url: 'http://127.0.0.1:5181/x-post.html'
}

function resetAvatars(): void {
  const out = {} as Record<AvatarId, AvatarRuntime>

  AVATAR_IDS.forEach(id => {
    out[id] = { changedAt: 0, id, pendingNotify: 0, state: 'hidden', visible: false }
  })

  $avatars.set(out)
  $transitions.set([])
}

/** An avatar that finished emerging: the state a composer submit starts from. */
function perch(id: AvatarId): void {
  dispatch(id, 'SUMMON')
  dispatch(id, 'EMERGED')
}

beforeEach(() => {
  vi.useFakeTimers()
  resetAvatars()
  setChartPresentation(null)
  setTaskExecutor(new DevHarnessExecutor())
  $feed.set([])
  $taskCards.set({})
  pane3dRuntime.lastDemo = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('launch demo scope', () => {
  it('leaves a normal task alone after a launch demo ran', async () => {
    // The demo ran earlier in this pane session: the snapshot still says so.
    pane3dRuntime.lastDemo = 'launch'
    perch('muse')

    const id = submitTask('muse', 'explain this page', context)

    await vi.runAllTimersAsync()

    const card = $taskCards.get()[`${id}-result`]

    expect(card).toBeDefined()
    expect(card.chart).toBeUndefined()
    expect(card.presentChart).toBeUndefined()
    expect($chartPresentation.get()).toBeNull()
    // Its card stays on screen: nothing was auto-dismissed.
    expect($feed.get()).toHaveLength(0)
  })

  it('offers a keyword chart on an ordinary request without presenting it', async () => {
    perch('muse')

    const id = submitTask('muse', 'add a chart of the growth please', context)

    await vi.runAllTimersAsync()

    const card = $taskCards.get()[`${id}-result`]

    expect(card.chart).toEqual(DEMO_CHART)
    expect(card.presentChart).toBeUndefined()
    expect($chartPresentation.get()).toBeNull()
    // The user reaches the chart through the card's "Show chart" (§8.9).
    expect($feed.get()).toHaveLength(0)
  })

  it('gives the plain story line a chart the user presents by click (VAL-CROSS-001)', async () => {
    // The manual end-to-end story types the demo's line itself, with no demo
    // marker — the card must carry the chart and stay on screen.
    perch('muse')

    const id = submitTask('muse', LAUNCH_DEMO_DRAFT, context)

    await vi.runAllTimersAsync()

    const card = $taskCards.get()[`${id}-result`]

    expect(card.chart).toEqual(DEMO_CHART)
    expect(card.presentChart).toBeUndefined()
    expect($chartPresentation.get()).toBeNull()
    expect($feed.get()).toHaveLength(0)
  })

  it('presents the demo\u2019s own task chart and collapses its card', async () => {
    perch('muse')

    submitTask('muse', 'this looks cool — can you build this for me?', context, 'launch')

    await vi.runAllTimersAsync()

    // No demo run needed: the marker on the task itself is the whole signal.
    expect($chartPresentation.get()).toMatchObject({ avatar: 'muse', source: 'dev-harness' })
    expect($chartPresentation.get()?.spec).toEqual(DEMO_CHART)
    expect($taskCards.get()).toEqual({})
    expect($feed.get().map(entry => entry.kind)).toEqual(['task'])
  })
})
