import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HandoffCard } from './group-room-cards'
import type { RoomHandoff } from './group-room-handoffs'
import type * as BotsI18n from './i18n'

vi.mock('./i18n', async importOriginal => {
  const actual = await importOriginal<typeof BotsI18n>()

  return { ...actual, useBots: () => actual.BOTS_LOCALES.en }
})

const base: RoomHandoff = {
  at: Date.now(),
  doneWhen: 'tests green',
  dueMinutes: 30,
  from: 'hermes',
  fromUser: false,
  id: 'h1',
  index: 0,
  reply: '',
  replyIndex: -1,
  stale: 'fresh',
  status: 'open',
  task: 'unify replies',
  thread: 'a',
  to: 'coder',
  why: ''
}

const nameOf = (name: string) => (name === 'hermes' ? 'Hermes' : 'Coder')

afterEach(cleanup)

describe('HandoffCard', () => {
  it('heads the card with who handed to whom', () => {
    render(<HandoffCard handoff={base} nameOf={nameOf} />)
    const card = screen.getByTestId('group-handoff-card')

    expect(card.getAttribute('data-handoff-status')).toBe('open')
    expect(card.getAttribute('aria-label')).toBe('Handoff from Hermes to Coder')
    expect(card.textContent).toContain('unify replies')
    expect(card.textContent).toContain('Done when')
  })

  it('shows the reason only when the handoff named one', () => {
    const { rerender } = render(<HandoffCard handoff={base} nameOf={nameOf} />)

    expect(screen.getByTestId('group-handoff-card').textContent).not.toContain('owns the test suite')

    rerender(<HandoffCard handoff={{ ...base, why: 'owns the test suite' }} nameOf={nameOf} />)

    expect(screen.getByTestId('group-handoff-card').textContent).toContain('owns the test suite')
  })
})
