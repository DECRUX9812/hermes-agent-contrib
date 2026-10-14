import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolActivityStack } from './tool-activity-stack'
import type { ToolCardGroup, ToolCardThumb, ToolCardView } from './types'

const SHOT = 'data:image/png;base64,iVBORw0KGgo='

function view(overrides: Partial<ToolCardView> = {}): ToolCardView {
  return {
    args: [{ label: 'Address', value: 'https://example.com' }],
    family: 'web',
    icon: 'globe',
    id: 'c1',
    name: 'Web',
    output: 'Welcome to example',
    state: 'running',
    status: 'Checking example.com',
    ...overrides
  }
}

function group(overrides: Partial<ToolCardGroup> = {}): ToolCardGroup {
  const card = view()

  return {
    cards: [card],
    family: 'web',
    icon: 'globe',
    key: 'g1',
    name: 'Web',
    state: 'running',
    ...overrides
  }
}

function browserCards(): ToolCardView[] {
  return [1, 2, 3].map(index =>
    view({
      args: [{ label: 'Address', value: `https://example.com/page-${index}` }],
      family: 'browser',
      id: `b${index}`,
      name: 'Browser',
      output: `page ${index} text`,
      state: 'done',
      status: `Opened page ${index}`,
      thumb: { kind: 'screenshot', src: SHOT }
    })
  )
}

const resolveFavicon = vi.fn<(url: string) => Promise<string>>()
let originalDesktop: typeof window.hermesDesktop

beforeEach(() => {
  resolveFavicon.mockReset()
  resolveFavicon.mockResolvedValue('')
  originalDesktop = window.hermesDesktop
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { resolveFavicon } })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
})

describe('ToolActivityStack', () => {
  it('renders nothing when there are no groups', () => {
    const { container } = render(<ToolActivityStack groups={[]} />)

    expect(container.innerHTML).toBe('')
  })

  it('shows a running status with typing dots', () => {
    const { container } = render(<ToolActivityStack groups={[group()]} />)

    expect(screen.getByText('Checking example.com')).toBeTruthy()
    expect(container.querySelector('[data-typing]')).toBeTruthy()
  })

  it('settles three browser runs into one quiet line with a check', () => {
    const cards = browserCards()

    const { container } = render(
      <ToolActivityStack
        groups={[{ cards, family: 'browser', icon: 'globe', key: 'gb', name: 'Browser', state: 'done' }]}
      />
    )

    expect(screen.getByText('Used Browser ×3')).toBeTruthy()
    expect(container.querySelector('[data-tool-card="done"] .codicon-check')).toBeTruthy()
    expect(container.querySelector('[data-typing]')).toBeNull()
  })

  it('shows the error reason on a failed card', () => {
    const failed = view({ reason: 'Connection refused', state: 'error', status: 'Opening example.com' })
    render(<ToolActivityStack groups={[group({ cards: [failed], state: 'error' })]} />)

    expect(screen.getByText('Connection refused')).toBeTruthy()
  })

  it('calls onReviewApproval from Review without toggling details', () => {
    const onReviewApproval = vi.fn()
    const waiting = view({ state: 'approval', status: 'Editing files' })
    render(
      <ToolActivityStack
        groups={[group({ cards: [waiting], state: 'approval' })]}
        onReviewApproval={onReviewApproval}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    expect(onReviewApproval).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
    expect(screen.queryByText('Request')).toBeNull()
  })

  it('expands a row to show its request and output', () => {
    render(<ToolActivityStack groups={[group()]} />)

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
    expect(screen.getByText('Request')).toBeTruthy()
    expect(screen.getByText('Output')).toBeTruthy()
    expect(screen.getByText('Welcome to example')).toBeTruthy()
  })

  it('opens the browser viewer on the latest screenshot and steps back', () => {
    const cards = browserCards()
    render(
      <ToolActivityStack
        groups={[{ cards, family: 'browser', icon: 'globe', key: 'gb', name: 'Browser', state: 'done' }]}
      />
    )

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText('Step 3 of 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))

    expect(screen.getByText('Step 2 of 3')).toBeTruthy()
  })

  it('never asks the network for a localhost favicon', async () => {
    const thumb: ToolCardThumb = { host: 'localhost', kind: 'site', url: 'http://localhost:4177/app' }
    const local = view({ id: 'l1', status: 'Serving the app', thumb })
    render(<ToolActivityStack groups={[group({ cards: [local], key: 'gl', thumb })]} />)

    expect(await screen.findByText('Serving the app')).toBeTruthy()
    await waitFor(() => expect(resolveFavicon).not.toHaveBeenCalled())
  })

  it('resolves a favicon for a public site thumb', async () => {
    const thumb: ToolCardThumb = { host: 'example.com', kind: 'site', url: 'https://example.com/docs' }
    const page = view({ id: 'p1', status: 'Reading the docs', thumb })
    render(<ToolActivityStack groups={[group({ cards: [page], key: 'gp', thumb })]} />)

    await waitFor(() => expect(resolveFavicon).toHaveBeenCalledWith('https://example.com/docs'))
  })
})
