import { describe, expect, it, vi } from 'vitest'

import { listAvatars, registerAvatar } from '../avatars/registry'
import type { AvatarDefinition } from '../avatars/types'
import type { AvatarId } from '../protocol'

import { beginPrewarm, completePrewarm, planPrewarm, prewarmCompletion, settlePrewarm } from './prewarm'

function fakeAvatar(id: AvatarId): AvatarDefinition {
  return {
    Body: () => null,
    displayName: id,
    height: 1.1,
    id,
    palette: { accent: '#000', glow: '#000', ink: '#000', primary: '#000' },
    tagline: id
  }
}

describe('planPrewarm', () => {
  it('warms exactly the registered avatars, and re-reads the registry each time', () => {
    registerAvatar(fakeAvatar('hermes'))
    const first = planPrewarm(listAvatars())

    registerAvatar(fakeAvatar('grok'))
    const second = planPrewarm(listAvatars())

    expect(first.ids).toEqual(['hermes'])
    // An avatar registered after the first plan is picked up with no extra wiring.
    expect(second.ids).toEqual(['hermes', 'grok'])
  })

  it('has nothing to mount when no avatar is registered', () => {
    const empty = planPrewarm([])

    expect(empty).toEqual({ ids: [], stage: 'warm' })
    expect(beginPrewarm(empty)).toBe(empty)
  })
})

describe('prewarm stage machine', () => {
  it('runs pending → compiling → warm and keeps the ids', () => {
    const plan = planPrewarm([fakeAvatar('muse')])
    const compiling = beginPrewarm(plan)
    const warm = completePrewarm(compiling)

    expect(plan.stage).toBe('pending')
    expect(compiling.stage).toBe('compiling')
    expect(warm.stage).toBe('warm')
    expect(warm.ids).toEqual(['muse'])
  })

  it('never compiles twice: warm is terminal and begin on it is a no-op', () => {
    const warm = completePrewarm(planPrewarm([fakeAvatar('muse')]))

    expect(warm.stage).toBe('warm')
    expect(beginPrewarm(warm)).toBe(warm)
    expect(completePrewarm(warm)).toBe(warm)
  })
})

describe('prewarmCompletion', () => {
  it('resolves when the pre-warm settles, and settling twice is harmless', async () => {
    vi.useFakeTimers()

    try {
      const completion = prewarmCompletion()
      let resolved = false

      void completion.then(() => {
        resolved = true
      })

      await Promise.resolve()
      expect(resolved).toBe(false)

      settlePrewarm()
      settlePrewarm()
      await completion
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
