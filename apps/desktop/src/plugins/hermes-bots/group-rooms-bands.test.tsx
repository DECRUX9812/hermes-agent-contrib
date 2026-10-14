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

import { $roomArchive } from './group-archive'
import { $groupChats } from './group-chat'
import type { RoomQuickFilter, RoomStatusSnapshot } from './group-row'
import type { RosterGroupRow } from './roster-pane-derivation'
import { GroupRoomsBands } from './roster-pane-groups'
import { $collapsedBotSections, toggleBotSectionCollapsed } from './user-sections'

const rows: RosterGroupRow[] = [
  { active: false, kind: 'group', members: [], name: 'Pinned', pinned: true, activity: 3 },
  { active: false, kind: 'group', members: [], name: 'Working', pinned: false, activity: 2 },
  { active: false, kind: 'group', members: [], name: 'Quiet', pinned: false, activity: 1 }
]

const archivedRow: RosterGroupRow = { active: false, kind: 'group', members: [], name: 'Old', pinned: false, activity: 0 }

const statuses: Record<string, RoomStatusSnapshot> = {
  Pinned: { needsYou: false, unread: 0, working: false },
  Working: { needsYou: true, unread: 2, working: true },
  Quiet: { needsYou: false, unread: 0, working: false }
}

function Harness({
  bandRows,
  rooms = {},
  rowList = rows,
  statusMap = statuses
}: {
  bandRows?: (rows: RosterGroupRow[]) => React.ReactNode
  rooms?: Record<string, { roomId: string }>
  rowList?: RosterGroupRow[]
  statusMap?: Record<string, RoomStatusSnapshot>
}) {
  const collapsedSections = useValue($collapsedBotSections)

  const [filter, setFilter] = useState<RoomQuickFilter>('all')

  return (
    <GroupRoomsBands
      cardMode={false}
      filter={filter}
      onFilter={setFilter}
      renderBandRows={bandRows ?? (band => band.map(row => <div data-testid={`band-row:${row.name}`} key={row.name} />))}
      renderRow={row => <div data-testid={`band-row:${row.name}`} key={row.name} />}
      rooms={rooms as never}
      rosterSectionCollapsed={id => collapsedSections.has(id)}
      rows={rowList}
      statuses={statusMap}
      toggleRosterSection={toggleBotSectionCollapsed}
    />
  )
}

beforeEach(() => {
  storage.clear()
  window.localStorage.clear()
  $groupChats.set({})
  $roomArchive.set({})
  $collapsedBotSections.set(new Set())
})

describe('room bands', () => {
  it('renders pinned, active and archived bands with counts, and only pins when pinned', () => {
    $groupChats.set({ Old: { log: [], members: [], roomId: 'r-old' } as never })
    $roomArchive.set({ 'id:r-old': true })

    render(<Harness rooms={{ Old: { roomId: 'r-old' } }} rowList={[...rows, archivedRow]} />)

    expect(screen.getByRole('button', { name: 'Pinned 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Active 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archived 1' })).toBeTruthy()
    expect(screen.getByTestId('band-row:Pinned')).toBeTruthy()
    expect(screen.getByTestId('band-row:Working')).toBeTruthy()
  })

  it('hides the pinned band when nothing is pinned', () => {
    render(<Harness rowList={rows.filter(row => !row.pinned)} />)

    expect(screen.queryByRole('button', { name: /Pinned/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Active 2' })).toBeTruthy()
  })

  it('starts archived folded and expands on click', () => {
    $groupChats.set({ Old: { log: [], members: [], roomId: 'r-old' } as never })
    $roomArchive.set({ 'id:r-old': true })

    render(<Harness rooms={{ Old: { roomId: 'r-old' } }} rowList={[...rows, archivedRow]} />)

    expect(screen.queryByTestId('band-row:Old')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Archived 1' }))

    expect(screen.getByTestId('band-row:Old')).toBeTruthy()
  })

  it('collapses the active band on click', () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Active 2' }))

    expect(screen.queryByTestId('band-row:Working')).toBeNull()
  })
})

describe('room quick filters', () => {
  it('shows counts and filters rooms, rooms only', () => {
    render(<Harness />)

    expect(screen.getByRole('button', { name: 'All 3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Working 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Needs you 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unread 1' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Working 1' }))

    expect(screen.getByTestId('band-row:Working')).toBeTruthy()
    expect(screen.queryByTestId('band-row:Quiet')).toBeNull()
    expect(screen.queryByTestId('band-row:Pinned')).toBeNull()
  })

  it('shows one muted line when the filter hides everything', () => {
    const idle: Record<string, RoomStatusSnapshot> = {
      Pinned: { needsYou: false, unread: 0, working: false },
      Working: { needsYou: false, unread: 0, working: false },
      Quiet: { needsYou: false, unread: 0, working: false }
    }

    render(<Harness statusMap={idle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Working' }))

    expect(screen.getByText('No rooms match')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Active/ })).toBeNull()
  })
})
