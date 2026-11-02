import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

/**
 * The Desktop-local room's header, after adopting the gateway layout.
 *
 * Before this, the local room kept a bare trash button beside Settings and
 * Manage members while the gateway room hid Disband behind an overflow — the
 * same room, two different answers to "how close is a slipped click to a lost
 * room". These assertions pin the shared answer: one primary action (Stop, and
 * only while the room runs), and everything destructive behind the overflow.
 */

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const base = await pluginSdkMock(createGroupGateway().host)

  return {
    ...base,
    // The real Button forwards refs and props; a stub here cannot anchor the
    // Radix trigger, so the overflow would never open.
    Button: sdk.Button,
    RowButton: sdk.RowButton,
    Codicon: () => null,
    ConfirmDialog: () => null,
    CopyButton: () => null,
    Dialog: () => null,
    DialogContent: () => null,
    DialogDescription: () => null,
    DialogFooter: () => null,
    DialogHeader: () => null,
    DialogTitle: () => null,
    Input: () => null,
    MessageTextContent: ({ text }: { text: string }) => <span>{text}</span>,
    Tip: ({ children }: { children: ReactNode }) => children,
    ToggleRow: () => null,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    relativeTime: () => 'now',
    useI18n: () => ({ t: { common: { back: 'Back', cancel: 'Cancel', save: 'Save' } } }),
    usePluginI18n: () => translateBots
  }
})
vi.mock('./avatar', () => ({ avatarColor: () => '#888', botAppearance: () => ({}), BotFace: () => null }))
vi.mock('./group-chat-parts', () => ({
  GroupClarifyCard: () => null,
  GroupImageControls: () => null,
  GroupMentionInput: () => null
}))

afterEach(cleanup)

const openMenu = (trigger: HTMLElement) => {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  fireEvent.click(trigger)
}

it('keeps Disband and Manage members off the header row', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  $groupChats.set({ Room: { log: [], sessions: {}, watermarks: {} } })
  render(<GroupChatWorkspace group="Room" members={[]} />)

  // One element handle for the whole test: while the menu is open Radix hands
  // the trigger's accessible name to the menu, so re-querying mid-open fails.
  const trigger = await screen.findByRole('button', { name: 'More actions' })

  expect(screen.queryByRole('button', { name: /^Disband Room$/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Manage group members' })).toBeNull()

  openMenu(trigger)
  expect(await screen.findByRole('menuitem', { name: 'Disband Room' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: 'Manage members' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: 'Group settings for Room' })).toBeTruthy()
})

it('promotes Stop to the header only while the room is running', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  $groupChats.set({ Room: { log: [], running: true, sessions: {}, watermarks: {} } })
  const { rerender } = render(<GroupChatWorkspace group="Room" members={[]} />)

  expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy()

  // The activity disclosure no longer repeats it: a single room-wide action
  // belongs in one place, not once per working member.
  expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(1)

  $groupChats.set({ Room: { log: [], running: false, sessions: {}, watermarks: {} } })
  rerender(<GroupChatWorkspace group="Room" members={[]} />)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull())
})
