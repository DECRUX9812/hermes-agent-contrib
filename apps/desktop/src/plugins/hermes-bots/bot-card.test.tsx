import type * as HermesSdk from '@hermes/plugin-sdk'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $groupChats } from './group-chat'
import { translateBots } from './i18n-test-helper'

const { openRosterBot, warmProfile } = vi.hoisted(() => ({ openRosterBot: vi.fn(), warmProfile: vi.fn() }))
vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, host: { ...sdk.host, warmProfile }, usePluginI18n: () => translateBots }
})
vi.mock('./roster-actions', () => ({ openRosterBot }))
vi.mock('./bot-menu', () => ({ BotRowMenu: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('./model-menu', () => ({ BotModelChip: () => <button type="button">Choose model</button> }))
const { BotCard } = await import('./bot-card')
const noop = () => undefined

const renderCard = () =>
  render(<BotCard bot={{ name: 'alpha' }} onDelete={noop} onEdit={noop} onGroup={noop} onNewSection={noop} />)

beforeEach(() => {
  vi.clearAllMocks()
  $groupChats.set({})
  openRosterBot.mockResolvedValue(true)
})
afterEach(cleanup)

describe('card action boundaries', () => {
  it('shows the same live member mood as the list row and settles when the room stops', () => {
    const view = renderCard()
    act(() => $groupChats.set({ Room: { log: [], watermarks: {}, running: true, turn: { name: 'alpha' } } }))
    // Presence uses the owner-qualified identity, not whichever card was last clicked.
    expect(view.container.querySelector('[data-hb-mood]')?.getAttribute('data-hb-mood')).toBe('think')
    act(() => $groupChats.set({}))
    expect(view.container.querySelector('[data-hb-mood]')?.getAttribute('data-hb-mood')).toBe('idle')
  })
  it('does not open a chat when the model control receives a keyboard event', () => {
    renderCard()
    const model = screen.getByRole('button', { name: 'Choose model' })
    fireEvent.keyDown(model, { key: 'Enter' })
    fireEvent.keyDown(model, { key: ' ' })
    fireEvent.click(model)
    expect(openRosterBot).not.toHaveBeenCalled()
  })

  it('offers one native chat action and warms only after focus or hover', () => {
    renderCard()
    expect(warmProfile).not.toHaveBeenCalled()
    const chat = screen.getByRole('button', { name: /Open chat/ })
    fireEvent.focus(chat)
    expect(warmProfile).toHaveBeenCalled()
    fireEvent.click(chat)
    expect(openRosterBot).toHaveBeenCalledTimes(1)
    expect(openRosterBot).toHaveBeenCalledWith(expect.objectContaining({ name: 'alpha' }))
  })
})

describe('card footer recency', () => {
  const freshBot = { name: 'alpha', worker_session: { last_active: Date.now() } }

  const renderFresh = () =>
    render(<BotCard bot={freshBot} onDelete={noop} onEdit={noop} onGroup={noop} onNewSection={noop} />)

  it('reads "Active now" for a fresh bot instead of the templated "Active now ago"', () => {
    renderFresh()
    expect(screen.getByText('Active now')).toBeTruthy()
    expect(screen.queryByText(/Active now ago/)).toBeNull()
  })

  it('keeps the model chip and the recency on separate stacked rows', () => {
    const view = renderFresh()
    const footer = view.container.querySelector('.mt-auto')
    expect(footer, 'card footer exists').toBeTruthy()
    // flex-col: chip row and recency row are stacked — sharing one line let the
    // chip overflow onto the age text (measured overlap in the live DOM).
    expect(footer?.className).toContain('flex-col')
    expect(footer?.children.length).toBe(2)
  })
})
