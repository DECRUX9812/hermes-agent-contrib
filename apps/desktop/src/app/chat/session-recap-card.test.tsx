import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { en } from '@/i18n/en'
import type { ChatMessage } from '@/lib/chat-messages'

import { SessionRecapCard } from './session-recap'

const view = vi.hoisted(() => ({ messages: [] as ChatMessage[] }))

vi.mock('./session-view', () => ({
  useSessionView: () => ({ $messages: { get: () => view.messages } })
}))

const TWO_HOURS_SEC = 2 * 60 * 60

function idleTranscript(): ChatMessage[] {
  const stale = Date.now() / 1000 - TWO_HOURS_SEC

  return [
    { id: 'u1', parts: [{ text: 'fix the flaky test', type: 'text' }], role: 'user', timestamp: stale - 60 },
    {
      id: 'a1',
      parts: [{ text: 'Patched the race in the fixture.\nRan the suite twice.', type: 'text' }],
      role: 'assistant',
      timestamp: stale
    }
  ] as ChatMessage[]
}

afterEach(() => {
  cleanup()
  view.messages = []
})

describe('SessionRecapCard', () => {
  it('renders in normal flow above the transcript, never as an overlay', () => {
    view.messages = idleTranscript()

    const { container } = render(<SessionRecapCard storedSessionId="sess-recap-flow" />)

    const card = container.querySelector<HTMLElement>('[data-slot="session-recap"]')!

    expect(card).toBeTruthy()
    expect(card.className).not.toMatch(/\babsolute\b|\bz-\d+\b|\bfixed\b/)
    expect(screen.getByRole('status').textContent).toContain('Patched the race in the fixture.')
  })

  it('dismisses from a labelled icon button without a literal glyph', () => {
    view.messages = idleTranscript()

    const { container } = render(<SessionRecapCard storedSessionId="sess-recap-dismiss" />)
    const close = screen.getByRole('button', { name: en.assistant.sessionRecap.dismiss })

    expect(container.textContent).not.toContain('×')
    expect(close.textContent).toBe('')

    fireEvent.click(close)

    expect(container.querySelector('[data-slot="session-recap"]')).toBeNull()
  })

  it('stays hidden for a transcript that is still fresh', () => {
    view.messages = [
      {
        id: 'a1',
        parts: [{ text: 'just now', type: 'text' }],
        role: 'assistant',
        timestamp: Date.now() / 1000
      }
    ] as ChatMessage[]

    const { container } = render(<SessionRecapCard storedSessionId="sess-recap-fresh" />)

    expect(container.querySelector('[data-slot="session-recap"]')).toBeNull()
  })
})
