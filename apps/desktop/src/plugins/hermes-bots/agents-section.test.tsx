/**
 * The Sessions-rail Agents fold's contract: it lists the same bots the roster
 * does (hidden bots and unreachable sources stay out), opens them through the
 * roster's own click path, and hands management to the Bots pane — it never
 * grows into a second roster.
 *
 * Click identity is the point of the surface: the row delegates whole to
 * openRosterBot, so a rail click resolves the same canonical (profile,
 * "Bot Chat") a pane click does — never a session-id pointer.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentsSection } from './agents-section'
import type * as botsData from './data'
import { $botMeta } from './data'
import { translateBotsIn } from './i18n-test-helper'
import type { RosterRow } from './types'

const { openRosterBot, revealPane, rosterData, warmAgent, warmProfile } = vi.hoisted(() => ({
  openRosterBot: vi.fn(),
  revealPane: vi.fn(),
  rosterData: { value: { profiles: [] as RosterRow[], sources: [] } },
  warmAgent: vi.fn(),
  warmProfile: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, revealPane, warmAgent, warmProfile },
    // The plugin bundle normally lands via `ctx.i18n.register` at load, so
    // without this every localized label in the section renders empty.
    usePluginI18n: () => translateBotsIn('en')
  }
})

vi.mock('./data', async importOriginal => {
  const data = await importOriginal<typeof botsData>()

  return {
    ...data,
    useRoster: () => ({ data: rosterData.value, error: undefined, refetch: vi.fn() })
  }
})

vi.mock('./roster-actions', () => ({ openRosterBot }))

// The lifecycle publish (meta merge, unread poll, avatar pull) is the pane's
// job under test elsewhere; the fold only needs it to exist.
vi.mock('./roster-pane-lifecycle', () => ({
  $lastSources: { get: () => [], listen: () => () => undefined, set: vi.fn() },
  usePublishRosterSnapshot: vi.fn()
}))

vi.mock('./create-dialog', () => ({
  CreateAgentDialog: () => null,
  CreateGroupChatDialog: () => null,
  GroupDialog: () => null
}))

const bot = (name: string, extra: Partial<RosterRow> = {}): RosterRow => ({ name, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  $botMeta.set({})
  rosterData.value = { profiles: [], sources: [] }
  openRosterBot.mockResolvedValue(true)
})

describe('AgentsSection lists the roster, not a shadow of it', () => {
  it('renders each visible bot and opens it through openRosterBot', () => {
    rosterData.value = {
      profiles: [bot('alpha'), bot('researcher')],
      sources: []
    }

    render(<AgentsSection />)

    fireEvent.click(screen.getByRole('button', { name: /alpha/i }))

    expect(openRosterBot).toHaveBeenCalledWith(expect.objectContaining({ name: 'alpha' }))
  })

  it('keeps hidden bots and unreachable-source rows out of the rail', () => {
    $botMeta.set({ hidden_bot: { hidden: true } })
    rosterData.value = {
      profiles: [
        bot('alpha'),
        bot('hidden_bot'),
        bot('gone', { connectionId: 'gone', remoteSource: true, sourceReachable: false })
      ],
      sources: []
    }

    render(<AgentsSection />)

    expect(screen.queryByRole('button', { name: /hidden_bot/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /gone/i })).toBeNull()
    expect(screen.getByRole('button', { name: /alpha/i })).toBeTruthy()
  })

  it('caps the rows and hands the rest to the Bots pane', () => {
    rosterData.value = {
      profiles: Array.from({ length: 10 }, (_, i) => bot(`agent${String(i).padStart(2, '0')}`)),
      sources: []
    }

    render(<AgentsSection />)

    // 7 rows + the footer — the cap keeps the rail a rail.
    expect(screen.getAllByRole('button', { name: /agent\d\d ·/i })).toHaveLength(7)

    fireEvent.click(screen.getByRole('button', { name: /All 10 bots/i }))

    expect(revealPane).toHaveBeenCalledWith('hermes-bots:pane')
  })

  it('pre-dials only the hovered bot, on its own source when source-scoped', () => {
    rosterData.value = {
      profiles: [bot('alpha'), bot('remote', { connectionId: 'ssh', sourceScoped: true })],
      sources: []
    }

    render(<AgentsSection />)

    expect(warmProfile).not.toHaveBeenCalled()
    expect(warmAgent).not.toHaveBeenCalled()

    fireEvent.pointerEnter(screen.getByRole('button', { name: /remote/i }))
    expect(warmAgent.mock.calls).toEqual([['ssh', 'remote']])
  })
})
