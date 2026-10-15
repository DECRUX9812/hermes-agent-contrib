import type * as HermesSdk from '@hermes/plugin-sdk'
import { render, screen } from '@testing-library/react'
import { type ComponentProps, createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { translateBotsIn } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, usePluginI18n: () => translateBotsIn('en') }
})

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'hermes-bots' }))

import { renderRosterContent } from './roster-pane-content'
import type { RosterGroupRow } from './roster-pane-derivation'
import type { RosterRow } from './types'

type Props = Parameters<typeof renderRosterContent>[0]

const bots: RosterRow[] = [{ name: 'atlas' }, { name: 'nova' }]
const room: RosterGroupRow = { active: false, activity: 5, kind: 'group', members: [], name: 'Launch crew', pinned: false }

function Content(props: Props) {
  return <div data-testid="pane">{renderRosterContent(props)}</div>
}

function propsFor(overrides: Partial<Props>): Props {
  return {
    allBotsHidden: false,
    b: translateBotsIn('en'),
    cardMode: false,
    creatingStarter: null,
    error: null,
    gatewaySections: { sectioned: false, sections: [] } as unknown as Props['gatewaySections'],
    gatewayUp: true,
    hasRosterConstraint: false,
    hiddenBots: [],
    hiddenExpanded: false,
    hiddenGatewaySections: [],
    hiddenSectionRef: createRef(),
    initialRosterLoading: false,
    isLoading: false,
    mailboxCollapsed: false,
    mailboxNotes: [],
    matchingHiddenBots: [],
    onNewBot: () => {},
    query: '',
    refetch: (() => Promise.resolve()) as unknown as Props['refetch'],
    renderBotRow: bot => <div key={bot.name}>{bot.name}</div>,
    renderGatewaySection: () => null,
    renderGroupChatSection: () => (
      <section data-testid="rooms-block" key="group-chats">
        rooms
      </section>
    ),
    renderHiddenGatewaySection: () => null,
    renderUserSections: (rows => (
      <div data-testid="user-sections" key="user-sections">
        {rows.map(row => (row.kind === 'group' ? `room:${row.name}` : `bot:${row.bot.name}`)).join(' ')}
      </div>
    )) as Props['renderUserSections'],
    roster: bots,
    rosterRows: [room, ...bots.map(bot => ({ bot, kind: 'bot' as const }))] as Props['rosterRows'],
    selectedGateway: undefined,
    showGatewaySections: false,
    showHiddenRows: false,
    showHiddenSection: false,
    sortedGroupRows: [room],
    staleNotice: null,
    toggleMailboxSection: () => {},
    ...overrides
  } as ComponentProps<typeof Content>
}

describe('roster content with a single gateway', () => {
  it('lists rooms in their own block above the bots instead of mixing them in', () => {
    render(<Content {...propsFor({})} />)

    const block = screen.getByTestId('rooms-block')
    const sections = screen.getByTestId('user-sections')

    expect(sections.textContent).toBe('bot:atlas bot:nova')
    expect(block.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows no rooms block when there are no rooms', () => {
    render(<Content {...propsFor({ rosterRows: bots.map(bot => ({ bot, kind: 'bot' as const })) as Props['rosterRows'], sortedGroupRows: [] })} />)

    expect(screen.queryByTestId('rooms-block')).toBeNull()
    expect(screen.getByTestId('user-sections').textContent).toBe('bot:atlas bot:nova')
  })
})
