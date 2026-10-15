import type * as HermesSdk from '@hermes/plugin-sdk'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBotsIn } from './i18n-test-helper'
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

import { useValue } from '@hermes/plugin-sdk'

import { $botMeta } from './data'
import { $roomArchive } from './group-archive'
import { $groupChats, $groupClarify, $groupNeedsYou } from './group-chat'
import type { RoomQuickFilter } from './group-row'
import { roomStatusFor } from './group-row'
import type { RosterGroupRow } from './roster-pane-derivation'
import { $draggingRoom, $roomDropTarget, GroupRoomsBands } from './roster-pane-groups'
import { RosterGroupRowView } from './roster-pane-groups'
import type { GroupMember } from './types'
import { $collapsedBotSections, toggleBotSectionCollapsed } from './user-sections'

const dragData = () => ({ setData: vi.fn(), getData: () => '', effectAllowed: 'move' as const })

const SEATS = [{ name: 'alpha' }, { name: 'beta' }]

function seedRooms(extra: Record<string, Record<string, unknown>> = {}) {
  $groupChats.set({
    A: { log: [], members: SEATS, roomId: 'r-a', rosterOrder: 0, ...extra.A },
    B: { log: [], members: SEATS, roomId: 'r-b', rosterOrder: 1, ...extra.B },
    C: { log: [], members: SEATS, roomId: 'r-c', rosterOrder: 2, ...extra.C }
  } as never)
  $botMeta.set({})
}

function rowList(rooms: ReturnType<typeof $groupChats.get>): RosterGroupRow[] {
  return ['A', 'B', 'C'].map((name): RosterGroupRow => ({
    active: false,
    kind: 'group',
    members: [] as GroupMember[],
    name,
    pinned: Boolean(rooms[name]?.pinned),
    activity: 0
  }))
}

const orders = (): Record<string, unknown> =>
  Object.fromEntries(Object.entries($groupChats.get()).map(([name, room]) => [name, room.rosterOrder]))

// Read the rooms through the hook: under the React Compiler a bare
// `$groupChats.get()` in render is memoized and never refreshes.
function FlatList() {
  const rooms = useValue($groupChats)

  return (
    <>
      {rowList(rooms).map(row => (
        <RosterGroupRowView
          active={false}
          bandNames={['A', 'B', 'C']}
          group={row.name}
          groupClarify={{}}
          groupNeedsYou={{}}
          groupRooms={rooms}
          key={row.name}
          members={[]}
          onDisband={() => undefined}
          onNewSection={() => undefined}
          onOpen={() => undefined}
          sortedGroupRows={rowList(rooms)}
        />
      ))}
    </>
  )
}

function Bands() {
  const collapsedSections = useValue($collapsedBotSections)

  const rooms = useValue($groupChats)
  const [filter, setFilter] = useState<RoomQuickFilter>('all')
  const rows = rowList(rooms)

  const statuses = Object.fromEntries(
    rows.map(row => [row.name, roomStatusFor(rooms[row.name], { needsYou: false, readAt: 0 })])
  )

  const pass = (list: RosterGroupRow[]) =>
    list.map(row => (
      <RosterGroupRowView
        active={false}
        bandNames={list.map(entry => entry.name)}
        group={row.name}
        groupClarify={{}}
        groupNeedsYou={{}}
        groupRooms={rooms}
        key={row.name}
        members={[]}
        onDisband={() => undefined}
        onNewSection={() => undefined}
        onOpen={() => undefined}
        sortedGroupRows={rows}
      />
    ))

  return (
    <GroupRoomsBands
      cardMode={false}
      filter={filter}
      onFilter={setFilter}
      renderBandRows={pass}
      renderRow={row => pass(rows.filter(entry => entry.name === row.name))}
      rooms={rooms}
      rosterSectionCollapsed={id => collapsedSections.has(id)}
      rows={rows}
      statuses={statuses}
      toggleRosterSection={toggleBotSectionCollapsed}
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
  $draggingRoom.set(null)
  $roomDropTarget.set(null)
  $collapsedBotSections.set(new Set())
})

describe('drag to reorder', () => {
  it('writes rosterOrder after a drop between rows', () => {
    seedRooms()

    render(<FlatList />)

    const target = document.querySelector('[data-flip-key="group:A"]')!

    fireEvent.dragStart(document.querySelector('[data-flip-key="group:C"]')!, { dataTransfer: dragData() })
    fireEvent.dragOver(target, { clientY: -1, dataTransfer: dragData() })

    expect(document.querySelector('.bg-brand')).toBeTruthy()

    fireEvent.drop(target, { dataTransfer: dragData() })

    expect(orders()).toEqual({ A: 1, B: 2, C: 0 })
  })

  it('moves one place with Alt+Arrow on a focused room row', () => {
    seedRooms()

    render(<FlatList />)

    fireEvent.keyDown(screen.getByRole('button', { name: /A,/ }), { altKey: true, key: 'ArrowDown' })

    expect(orders()).toEqual({ A: 1, B: 0, C: 2 })

    fireEvent.keyDown(screen.getByRole('button', { name: /C,/ }), { altKey: true, key: 'ArrowUp' })

    expect(orders()).toEqual({ A: 2, B: 0, C: 1 })
  })

  it('ignores a drop that crosses pin bands', () => {
    seedRooms({ A: { pinned: true } })

    render(<FlatList />)

    fireEvent.dragStart(document.querySelector('[data-flip-key="group:B"]')!, { dataTransfer: dragData() })
    fireEvent.drop(document.querySelector('[data-flip-key="group:A"]')!, { dataTransfer: dragData() })

    expect($groupChats.get().B.pinned).toBeFalsy()
    expect(orders()).toEqual({ A: 0, B: 1, C: 2 })
  })
})

describe('band header drops', () => {
  it('pins on the Pinned header and unpins on Active', () => {
    seedRooms()

    render(<Bands />)

    expect(screen.queryByRole('button', { name: /Pinned/ })).toBeNull()

    fireEvent.dragStart(document.querySelector('[data-flip-key="group:B"]')!, { dataTransfer: dragData() })

    // The empty Pinned band offers itself as a drop target mid-drag.
    fireEvent.drop(screen.getByRole('button', { name: 'Pinned 0' }).parentElement!, { dataTransfer: dragData() })

    expect($groupChats.get().B.pinned).toBe(true)
    expect(screen.getByRole('button', { name: 'Pinned 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Active 2' })).toBeTruthy()

    fireEvent.dragStart(document.querySelector('[data-flip-key="group:B"]')!, { dataTransfer: dragData() })
    fireEvent.drop(screen.getByRole('button', { name: 'Active 2' }).parentElement!, { dataTransfer: dragData() })

    expect($groupChats.get().B.pinned).toBe(false)
    expect(screen.getByRole('button', { name: 'Active 3' })).toBeTruthy()
  })

  it('archives on the Archived header and unpins the room', () => {
    seedRooms({ B: { pinned: true } })

    render(<Bands />)

    expect(screen.getByRole('button', { name: 'Pinned 1' })).toBeTruthy()

    fireEvent.dragStart(document.querySelector('[data-flip-key="group:B"]')!, { dataTransfer: dragData() })
    fireEvent.drop(screen.getByRole('button', { name: 'Archived 0' }).parentElement!, { dataTransfer: dragData() })

    expect($groupChats.get().B.pinned).toBeFalsy()
    expect($roomArchive.get()).toEqual({ 'id:r-b': true })
    expect(screen.getByRole('button', { name: 'Archived 1' })).toBeTruthy()
  })

  it('brings an archived room back when it lands on Active', () => {
    seedRooms()

    render(<Bands />)

    fireEvent.dragStart(document.querySelector('[data-flip-key="group:B"]')!, { dataTransfer: dragData() })
    fireEvent.drop(screen.getByRole('button', { name: 'Archived 0' }).parentElement!, { dataTransfer: dragData() })

    expect($roomArchive.get()).toEqual({ 'id:r-b': true })

    fireEvent.click(screen.getByRole('button', { name: 'Archived 1' }))
    fireEvent.dragStart(document.querySelector('[data-flip-key="group:B"]')!, { dataTransfer: dragData() })
    fireEvent.drop(screen.getByRole('button', { name: 'Active 2' }).parentElement!, { dataTransfer: dragData() })

    expect($roomArchive.get()).toEqual({})
    expect(screen.getByRole('button', { name: 'Active 3' })).toBeTruthy()
  })
})
