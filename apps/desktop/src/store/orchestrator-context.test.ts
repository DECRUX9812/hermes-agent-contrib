import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $contextSpot,
  $orchestratorContext,
  $orchestratorContextError,
  $orchestratorContextLoading,
  reloadContext,
  replaceContext,
  setContextReloadSource
} from './orchestrator-context'
import { bootstrapContext } from '@/orchestrator/context'

describe('orchestrator-context reload fencing', () => {
  beforeEach(() => {
    replaceContext(bootstrapContext('local'))
    $orchestratorContextError.set(null)
    $orchestratorContextLoading.set(false)
    setContextReloadSource(null)
  })

  it('flips loading, applies a fetched context, and clears error', async () => {
    const fetched = { ...bootstrapContext('local'), objective: 'fresh objective', revision: 9 }
    setContextReloadSource(async () => fetched)
    $orchestratorContextError.set('stale error')

    const pending = reloadContext()
    expect($orchestratorContextLoading.get()).toBe(true)

    await pending
    expect($orchestratorContextLoading.get()).toBe(false)
    expect($orchestratorContext.get().objective).toBe('fresh objective')
    expect($orchestratorContextError.get()).toBeNull()
  })

  it('a superseded reload resolving last cannot clobber a newer fetch', async () => {
    let resolveOld!: (v: ReturnType<typeof bootstrapContext>) => void
    const oldPromise = new Promise<ReturnType<typeof bootstrapContext>>(r => { resolveOld = r })

    const loader = vi
      .fn()
      .mockImplementationOnce(() => oldPromise)
      .mockImplementationOnce(async () => ({ ...bootstrapContext('local'), objective: 'newest', revision: 2 }))
    setContextReloadSource(loader)

    const first = reloadContext()
    const second = reloadContext()

    resolveOld({ ...bootstrapContext('local'), objective: 'stale', revision: 1 })

    await Promise.all([first, second])

    expect($orchestratorContext.get().objective).toBe('newest')
    expect($orchestratorContextLoading.get()).toBe(false)
  })

  it('without a source the reload clears error honestly and fabricates nothing', async () => {
    $orchestratorContextError.set('transient')
    await reloadContext()
    expect($orchestratorContextError.get()).toBeNull()
    expect($orchestratorContext.get().revision).toBe(0)
  })

  it('a loader failure surfaces on the error atom and releases loading', async () => {
    setContextReloadSource(async () => { throw new Error('gateway down') })
    await reloadContext()
    expect($orchestratorContextError.get()).toBe('gateway down')
    expect($orchestratorContextLoading.get()).toBe(false)
    expect($contextSpot.get()).toBeNull()
  })
})
