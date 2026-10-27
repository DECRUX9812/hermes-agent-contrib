import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { InstantAckLineView } from './instant-ack-line'
import { InstantAckRow } from './instant-ack-row'
import { armReceiptForSend } from './arm-at-send'
import { type InstantAckState, WAITING_AFTER_MS } from './state'
import { armInstantAck, noteInstantAck, resetInstantAcks } from './store'

const KEY = 'stored-session-1'
const SLOT = '[data-slot="instant-ack"]'

function row(props: Partial<React.ComponentProps<typeof InstantAckRow>> = {}) {
  return render(<InstantAckRow busy={false} lastVisibleIsUser={false} sessionId="runtime-1" sessionKey={KEY} {...props} />)
}

describe('instant ack line', () => {
  beforeEach(() => {
    resetInstantAcks()
  })

  afterEach(() => {
    cleanup()
  })

  it('says nothing at all before a send', () => {
    row()

    expect(document.querySelector(SLOT)).toBeNull()
  })

  it('paints the receipt on the same tick the send is armed — no await, no flush', () => {
    row()

    act(() => {
      armReceiptForSend(KEY, 'fix the sidebar overflow')
    })

    // Deliberately NOT waitFor: the claim under test is that the DOM is already
    // correct in the tick the Enter handler ran.
    const line = document.querySelector<HTMLElement>(SLOT)

    expect(line).not.toBeNull()
    expect(line?.dataset.ackState).toBe('receipt')
    expect(line?.textContent).toBe('Got it — fix the sidebar overflow')
  })

  it('names a slash command instead of restating its arguments', () => {
    render(<InstantAckLineView ack={{ armedAt: 1, detail: '/compress', state: 'receipt', updatedAt: 1 }} />)

    expect(screen.getByRole('status').textContent).toBe('Running /compress…')
  })

  it('shows the running tool’s own verb once a call is being written', () => {
    armInstantAck(KEY, 'fix the sidebar', 1000)
    render(<InstantAckLineView ack={{ armedAt: 1000, detail: 'Editing', state: 'working', updatedAt: 1200 }} />)

    expect(screen.getByRole('status').textContent).toBe('Editing')
  })

  it('admits it is waiting on the model rather than guessing what it does', () => {
    render(<InstantAckLineView ack={{ armedAt: 1000, detail: 'fix the sidebar', state: 'waiting', updatedAt: 2200 }} />)

    expect(screen.getByRole('status').textContent).toBe('Waiting on the model…')
  })

  it('parks on an approval request', () => {
    render(<InstantAckLineView ack={{ armedAt: 1000, detail: 'Editing', state: 'approval', updatedAt: 3000 }} />)

    expect(screen.getByRole('status').textContent).toBe('Waiting on your approval')
  })

  it('is announced politely, not as an alert', () => {
    render(<InstantAckLineView ack={{ armedAt: 1000, detail: 'fix the sidebar', state: 'receipt', updatedAt: 1000 }} />)

    const line = screen.getByRole('status')

    expect(line.getAttribute('aria-live')).toBe('polite')
    expect(line.dataset.conversationScaffold).toBe('')
  })

  it('turns a silent receipt into a waiting line once the model has not answered', async () => {
    const now = Date.now()

    armInstantAck(KEY, 'fix the sidebar', now - WAITING_AFTER_MS - 1)
    row()

    // The row's own timer has already elapsed, so the promotion lands on the
    // first macrotask — no invented progress before it.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
    })

    expect(document.querySelector<HTMLElement>(SLOT)?.dataset.ackState).toBe('waiting')
  })

  it('unmounts the moment the turn hands over, leaving no stale claim', () => {
    armInstantAck(KEY, 'fix the sidebar', 1000)
    row()

    act(() => {
      noteInstantAck(KEY, { at: 1500, type: 'hand-off' })
    })

    expect(document.querySelector(SLOT)).toBeNull()
  })

  it('keeps one line per session: a tile never narrates the primary chat', () => {
    armInstantAck(KEY, 'fix the sidebar', 1000)
    armInstantAck('tile-session', 'rework the pricing copy', 1000)
    row()

    expect(document.querySelector<HTMLElement>(SLOT)?.textContent).toBe('Got it — fix the sidebar')
  })

  it('renders nothing for a key that never armed', () => {
    armInstantAck('another-session', 'fix the sidebar', 1000)
    row()

    expect(document.querySelector(SLOT)).toBeNull()
  })

  it('has a state the probe can read for every claim it makes', () => {
    const states: InstantAckState[] = ['receipt', 'working', 'waiting', 'approval']

    for (const state of states) {
      const { unmount } = render(<InstantAckLineView ack={{ armedAt: 1, detail: 'x', state, updatedAt: 1 }} />)

      expect(document.querySelector<HTMLElement>(SLOT)?.dataset.ackState).toBe(state)
      unmount()
    }
  })
})
