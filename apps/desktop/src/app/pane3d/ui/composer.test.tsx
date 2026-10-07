/**
 * Rendered contract for the composer's A→B handoff (architecture §8.8,
 * VAL-TASK-001).
 *
 * The pane keeps exactly ONE composer, so opening B while A is listening
 * replaces `$composer` in a single async continuation and React batches the
 * store changes. The DOM view is keyed by the composer session, so the new
 * avatar must get a freshly mounted textarea: its own draft (empty, or the
 * demo's prefill) and the keyboard focus. Reusing A's view would keep A's typed
 * text and leave focus on B's avatar button.
 */

// Registers the two definitions the view renders (the registry is import-driven).
import '../avatars/grok'
import '../avatars/muse'

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openComposer } from '../director/composer'
import { dispatch, summon } from '../director/director'
import { $avatars, $composer, $transitions, type AvatarRuntime } from '../director/store'
import type { AvatarId, PageContext } from '../protocol'
import { AVATAR_IDS } from '../protocol'

import { Composer } from './composer'

const CONTEXT: PageContext = {
  capturedAt: 42,
  selection: 'Look at this generative shader',
  source: 'hermes-browser',
  title: 'Ada on X',
  url: 'http://127.0.0.1:5181/x-post.html'
}

function setBridge(): void {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { pane3d: { captureContext: async () => CONTEXT } }
  })
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
  act(() => {
    summon(id)
    dispatch(id, 'EMERGED')
  })
}

beforeEach(() => {
  resetAvatars()
  setBridge()
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'hermesDesktop')
  $composer.set(null)
})

function textarea(container: HTMLElement): HTMLTextAreaElement {
  const element = container.querySelector<HTMLTextAreaElement>('textarea')

  expect(element).not.toBeNull()

  return element!
}

describe('Composer — A→B handoff (VAL-TASK-001)', () => {
  it('starts B with its own draft, and B is the focused, typed-into field', async () => {
    const { container } = render(<Composer />)

    perch('muse')
    perch('grok')

    await act(async () => {
      await openComposer('muse')
    })

    expect(container.querySelector('[data-pane-composer]')?.getAttribute('data-avatar-id')).toBe('muse')

    fireEvent.change(textarea(container), { target: { value: 'muse draft' } })

    expect(textarea(container).value).toBe('muse draft')

    await act(async () => {
      await openComposer('grok', { draft: 'grok draft', source: 'dev-harness' })
    })

    // The new session remounted the view: B's own prefill, not A's text.
    expect(container.querySelector('[data-pane-composer]')?.getAttribute('data-avatar-id')).toBe('grok')
    expect(textarea(container).value).toBe('grok draft')
    // …and the mount-only focus effect ran against the new field.
    expect(container.ownerDocument.activeElement).toBe(textarea(container))

    fireEvent.change(textarea(container), { target: { value: 'grok draft!' } })

    expect(textarea(container).value).toBe('grok draft!')
    // The superseded avatar is back to idle — no orphaned listener.
    expect($avatars.get().muse.state).toBe('idle')
    expect($avatars.get().grok.state).toBe('listening')
  })

  it('starts B empty when no draft was given', async () => {
    const { container } = render(<Composer />)

    perch('muse')
    perch('grok')

    await act(async () => {
      await openComposer('muse')
    })

    fireEvent.change(textarea(container), { target: { value: 'leftover' } })

    await act(async () => {
      await openComposer('grok')
    })

    expect(textarea(container).value).toBe('')
    expect(container.ownerDocument.activeElement).toBe(textarea(container))
  })
})
