import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToolCard } from './tool-card'
import { CardBlock } from './tool-card-block'
import type { ToolCardGroup, ToolCardView } from './types'

const openPreview = vi.fn()

vi.mock(import('@/store/preview'), async importOriginal => ({
  ...(await importOriginal()),
  openPreview: (...args: unknown[]) => openPreview(...args)
}))

const site = (url: string) => ({ host: new URL(url).host, kind: 'site' as const, url })

function card(overrides: Partial<ToolCardView> = {}): ToolCardView {
  return { args: [], family: 'web', icon: 'globe', id: 'c1', name: 'Web', state: 'done', status: 'Read page', ...overrides }
}

function group(cards: ToolCardView[], state: ToolCardGroup['state'] = 'done'): ToolCardGroup {
  return { cards, family: cards[0].family, icon: 'globe', key: 'g', name: 'Web', state, thumb: cards.at(-1)?.thumb }
}

afterEach(() => {
  cleanup()
  openPreview.mockReset()
})

describe('Open page outside the browser viewer', () => {
  it('shows the page address and opens it from an expanded web step', () => {
    render(<CardBlock card={card({ thumb: site('https://example.com/docs') })} showStatus={false} />)

    expect(screen.getByText('example.com/docs')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open page' }))
    expect(openPreview).toHaveBeenCalledTimes(1)
    expect(openPreview.mock.calls[0][0]).toMatchObject({ kind: 'url', url: 'https://example.com/docs' })
  })

  it('offers nothing for a step without a page', () => {
    render(<CardBlock card={card({ family: 'terminal' })} showStatus={false} />)

    expect(screen.queryByRole('button', { name: 'Open page' })).toBeNull()
  })

  it('opens the page from a settled row without toggling it', () => {
    render(<ToolCard group={group([card({ thumb: site('https://example.com/a') })])} />)

    const toggle = screen.getByRole('button', { expanded: false })
    fireEvent.click(screen.getByRole('button', { name: 'Open page' }))
    expect(openPreview).toHaveBeenCalledTimes(1)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the page from a live row too', () => {
    render(<ToolCard group={group([card({ state: 'running', thumb: site('https://example.com/b') })], 'running')} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open page' }))
    expect(openPreview.mock.calls[0][0]).toMatchObject({ url: 'https://example.com/b' })
  })
})
