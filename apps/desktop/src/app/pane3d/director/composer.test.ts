/**
 * Contract tests for the composer session (architecture §8.8, VAL-CONTEXT-002).
 *
 * The important invariant is the ORDER: the page context is read before
 * `COMPOSER_OPEN` makes the pane focusable, so the selection is still in the
 * page when it is read. The capture bridge is injected on `window`, the same
 * seam the real preload occupies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AvatarId, PageContext } from '../protocol'
import { AVATAR_IDS } from '../protocol'

import { closeComposer, openComposer, removeContextField, setTaskSubmitter, submitComposer } from './composer'
import { dismiss, dispatch, summon } from './director'
import { $avatars, $composer, $transitions, type AvatarRuntime } from './store'

const context: PageContext = {
  capturedAt: 42,
  selection: 'Look at this generative shader',
  source: 'hermes-browser',
  title: 'Ada on X',
  url: 'http://127.0.0.1:5181/x-post.html'
}

interface TestBridge {
  pane3d: { captureContext: () => Promise<PageContext> }
}

function setBridge(bridge: TestBridge | undefined): void {
  if (bridge) {
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: bridge })

    return
  }

  Reflect.deleteProperty(window, 'hermesDesktop')
}

function resetAvatars(): void {
  const out = {} as Record<AvatarId, AvatarRuntime>

  AVATAR_IDS.forEach(id => {
    out[id] = { changedAt: 0, id, pendingNotify: 0, state: 'hidden', visible: false }
  })

  $avatars.set(out)
  $transitions.set([])
  $composer.set(null)
}

/** hidden → emerging → idle, the state a click can open a composer from. */
function perch(id: AvatarId): void {
  summon(id)
  dispatch(id, 'EMERGED')
}

describe('composer session', () => {
  beforeEach(() => {
    resetAvatars()
    setTaskSubmitter(null)
    setBridge(undefined)
  })

  afterEach(() => {
    setBridge(undefined)
    vi.restoreAllMocks()
  })

  it('captures the page context BEFORE the avatar enters listening', async () => {
    let stateAtCapture = ''
    setBridge({
      pane3d: {
        captureContext: async () => {
          stateAtCapture = $avatars.get().muse.state

          return context
        }
      }
    })
    perch('muse')

    await openComposer('muse')

    // The read happened while the avatar was still idle — i.e. before the pane
    // could take focus and drop the selection.
    expect(stateAtCapture).toBe('idle')
    expect($avatars.get().muse.state).toBe('listening')
    expect($composer.get()).toEqual({ avatar: 'muse', context, removed: [] })
  })

  it('stores the full selection from the injected bridge', async () => {
    setBridge({ pane3d: { captureContext: async () => context } })
    perch('muse')

    await openComposer('muse')

    expect($composer.get()?.context.selection).toBe('Look at this generative shader')
  })

  it('falls back to a none context when no bridge is installed', async () => {
    perch('muse')

    await openComposer('muse')

    expect($composer.get()?.context.source).toBe('none')
    expect($avatars.get().muse.state).toBe('listening')
  })

  it('ignores a second open while the first capture is still in flight', async () => {
    let calls = 0

    let release: () => void = () => {}
    setBridge({
      pane3d: {
        captureContext: () => {
          calls += 1

          return new Promise<PageContext>(resolve => {
            release = () => resolve(context)
          })
        }
      }
    })
    perch('muse')

    const first = openComposer('muse')
    const second = openComposer('muse')

    release()
    await Promise.all([first, second])

    expect(calls).toBe(1)
    expect($avatars.get().muse.state).toBe('listening')
  })

  it('does not open when the avatar was dismissed while the capture was pending', async () => {
    let release: () => void = () => {}
    setBridge({
      pane3d: {
        captureContext: () =>
          new Promise<PageContext>(resolve => {
            release = () => resolve(context)
          })
      }
    })
    perch('muse')

    const opening = openComposer('muse')

    dismiss('muse')
    release()
    await opening

    expect($avatars.get().muse.state).toBe('hiding')
    expect($composer.get()).toBeNull()
  })

  it('does nothing when the avatar is not idle', async () => {
    const captureContext = vi.fn(async () => context)
    setBridge({ pane3d: { captureContext } })

    await openComposer('muse')

    expect(captureContext).not.toHaveBeenCalled()
    expect($avatars.get().muse.state).toBe('hidden')
  })

  it('hands the trimmed text and the effective context to the installed submitter', async () => {
    const submitter = vi.fn()
    setTaskSubmitter(submitter)
    setBridge({ pane3d: { captureContext: async () => context } })
    perch('muse')

    await openComposer('muse')
    removeContextField('selection')
    submitComposer('muse', '  build this  ')

    expect($avatars.get().muse.state).toBe('thinking')
    expect($composer.get()).toBeNull()
    expect(submitter).toHaveBeenCalledTimes(1)
    expect(submitter.mock.calls[0][0]).toBe('muse')
    expect(submitter.mock.calls[0][1]).toBe('build this')
    // The removed selection chip is not sent with the task.
    expect(submitter.mock.calls[0][2]).toEqual({
      capturedAt: 42,
      source: 'hermes-browser',
      title: 'Ada on X',
      url: 'http://127.0.0.1:5181/x-post.html'
    })
  })

  it('closes back to idle when no submitter is installed', async () => {
    setBridge({ pane3d: { captureContext: async () => context } })
    perch('muse')

    await openComposer('muse')
    submitComposer('muse', 'hello')

    expect($avatars.get().muse.state).toBe('idle')
    expect($composer.get()).toBeNull()
  })

  it('closes back to idle and drops the composer state', async () => {
    setBridge({ pane3d: { captureContext: async () => context } })
    perch('muse')

    await openComposer('muse')
    closeComposer('muse')

    expect($avatars.get().muse.state).toBe('idle')
    expect($composer.get()).toBeNull()
  })

  it('drops the composer state when the avatar is dismissed while listening', async () => {
    setBridge({ pane3d: { captureContext: async () => context } })
    perch('muse')

    await openComposer('muse')
    dismiss('muse')

    expect($composer.get()).toBeNull()
  })
})
