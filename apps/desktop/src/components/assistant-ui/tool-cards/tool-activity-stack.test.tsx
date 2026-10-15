import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $previewTabs } from '@/store/preview'

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
    step: { args: { url: 'https://example.com' }, result: 'Welcome to example', toolName: 'fetch_url' },
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
  return [500, 1_000, 1_900].map((durationMs, index) =>
    view({
      args: [{ label: 'Address', value: `https://example.com/page-${index}` }],
      family: 'browser',
      id: `b${index}`,
      name: 'Browser',
      output: `page ${index} text`,
      durationMs,
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
  $previewTabs.set([])
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

  it('shows a running tool call as a one-line pill', () => {
    const { container } = render(<ToolActivityStack groups={[group()]} />)

    expect(screen.getByText('Checking example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Web: Checking example.com' })).toBeTruthy()
    expect(container.querySelector('[data-tool-step="running"]')).toBeTruthy()
  })

  it('folds a completed multi-tool run into one quiet summary with total duration', () => {
    const cards = browserCards()

    const { container } = render(
      <ToolActivityStack
        groups={[
          { cards: [cards[0]], family: 'browser', icon: 'globe', key: 'gb', name: 'Browser', state: 'done' },
          { cards: [cards[1]], family: 'terminal', icon: 'terminal', key: 'gt', name: 'Terminal', state: 'done' },
          { cards: [cards[2]], family: 'files', icon: 'files', key: 'gf', name: 'Files', state: 'done' }
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Used 3 tools' })).toBeTruthy()
    expect(screen.getByText('3.4s')).toBeTruthy()
    expect(container.querySelector('[data-tool-run-anchor]')).toBeTruthy()
    expect(container.querySelector('[data-tool-step]')).toBeNull()
  })

  it('does not fold successful calls until the assistant turn completes', () => {
    const cards = browserCards()
    const groups = [{ cards, family: 'browser' as const, icon: 'globe', key: 'gb', name: 'Browser', state: 'done' as const }]
    const { rerender } = render(<ToolActivityStack groups={groups} live />)

    expect(screen.getByRole('button', { name: 'Browser: Opened page 1' })).toBeTruthy()
    expect(screen.queryByText('Used 3 tools')).toBeNull()

    rerender(<ToolActivityStack groups={groups} live={false} />)

    expect(screen.getByRole('button', { name: 'Used 3 tools' })).toBeTruthy()
  })

  it('shows the error reason on a failed card', () => {
    const failed = view({ reason: 'Connection refused', state: 'error', status: 'Opening example.com' })
    render(<ToolActivityStack groups={[group({ cards: [failed], state: 'error' })]} />)

    expect(screen.getByText('Connection refused')).toBeTruthy()
  })

  it('names each pill and summary for assistive tech', () => {
    const failed = view({ reason: 'Connection refused', state: 'error', status: 'Opening example.com' })
    render(
      <ToolActivityStack
        groups={[
          group({ cards: [failed], state: 'error' }),
          { cards: browserCards(), family: 'browser', icon: 'globe', key: 'gb', name: 'Browser', state: 'done' }
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Web: Opening example.com: Connection refused' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Used 3 tools' })).toBeTruthy()
  })

  it('calls onReviewApproval from Review without opening the pill', () => {
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
    expect(screen.getByRole('button', { name: 'Web: Editing files' })).toBeTruthy()
    expect(screen.queryByText('Request')).toBeNull()
  })

  it('expands a completed run to its individual pills', () => {
    const cards = browserCards()
    render(
      <ToolActivityStack
        groups={[{ cards, family: 'browser', icon: 'globe', key: 'gb', name: 'Browser', state: 'done' }]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Used 3 tools' }))

    expect(screen.getByRole('button', { name: 'Browser: Opened page 1' })).toBeTruthy()

    expect(screen.getByRole('button', { name: 'Browser: Opened page 2' })).toBeTruthy()
  })

  it('opens the Step view after a pill click with the original tool arguments', () => {
    const card = view({
      id: 'call-step',
      step: { args: { command: 'npm test' }, result: 'all passed', toolCallId: 'call-step', toolName: 'terminal' }
    })

    render(<ToolActivityStack groups={[group({ cards: [card] })]} />)

    expect($previewTabs.get()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Web: Checking example.com' }))

    expect($previewTabs.get()).toHaveLength(1)
    expect($previewTabs.get()[0].target.kind).toBe('step')
    expect($previewTabs.get()[0].target.step?.args).toEqual({ command: 'npm test' })
  })

  it('does not request a favicon for site thumbs', () => {
    const thumb: ToolCardThumb = { host: 'localhost', kind: 'site', url: 'http://localhost:4177/app' }
    const local = view({ id: 'l1', status: 'Serving the app', thumb })
    render(<ToolActivityStack groups={[group({ cards: [local], key: 'gl', thumb })]} />)

    expect(screen.getByText('Serving the app')).toBeTruthy()
    expect(resolveFavicon).not.toHaveBeenCalled()
  })
})
