import { cleanup, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type * as DotState from '@/store/session-dot-state'

const dots = vi.hoisted(() => ({ value: {} as Record<string, string> }))

vi.mock('@/store/session-dot-state', async importOriginal => ({
  ...(await importOriginal<typeof DotState>()),
  $sessionDotStateById: atom(dots.value)
}))
vi.mock('@/store/session-digest', () => ({ $sessionDigestById: atom({}) }))

afterEach(cleanup)

it('gives each task its own card: live age, the agent’s latest steps, and the unread dot', async () => {
  const { $sessions } = await import('@/store/session')
  const { $sessionStates } = await import('@/store/session-states-live')
  const { $sessionDotStateById } = await import('@/store/session-dot-state')
  const { TodayBrief } = await import('./today-brief')

  const now = Date.now()

  ;($sessionDotStateById as unknown as ReturnType<typeof atom>).set({ run: 'working', done: 'unread' })
  $sessions.set([
    { id: 'run', title: 'Cancel subscription', last_active: now / 1000, started_at: now / 1000 },
    { id: 'done', title: 'Largest park', preview: 'Golden Gate Park, 1,017 acres', last_active: 1, started_at: 1 }
  ] as never)
  $sessionStates.set({
    rt1: {
      storedSessionId: 'run',
      busy: true,
      messages: [
        { id: 'u', role: 'user', parts: [{ type: 'text', text: 'cancel it' }], timestamp: now - 571_000 },
        {
          id: 'a',
          role: 'assistant',
          parts: [
            {
              type: 'tool-call',
              toolCallId: 't1',
              toolName: 'browser_navigate',
              args: { url: 'https://chase.com' },
              argsText: ''
            }
          ]
        }
      ]
    }
  } as never)

  const { container } = render(
    <I18nProvider configClient={null} initialLocale="en">
      <MemoryRouter>
        <TodayBrief />
      </MemoryRouter>
    </I18nProvider>
  )

  expect(screen.getByText('Recent tasks')).toBeTruthy()
  const running = container.querySelector('[data-task-card="run"]') as HTMLElement
  expect(running.textContent).toMatch(/Working for 9m 3\ds/)
  expect(running.textContent).toContain('chase.com')
  // A finished chat with no live steps says what it found instead.
  const done = container.querySelector('[data-task-card="done"]') as HTMLElement
  expect(done.textContent).toContain('Golden Gate Park')
  expect(screen.getByLabelText('New reply')).toBeTruthy()
})
