import { describe, expect, it } from 'vitest'

import { AVATAR_EVENTS, AVATAR_STATES, type AvatarEvent, type AvatarMachineState, transition } from './machine'
import type { AvatarState } from './store'

/**
 * The transition table from architecture §8.1, written out independently of the
 * implementation. Every listed pair must move to the listed state; every pair
 * NOT listed here must be ignored (identity, same object).
 */
const TABLE: Record<AvatarState, Partial<Record<AvatarEvent, AvatarState>>> = {
  celebrating: { CELEBRATED: 'idle' },
  emerging: { EMERGED: 'idle' },
  hidden: { NOTIFY: 'emerging', SUMMON: 'emerging' },
  hiding: { HIDDEN: 'hidden' },
  idle: { COMPOSER_OPEN: 'listening', DISMISS: 'hiding', NOTIFY: 'notifying', TASK_ACCEPTED: 'thinking' },
  listening: {
    COMPOSER_CLOSE: 'idle',
    DISMISS: 'hiding',
    SUBMIT: 'thinking',
    USER_INPUT: 'listening'
  },
  notifying: { DISMISS: 'hiding', NOTIFY_SETTLED: 'idle' },
  responding: { STREAM_TOKEN: 'responding', TASK_DONE: 'celebrating', TASK_ERROR: 'idle' },
  thinking: { STREAM_TOKEN: 'responding', TASK_DONE: 'celebrating', TASK_ERROR: 'idle', TASK_PROGRESS: 'thinking' }
}

const at = (state: AvatarState, pendingNotify = 0): AvatarMachineState => ({ pendingNotify, state })

describe('avatar machine', () => {
  it('moves every listed §8.1 transition to the listed state', () => {
    AVATAR_STATES.forEach(state => {
      const events = TABLE[state]

      AVATAR_EVENTS.forEach(event => {
        const expected = events[event]

        if (!expected) {
          return
        }

        const next = transition(at(state), event)

        expect(next.state, `${state} + ${event}`).toBe(expected)
      })
    })
  })

  it('ignores every pair not in the §8.1 table, returning the same object', () => {
    AVATAR_STATES.forEach(state => {
      const events = TABLE[state]

      AVATAR_EVENTS.forEach(event => {
        if (events[event]) {
          return
        }

        const before = at(state)
        const after = transition(before, event)

        expect(after, `${state} + ${event} must be ignored`).toBe(before)
      })
    })
  })

  it('holds a notification that arrives while hidden and delivers it after emerging', () => {
    const hidden = at('hidden')
    const pending = transition(hidden, 'NOTIFY')

    expect(pending).toEqual(at('emerging', 1))
    // EMERGED with a held notification goes straight to notifying and consumes it.
    expect(transition(pending, 'EMERGED')).toEqual(at('notifying', 0))
    // Settling clears the counter so it cannot leak into the next emergence.
    expect(transition(transition(pending, 'EMERGED'), 'NOTIFY_SETTLED')).toEqual(at('idle', 0))
  })

  it('ignores a notification that arrives mid-emergence (the director holds it)', () => {
    const pending = transition(at('hidden'), 'NOTIFY')
    const during = transition(pending, 'NOTIFY')

    // §8.1 lists no `emerging NOTIFY`; the director's per-avatar FIFO is what
    // keeps the second request from being dropped.
    expect(during).toBe(pending)
    expect(transition(pending, 'EMERGED')).toEqual(at('notifying', 0))
  })

  it('emerges to idle when nothing is pending', () => {
    expect(transition(at('emerging'), 'EMERGED')).toEqual(at('idle', 0))
  })

  it('completes thinking→celebrating on done without any streamed tokens', () => {
    expect(transition(at('thinking'), 'TASK_DONE').state).toBe('celebrating')
  })
})
