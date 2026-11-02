/**
 * The room's "Manage members" picker: localized chrome, and an offline seat
 * that says so instead of looking like a member that will answer.
 */
import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { atom: nanoAtom } = await import('nanostores')

  return {
    ...sdk,
    host: {
      ...sdk.host,
      notify: vi.fn(),
      notifyError: vi.fn(),
      state: { ...sdk.host.state, focusedSessionOwner: nanoAtom(null) }
    },
    usePluginI18n: () => translateBots
  }
})

const { $botMeta, $lastRoster } = await import('./data')
const { GroupMemberPicker } = await import('./group-chat-view-members')
const { $groupChats } = await import('./group-chat')

afterEach(cleanup)

it('names its chrome and marks a seat whose gateway is offline', () => {
  $botMeta.set({})
  $groupChats.set({})
  $lastRoster.set([
    { connectionId: 'local', name: 'research' },
    // A remote seat that cannot answer: the picker keeps it listed (dropping it
    // on save would silently remove the member) but must label it.
    { connectionId: 'vera', name: 'builder', remoteSource: true, sourceReachable: false }
  ])

  render(<GroupMemberPicker group="Design Room" members={[]} onClose={vi.fn()} open />)

  expect(screen.getByText('Manage members')).toBeTruthy()
  expect(screen.getByText(/Pick 2–\d+ bots for “Design Room”/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Save members' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()

  // Exactly one of the two seats is unreachable, and it is named.
  expect(screen.getAllByText('Offline')).toHaveLength(1)
})

it('toggles a seat and keeps the save action honest about the minimum', () => {
  $botMeta.set({})
  $groupChats.set({})
  $lastRoster.set([
    { connectionId: 'local', name: 'research' },
    { connectionId: 'local', name: 'builder' }
  ])

  render(<GroupMemberPicker group="Room" members={[]} onClose={vi.fn()} open />)

  const save = screen.getByRole('button', { name: 'Save members' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)

  fireEvent.click(screen.getByRole('checkbox', { name: /Research/i }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Builder/i }))

  expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2)
  expect((screen.getByRole('button', { name: 'Save members' }) as HTMLButtonElement).disabled).toBe(false)
})
