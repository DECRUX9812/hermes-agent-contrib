import type * as HermesSdk from '@hermes/plugin-sdk'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBots, translateBotsIn } from './i18n-test-helper'
import type * as SharedModule from './shared'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, usePluginI18n: () => translateBotsIn('en') }
})

const { storage } = vi.hoisted(() => ({ storage: new Map<string, unknown>() }))

vi.mock('./shared', async importOriginal => {
  const shared = await importOriginal<typeof SharedModule>()

  return {
    ...shared,
    getPluginCtx: () => ({
      storage: {
        get: (key: string, fallback: unknown) => (storage.has(key) ? storage.get(key) : fallback),
        set: (key: string, value: unknown) => storage.set(key, value)
      }
    })
  }
})

import { $botMeta } from './data'
import { $roomArchive } from './group-archive'
import { $groupChats, $groupClarify, $groupNeedsYou, groupChatRoomKey } from './group-chat'
import { GroupRow } from './group-row'
import type { GroupMember } from './types'
import { $botSections, $collapsedBotSections } from './user-sections'

const memberCount = (n: number): string => translateBots('group.memberCount', n)

const members = (names: string[]): GroupMember[] => names.map(name => ({ name }) as GroupMember)

function seedRoom(
  name: string,
  room: Record<string, unknown> = {},
  roomMembers: GroupMember[] = members(['a', 'b', 'c', 'd', 'e'])
) {
  const full = { log: [], members: [], roomId: `room-${name}`, ...room }

  $groupChats.set({ [name]: full as never })
  $botMeta.set({})

  return { full, roomMembers }
}

function renderRow(
  group: string,
  roomMembers: GroupMember[],
  props: Partial<Parameters<typeof GroupRow>[0]> = {}
) {
  return render(
    <GroupRow
      active={false}
      group={group}
      members={roomMembers}
      needsYou={false}
      onDisband={() => undefined}
      onNewSection={() => undefined}
      onOpen={() => undefined}
      {...props}
    />
  )
}

beforeEach(() => {
  storage.clear()
  window.localStorage.clear()
  $groupChats.set({})
  $botMeta.set({})
  $roomArchive.set({})
  $groupNeedsYou.set({})
  $groupClarify.set({})
  $botSections.set([])
  $collapsedBotSections.set(new Set())
})

describe('group room row', () => {
  it('renders a 2x2 face mosaic for a full room and one face for a solo room', () => {
    const { roomMembers } = seedRoom('Alpha')
    const view = renderRow('Alpha', roomMembers)
    const mosaic = view.getByTestId('group-room-mosaic')

    expect(mosaic.querySelectorAll('span[data-hb-mood], svg[data-bot-face]').length).toBe(4)

    view.unmount()

    const solo = seedRoom('Solo', {}, members(['solo']))
    const soloView = renderRow('Solo', solo.roomMembers)

    expect(soloView.getByTestId('group-room-mosaic').querySelectorAll('span[data-hb-mood], svg[data-bot-face]').length).toBe(1)
  })

  it('shows the name, the member count preview, and a reorder grip on hover affordance', () => {
    const { roomMembers } = seedRoom('Alpha')

    renderRow('Alpha', roomMembers)

    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText(memberCount(5))).toBeTruthy()
    expect(screen.getByLabelText('Drag to reorder')).toBeTruthy()
  })

  it('rings the mosaic and shimmers the preview while the room works', () => {
    const { roomMembers } = seedRoom('Alpha', { running: true })

    const view = renderRow('Alpha', roomMembers)
    const mosaic = view.getByTestId('group-room-mosaic')

    expect(mosaic.className).toContain('motion-ring')
    expect(screen.getByText(memberCount(5)).className).toContain('motion-shimmer')
  })

  it('marks needs-you rooms and counts unread member messages', () => {
    const log = [
      { at: 100, from: { kind: 'member', name: 'a' }, text: 'first' },
      { at: 200, from: { kind: 'member', name: 'b' }, text: 'second line here' }
    ]

    const { roomMembers } = seedRoom('Alpha', { log })

    renderRow('Alpha', roomMembers, { needsYou: true })

    expect(screen.getByLabelText(translateBots('roster.needsInput'))).toBeTruthy()
    expect(screen.getByLabelText(translateBots('group.unreadCount', 2))).toBeTruthy()
    expect(screen.getByText('second line here')).toBeTruthy()
  })

  it('archives and unarchives from the row menu', () => {
    const { full, roomMembers } = seedRoom('Alpha')

    renderRow('Alpha', roomMembers)

    const key = groupChatRoomKey('Alpha', full as never)

    fireEvent.contextMenu(screen.getByText('Alpha'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))

    expect($roomArchive.get()[key]).toBe(true)

    fireEvent.contextMenu(screen.getByText('Alpha'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unarchive' }))

    expect($roomArchive.get()[key]).toBeUndefined()
  })
})
