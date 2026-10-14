/**
 * Per-room subscriptions: room B's store and its GroupRow stay quiet when
 * room A gets a message.
 */
import type * as HermesSdk from '@hermes/plugin-sdk'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $groupChats } from './group-chat'
import { groupChatRoomStore } from './group-room-store'
import { GroupRow } from './group-row'
import type * as GroupUnread from './group-unread'
import { translateBotsIn } from './i18n-test-helper'

const seenRooms = vi.hoisted(() => [] as unknown[])

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, usePluginI18n: () => translateBotsIn('en') }
})

vi.mock('./group-unread', async importOriginal => {
  const actual = await importOriginal<typeof GroupUnread>()

  return {
    ...actual,
    groupLastRoundSummary: (room: unknown) => {
      seenRooms.push(room)

      return actual.groupLastRoundSummary(room as never)
    }
  }
})

const noop = () => undefined

function seed() {
  $groupChats.set({
    alpha: { log: [], running: false, watermarks: {} },
    beta: { log: [], running: false, watermarks: {} }
  } as never)
}

function renderRows() {
  render(
    <>
      <GroupRow
        active={false}
        group="alpha"
        members={[]}
        needsYou={false}
        onDisband={noop}
        onNewSection={noop}
        onOpen={noop}
      />
      <GroupRow
        active={false}
        group="beta"
        members={[]}
        needsYou={false}
        onDisband={noop}
        onNewSection={noop}
        onOpen={noop}
      />
    </>
  )
}

beforeEach(() => {
  seenRooms.length = 0
  seed()
})

afterEach(() => {
  cleanup()
  $groupChats.set({})
})

describe('groupChatRoomStore', () => {
  it('hands out one cached store per room name', () => {
    expect(groupChatRoomStore('alpha')).toBe(groupChatRoomStore('alpha'))
  })

  it('notifies only the room whose object changed and keeps the other reference', () => {
    const before = $groupChats.get()
    const heardA: unknown[] = []
    const heardB: unknown[] = []
    const stopA = groupChatRoomStore('alpha').listen(value => heardA.push(value))
    const stopB = groupChatRoomStore('beta').listen(value => heardB.push(value))

    // The write pattern updateGroupChat uses: a fresh map, untouched rooms
    // keeping their object identity.
    act(() => {
      $groupChats.set({ ...before, alpha: { ...before.alpha, log: [{ at: 1, from: { kind: 'user' }, text: 'hi' }] } as never })
    })

    expect(heardA).toHaveLength(1)
    expect(heardB).toHaveLength(0)
    expect(groupChatRoomStore('beta').get()).toBe(before.beta)

    stopA()
    stopB()
  })

  it('notifies the room that changed', () => {
    const before = $groupChats.get()
    const heardB: unknown[] = []
    const stopB = groupChatRoomStore('beta').listen(value => heardB.push(value))

    act(() => {
      $groupChats.set({ ...before, beta: { ...before.beta, running: true } as never })
    })

    expect(heardB).toHaveLength(1)

    stopB()
  })
})

describe('GroupRow subscriptions', () => {
  it('re-renders only the row whose room got the message', () => {
    renderRows()
    expect(seenRooms).toHaveLength(2)
    seenRooms.length = 0

    act(() => {
      const before = $groupChats.get()
      $groupChats.set({
        ...before,
        alpha: { ...before.alpha, log: [{ at: 1, from: { kind: 'user' }, text: 'hello alpha' }] } as never
      })
    })

    expect(seenRooms).toHaveLength(1)
    expect(($groupChats.get().alpha as { log: unknown[] }).log).toHaveLength(1)

    act(() => {
      const before = $groupChats.get()
      $groupChats.set({ ...before, beta: { ...before.beta, running: true } as never })
    })

    expect(seenRooms).toHaveLength(2)
  })
})
