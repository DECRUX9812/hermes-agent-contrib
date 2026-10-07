import type { AvatarState } from './store'

/**
 * The avatar state machine (architecture §8.1) — pure, no timers, no side
 * effects. Every transition is triggered by a real event: user input, a
 * TaskExecutor event, a director notify, or the rig reporting that an
 * animation finished. Anything not in the table is ignored and returns the
 * SAME object, so callers can detect a no-op by identity.
 */
export type AvatarEvent =
  | 'SUMMON'
  | 'EMERGED'
  | 'NOTIFY'
  | 'COMPOSER_OPEN'
  | 'USER_INPUT'
  | 'SUBMIT'
  | 'COMPOSER_CLOSE'
  | 'TASK_ACCEPTED'
  | 'TASK_PROGRESS'
  | 'STREAM_TOKEN'
  | 'TASK_DONE'
  | 'TASK_ERROR'
  | 'CELEBRATED'
  | 'NOTIFY_SETTLED'
  | 'DISMISS'
  | 'HIDDEN'

export interface AvatarMachineState {
  state: AvatarState
  /**
   * Notifications that arrived while the avatar was hidden/emerging. The
   * director holds its own FIFO; this counter only carries the request that
   * turned `hidden NOTIFY` into an emergence so `EMERGED` can deliver it.
   */
  pendingNotify: number
}

export const AVATAR_STATES: readonly AvatarState[] = [
  'hidden',
  'emerging',
  'idle',
  'listening',
  'thinking',
  'responding',
  'celebrating',
  'notifying',
  'hiding'
]

export const AVATAR_EVENTS: readonly AvatarEvent[] = [
  'SUMMON',
  'EMERGED',
  'NOTIFY',
  'COMPOSER_OPEN',
  'USER_INPUT',
  'SUBMIT',
  'COMPOSER_CLOSE',
  'TASK_ACCEPTED',
  'TASK_PROGRESS',
  'STREAM_TOKEN',
  'TASK_DONE',
  'TASK_ERROR',
  'CELEBRATED',
  'NOTIFY_SETTLED',
  'DISMISS',
  'HIDDEN'
]

type Handler = (state: AvatarMachineState) => AvatarMachineState

/** A self-transition is a listed event that keeps the same state (no-op). */
const stay: Handler = state => state

/** Enter `state` with a clean pending counter — a stale hold must not leak. */
const to =
  (state: AvatarState): Handler =>
  () => ({ pendingNotify: 0, state })

const TABLE: Record<AvatarState, Partial<Record<AvatarEvent, Handler>>> = {
  celebrating: { CELEBRATED: to('idle') },
  emerging: {
    EMERGED: state =>
      state.pendingNotify > 0
        ? { pendingNotify: state.pendingNotify - 1, state: 'notifying' }
        : { pendingNotify: 0, state: 'idle' }
  },
  hidden: {
    NOTIFY: state => ({ pendingNotify: state.pendingNotify + 1, state: 'emerging' }),
    SUMMON: to('emerging')
  },
  hiding: { HIDDEN: to('hidden') },
  idle: {
    COMPOSER_OPEN: to('listening'),
    DISMISS: to('hiding'),
    NOTIFY: to('notifying'),
    TASK_ACCEPTED: to('thinking')
  },
  listening: {
    COMPOSER_CLOSE: to('idle'),
    DISMISS: to('hiding'),
    SUBMIT: to('thinking'),
    USER_INPUT: stay
  },
  notifying: { DISMISS: to('hiding'), NOTIFY_SETTLED: to('idle') },
  responding: { STREAM_TOKEN: stay, TASK_DONE: to('celebrating'), TASK_ERROR: to('idle') },
  thinking: {
    STREAM_TOKEN: to('responding'),
    TASK_DONE: to('celebrating'),
    TASK_ERROR: to('idle'),
    TASK_PROGRESS: stay
  }
}

export function initialAvatarMachineState(state: AvatarState = 'hidden'): AvatarMachineState {
  return { pendingNotify: 0, state }
}

export function transition(state: AvatarMachineState, event: AvatarEvent): AvatarMachineState {
  return TABLE[state.state][event]?.(state) ?? state
}
