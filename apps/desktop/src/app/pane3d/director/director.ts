import type { AvatarId } from '../protocol'

import { type AvatarEvent, transition } from './machine'
import { $avatars, type AvatarRuntime, recordTransition } from './store'

/**
 * The AvatarDirector's transition entry point (architecture §8.1, §8.5).
 *
 * `dispatch` is the only writer of an avatar's state: it runs the pure machine,
 * ignores no-ops by identity (so unlisted events record nothing), mirrors the
 * new state into `$avatars` and appends to the transition log. `summon` /
 * `dismiss` are the two commands the dock and chips use.
 */
export function dispatch(id: AvatarId, event: AvatarEvent): void {
  const avatars = $avatars.get()
  const row = avatars[id]

  if (!row) {
    return
  }

  const current = { pendingNotify: row.pendingNotify, state: row.state }
  const next = transition(current, event)

  // Unlisted events and self-transitions return the same object: nothing to do.
  if (next === current) {
    return
  }

  const at = Date.now()

  const updated: AvatarRuntime = {
    ...row,
    changedAt: performance.now(),
    pendingNotify: next.pendingNotify,
    state: next.state,
    visible: next.state !== 'hidden'
  }

  $avatars.set({ ...avatars, [id]: updated })
  recordTransition({ at, avatar: id, event, from: row.state, to: next.state })
}

export function summon(id: AvatarId): void {
  dispatch(id, 'SUMMON')
}

export function dismiss(id: AvatarId): void {
  dispatch(id, 'DISMISS')
}
