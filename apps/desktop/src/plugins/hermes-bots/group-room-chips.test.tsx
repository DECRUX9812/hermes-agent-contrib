import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RoomHandoff } from './group-room-handoffs'
import type { RoomVote } from './group-room-votes'
import { translateBots } from './i18n-test-helper'
import type { GroupMember } from './types'

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')
  const base = await pluginSdkMock({})

  return {
    ...base,
    Button: (props: React.ComponentProps<'button'>) => <button type="button" {...props} />,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: ({ name }: { name: string }) => <span aria-hidden data-icon={name} />,
    relativeTime: () => 'now',
    Tip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useI18n: () => ({ t: { common: {} } }),
    usePluginI18n: () => translateBots
  }
})

vi.mock('./avatar', () => ({
  avatarColor: (color: string) => color,
  botAppearance: () => ({ color: '#336699', image: null, shape: 'circle' }),
  BotFace: ({ name }: { name: string }) => <span data-name={name} data-testid="mock-face" />
}))

vi.mock('./avatar-image', () => ({
  isBackfilledFacePng: () => false
}))

vi.mock('./routing', () => ({
  botRosterMeta: () => null
}))

const MEMBERS: GroupMember[] = [
  { name: 'atlas', title: '' },
  { name: 'pixel', title: '' }
]

const HANDOFF: RoomHandoff = {
  at: Date.now(),
  doneWhen: 'land the hero',
  dueMinutes: null,
  from: 'atlas',
  fromUser: false,
  id: 'h1',
  index: 0,
  line: 1,
  reply: 't1',
  replyIndex: 1,
  stale: 'fresh',
  status: 'working',
  task: 'draft the hero layout',
  thread: 't1',
  to: 'pixel',
  why: 'pixel owns the tokens'
}

function vote(decided: string): RoomVote {
  return {
    at: Date.now(),
    decided,
    decidedIndex: decided ? 2 : -1,
    from: 'atlas',
    id: 'v1',
    index: 0,
    missing: [],
    options: ['Ship it', 'Wait'],
    question: 'Ship the hero?',
    thread: 't1',
    votes: {}
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HandoffChip', () => {
  it('renders from, to, task and status without the full card', async () => {
    const { HandoffChip } = await import('./group-room-chips')

    render(<HandoffChip handoff={HANDOFF} members={MEMBERS} nameOf={name => name} />)

    const chip = screen.getByTestId('group-event-chip')

    expect(chip.tagName).toBe('BUTTON')
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(chip.getAttribute('data-handoff-status')).toBe('working')
    expect(within(chip).getByText('atlas')).toBeTruthy()
    expect(within(chip).getByText('pixel')).toBeTruthy()
    expect(within(chip).getByText('draft the hero layout')).toBeTruthy()
    expect(within(chip).getByText('Working')).toBeTruthy()
    expect(screen.queryByTestId('group-handoff-card')).toBeNull()
  })

  it('expands the full card in place and collapses again', async () => {
    const { HandoffChip } = await import('./group-room-chips')

    render(<HandoffChip handoff={HANDOFF} members={MEMBERS} nameOf={name => name} />)

    const chip = screen.getByTestId('group-event-chip')

    fireEvent.click(chip)

    expect(chip.getAttribute('aria-expanded')).toBe('true')
    expect(chip.parentElement?.parentElement?.querySelector('[data-open="true"]')).toBeTruthy()

    const card = screen.getByTestId('group-handoff-card')

    expect(card.getAttribute('data-handoff-status')).toBe('working')
    expect(within(card).getByText('draft the hero layout')).toBeTruthy()

    fireEvent.click(chip)

    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('group-handoff-card').closest('.motion-collapse')?.getAttribute('data-open')).toBe('false')
  })

  it('is a native button, so Enter and Space toggle it for keyboard readers', async () => {
    const { HandoffChip } = await import('./group-room-chips')

    render(<HandoffChip handoff={HANDOFF} members={MEMBERS} nameOf={name => name} />)

    const chip = screen.getByRole('button', { name: 'Handoff from atlas to pixel' })

    chip.focus()

    expect(chip.matches(':focus')).toBe(true)
    expect(chip.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('VoteChip', () => {
  it('renders a decided vote as a chip and expands its card', async () => {
    const { VoteChip } = await import('./group-room-chips')
    const onCall = vi.fn()

    render(<VoteChip members={MEMBERS} nameOf={name => name} onCall={onCall} vote={vote('Ship it')} />)

    const chip = screen.getByTestId('group-event-chip')

    expect(within(chip).getByText('Decided: Ship it')).toBeTruthy()
    expect(screen.queryByTestId('group-vote-card')).toBeNull()

    fireEvent.click(chip)

    expect(chip.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('group-vote-card')).toBeTruthy()

    fireEvent.click(chip)

    expect(screen.getByTestId('group-vote-card').closest('.motion-collapse')?.getAttribute('data-open')).toBe('false')
  })

  it('leaves open votes as full cards through LineCards', async () => {
    const { LineCards } = await import('./group-room-cards')
    const onCall = vi.fn()

    render(
      <LineCards
        handoffsAt={new Map()}
        index={0}
        members={MEMBERS}
        nameOf={name => name}
        onCall={onCall}
        votesAt={new Map([[0, [vote('')]]])}
      />
    )

    expect(screen.getByTestId('group-vote-card')).toBeTruthy()
    expect(screen.queryByTestId('group-event-chip')).toBeNull()
  })

  it('renders a decided vote as a chip through LineCards', async () => {
    const { LineCards } = await import('./group-room-cards')
    const onCall = vi.fn()

    render(
      <LineCards
        handoffsAt={new Map()}
        index={0}
        members={MEMBERS}
        nameOf={name => name}
        onCall={onCall}
        votesAt={new Map([[0, [vote('Ship it')]]])}
      />
    )

    expect(screen.getByTestId('group-event-chip')).toBeTruthy()
    expect(screen.queryByTestId('group-vote-card')).toBeNull()
  })
})
