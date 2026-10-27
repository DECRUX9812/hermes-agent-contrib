import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BrowserBackend } from './browser-backend'
import { LiveFrame } from './tool-card-live'
import { type ToolCardGroup, toolCardView, type ToolCardView } from './tool-card-model'
import type { RosterRow } from './types'

const backend = { value: 'desktop' as BrowserBackend }

vi.mock(import('./card-bot'), async importOriginal => ({
  ...(await importOriginal()),
  useCardBot: () => ({ name: 'scout' }) as RosterRow
}))

vi.mock(import('./browser-backend'), async importOriginal => ({
  ...(await importOriginal()),
  useBrowserBackend: () => backend.value
}))

vi.mock(import('./screen-portal'), async importOriginal => ({
  ...(await importOriginal()),
  useScreenPortalState: () => ({ tone: 'live' }) as never
}))

vi.mock(import('./tool-card-screen'), async importOriginal => ({
  ...(await importOriginal()),
  CardScreenStream: () => <span data-live-screen="" />
}))

function card(overrides: Partial<ToolCardView> = {}): ToolCardView {
  return { args: [], family: 'browser', icon: 'globe', id: 'a', name: 'Browser', state: 'running', status: 'Opening', ...overrides }
}

const group = (cards: ToolCardView[]): ToolCardGroup => ({
  cards,
  family: 'browser',
  icon: 'globe',
  key: 'g',
  name: 'Browser',
  state: 'running'
})

const streams = (cards: ToolCardView[]) =>
  Boolean(render(<LiveFrame group={group(cards)} open />).container.querySelector('[data-live-screen]'))

afterEach(() => {
  cleanup()
  backend.value = 'desktop'
})

describe('live screen gate', () => {
  it('streams a browser that draws on the bot desktop', () => {
    expect(streams([card()])).toBe(true)
  })

  it('keeps the screenshot for a cloud or CDP browser', () => {
    backend.value = 'elsewhere'
    expect(streams([card()])).toBe(false)
  })

  it('keeps the screenshot while the backend is unknown', () => {
    backend.value = 'unknown'
    expect(streams([card()])).toBe(false)
  })

  it("keeps the screenshot for the user's own real-profile browser", () => {
    expect(streams([card({ realProfile: true })])).toBe(false)
  })
})

describe('toolCardView realProfile', () => {
  const part = (args: Record<string, unknown>) =>
    ({ args, state: 'call', toolCallId: 't', toolName: 'browser_exec', type: 'tool-invocation' }) as never

  it('marks a browser call that asked for the local real profile', () => {
    expect(toolCardView(part({ code: 'x', local: true })).realProfile).toBe(true)
    expect(toolCardView(part({ code: 'x' })).realProfile).toBeUndefined()
    expect(toolCardView(part({ code: 'x', local: 'true' })).realProfile).toBeUndefined()
  })
})
