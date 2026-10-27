import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToolCard } from './tool-card'
import { CardBlock } from './tool-card-block'
import { BrowserSteps, stepPageUrl } from './tool-card-steps'
import type { ToolCardGroup, ToolCardView } from './types'

const openPreview = vi.fn()

vi.mock(import('@/store/preview'), async importOriginal => ({
  ...(await importOriginal()),
  openPreview: (...args: unknown[]) => openPreview(...args)
}))

function card(id: string, overrides: Partial<ToolCardView> = {}): ToolCardView {
  return {
    args: [],
    family: 'browser',
    icon: 'globe',
    id,
    name: 'Browser',
    state: 'done',
    status: `Step ${id}`,
    ...overrides
  }
}

const site = (url: string) => ({ host: new URL(url).host, kind: 'site' as const, url })

function group(cards: ToolCardView[]): ToolCardGroup {
  return { cards, family: 'browser', icon: 'globe', key: 'g', name: 'Browser', state: 'done' }
}

afterEach(() => {
  cleanup()
  openPreview.mockReset()
})

describe('stepPageUrl', () => {
  it('uses the step page, else the nearest earlier one', () => {
    const cards = [card('a', { thumb: site('https://example.com/a') }), card('b'), card('c', { thumb: site('https://news.example.org/') })]

    expect(stepPageUrl(cards, 0)).toBe('https://example.com/a')
    expect(stepPageUrl(cards, 1)).toBe('https://example.com/a')
    expect(stepPageUrl(cards, 2)).toBe('https://news.example.org/')
  })

  it('never offers a non-web address', () => {
    expect(stepPageUrl([card('a', { thumb: { host: '', kind: 'site', url: 'javascript:alert(1)' } })], 0)).toBe('')
    expect(stepPageUrl([card('a')], 0)).toBe('')
  })
})

describe('BrowserSteps open page', () => {
  it('opens the selected step page in the preview pane', () => {
    render(<BrowserSteps group={group([card('a', { thumb: site('https://example.com/a') })])} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open page' }))

    expect(openPreview).toHaveBeenCalledTimes(1)
    expect(openPreview.mock.calls[0][0]).toMatchObject({ kind: 'url', url: 'https://example.com/a' })
  })

  it('hides the button when no step has a page', () => {
    render(<BrowserSteps group={group([card('a')])} />)

    expect(screen.queryByRole('button', { name: 'Open page' })).toBeNull()
  })
})


function webCard(overrides: Partial<ToolCardView> = {}): ToolCardView {
  return { args: [], family: 'web', icon: 'globe', id: 'c1', name: 'Web', state: 'done', status: 'Read page', ...overrides }
}

function webGroup(cards: ToolCardView[], state: ToolCardGroup['state'] = 'done'): ToolCardGroup {
  return { cards, family: cards[0].family, icon: 'globe', key: 'g', name: 'Web', state, thumb: cards.at(-1)?.thumb }
}

describe('Open page outside the browser viewer', () => {
  it('shows the page address and opens it from an expanded web step', () => {
    render(<CardBlock card={webCard({ thumb: site('https://example.com/docs') })} showStatus={false} />)

    expect(screen.getByText('example.com/docs')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open page' }))
    expect(openPreview).toHaveBeenCalledTimes(1)
    expect(openPreview.mock.calls[0][0]).toMatchObject({ kind: 'url', url: 'https://example.com/docs' })
  })

  it('offers nothing for a step without a page', () => {
    render(<CardBlock card={webCard({ family: 'terminal' })} showStatus={false} />)

    expect(screen.queryByRole('button', { name: 'Open page' })).toBeNull()
  })

  it('opens the page from a settled row without toggling it', () => {
    render(<ToolCard group={webGroup([webCard({ thumb: site('https://example.com/a') })])} />)

    const toggle = screen.getByRole('button', { expanded: false })
    fireEvent.click(screen.getByRole('button', { name: 'Open page' }))
    expect(openPreview).toHaveBeenCalledTimes(1)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the page from a live row too', () => {
    render(<ToolCard group={webGroup([webCard({ state: 'running', thumb: site('https://example.com/b') })], 'running')} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open page' }))
    expect(openPreview.mock.calls[0][0]).toMatchObject({ url: 'https://example.com/b' })
  })
})
