/**
 * Team OS slice 5 — the "Needs you" strip renders the universal categories.
 *
 * The strip's index is content-free, so the row shows: the category's label,
 * the classified reason and the ref (artifact URI / dependency id) on the
 * quiet line — never a message body. The pre-existing kinds keep their copy.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'
import type { NeedsYouEntry } from './needs-you'
import type { RosterRow } from './types'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, usePluginI18n: () => translateBots }
})

const { $needsYouIndex } = await import('./needs-you')
const { TriageStrip } = await import('./triage-strip')

const noop = () => undefined
const BOT = [{ name: 'alpha' }] as RosterRow[]

const card = (
  fields: Pick<NeedsYouEntry, 'category' | 'id'> & Partial<NeedsYouEntry>
): NeedsYouEntry => ({ at: 1_700_000_000_000, bot: 'local::alpha', ...fields })

beforeEach(() => {
  $needsYouIndex.set({})
})

afterEach(cleanup)

describe('the Needs you strip renders the explicit categories', () => {
  it('renders a failed handoff with its classified reason', () => {
    $needsYouIndex.set({
      'local::alpha': [card({ category: 'handoff-failed', id: 'handoff:e1', reason: 'provider_auth_or_access' })]
    })

    render(<TriageStrip bots={BOT} onOpen={noop} />)

    expect(screen.getByTestId('bot-triage-strip')).toBeTruthy()
    expect(screen.getByText(/handoff failed/)).toBeTruthy()
    expect(screen.getByText(/provider_auth_or_access/)).toBeTruthy()
  })

  it('renders a blocked dependency with the id it waits on', () => {
    $needsYouIndex.set({
      'local::alpha': [card({ category: 'blocked', id: 'dep:9', reason: 'dependency', ref: 'task-9' })]
    })

    render(<TriageStrip bots={BOT} onOpen={noop} />)

    expect(screen.getByText(/blocked on a dependency/)).toBeTruthy()
    expect(screen.getByText(/task-9/)).toBeTruthy()
  })

  it('renders an artifact-review card with the artifact ref', () => {
    $needsYouIndex.set({
      'local::alpha': [
        card({ category: 'artifact-review', id: 'art:1', ref: 'file:///tmp/report.md' })
      ]
    })

    render(<TriageStrip bots={BOT} onOpen={noop} />)

    expect(screen.getByText(/artifact ready for review/)).toBeTruthy()
    expect(screen.getByText(/file:\/\/\/tmp\/report\.md/)).toBeTruthy()
    // One card per bot, and the action says what you are about to do.
    expect(screen.getAllByTestId(/^bot-triage:/)).toHaveLength(1)
    expect(screen.getByRole('button', { name: /open alpha/i })).toBeTruthy()
    expect(screen.getByText('Review')).toBeTruthy()
  })

  it('stays hidden while the index has no card for anyone', () => {
    $needsYouIndex.set({ 'local::alpha': [] })

    render(<TriageStrip bots={BOT} onOpen={noop} />)

    expect(screen.queryByTestId('bot-triage-strip')).toBeNull()
  })
})
