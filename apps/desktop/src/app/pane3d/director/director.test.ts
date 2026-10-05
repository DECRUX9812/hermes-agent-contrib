import { beforeEach, describe, expect, it } from 'vitest'

import type { AvatarId } from '../protocol'
import { AVATAR_IDS } from '../protocol'

import { dismiss, dispatch, summon } from './director'
import { $avatars, $transitions, type AvatarRuntime, TRANSITION_LIMIT } from './store'

function resetAvatars(): void {
  const out = {} as Record<AvatarId, AvatarRuntime>

  AVATAR_IDS.forEach(id => {
    out[id] = { changedAt: 0, id, pendingNotify: 0, state: 'hidden', visible: false }
  })

  $avatars.set(out)
  $transitions.set([])
}

describe('avatar director', () => {
  beforeEach(resetAvatars)

  it('summons an avatar into emerging and records the transition', () => {
    summon('muse')

    expect($avatars.get().muse.state).toBe('emerging')
    expect($avatars.get().muse.visible).toBe(true)
    expect($transitions.get()[0]).toMatchObject({ avatar: 'muse', event: 'SUMMON', from: 'hidden', to: 'emerging' })
  })

  it('walks emergence → idle when the rig reports EMERGED', () => {
    summon('muse')
    dispatch('muse', 'EMERGED')

    expect($avatars.get().muse.state).toBe('idle')
    expect($transitions.get().map(t => t.to)).toEqual(['idle', 'emerging'])
  })

  it('dismisses into hiding and only hides once HIDDEN arrives', () => {
    summon('muse')
    dispatch('muse', 'EMERGED')
    dismiss('muse')

    expect($avatars.get().muse.state).toBe('hiding')
    // Still visible while it sinks through the seam.
    expect($avatars.get().muse.visible).toBe(true)

    dispatch('muse', 'HIDDEN')

    expect($avatars.get().muse.state).toBe('hidden')
    expect($avatars.get().muse.visible).toBe(false)
  })

  it('ignores events the machine does not list, recording nothing', () => {
    summon('muse')
    const before = $transitions.get().length

    // hidden→emerging has no COMPOSER_OPEN; the state must not change.
    dispatch('muse', 'COMPOSER_OPEN')

    expect($avatars.get().muse.state).toBe('emerging')
    expect($transitions.get().length).toBe(before)
  })

  it('stamps the animation clock on a real transition and leaves it alone otherwise', () => {
    // The rig anchors its choreography to this value, so a slow first frame
    // cannot stretch emergence past its stated duration (§8.4).
    expect($avatars.get().muse.changedAt).toBe(0)

    summon('muse')
    const stamped = $avatars.get().muse.changedAt

    expect(stamped).toBeGreaterThan(0)

    dispatch('muse', 'COMPOSER_OPEN')

    expect($avatars.get().muse.changedAt).toBe(stamped)
  })

  it('keeps only the newest 200 transitions', () => {
    summon('muse')
    dispatch('muse', 'EMERGED')

    // idle ⇄ notifying is a legal 2-event cycle, so this is 250 real records.
    for (let i = 0; i < 125; i += 1) {
      dispatch('muse', 'NOTIFY')
      dispatch('muse', 'NOTIFY_SETTLED')
    }

    const log = $transitions.get()

    expect(log.length).toBe(TRANSITION_LIMIT)
    // Newest first, and the tail is the oldest survivor — not a truncated head.
    expect(log[0].event).toBe('NOTIFY_SETTLED')
    expect(log[TRANSITION_LIMIT - 1].event).toBe('NOTIFY')
  })
})
