import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toggleGroupChatPinned } = vi.hoisted(() => ({ toggleGroupChatPinned: vi.fn() }))
const { groupChats } = vi.hoisted(() => ({ groupChats: { get: vi.fn(() => ({})) } }))

vi.mock('./group-pin', () => ({ toggleGroupChatPinned }))
vi.mock('./group-chat', () => ({
  $groupChats: groupChats,
  groupChatRoomKey: (name: string, room: { roomId?: string }) => `name:${name}:room:${room?.roomId ?? ''}`
}))

import { $roomArchive, isRoomArchived, setRoomArchived } from './group-archive'

const KEY = 'hermes.bots.roomArchive.v1'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  $roomArchive.set({})
  groupChats.get.mockReturnValue({})
})

describe('room archive store', () => {
  it('archives and unarchives a room key', () => {
    expect(isRoomArchived($roomArchive.get(), 'name:a:room:1')).toBe(false)

    setRoomArchived('name:a:room:1', true)

    expect(isRoomArchived($roomArchive.get(), 'name:a:room:1')).toBe(true)

    setRoomArchived('name:a:room:1', false)

    expect(isRoomArchived($roomArchive.get(), 'name:a:room:1')).toBe(false)
  })

  it('persists the archived keys to localStorage', () => {
    setRoomArchived('name:a:room:1', true)
    setRoomArchived('name:b:room:2', true)

    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({
      'name:a:room:1': true,
      'name:b:room:2': true
    })

    setRoomArchived('name:a:room:1', false)

    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({ 'name:b:room:2': true })
  })

  it('loads archived keys stored by an earlier session', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ 'name:old:room:9': true }))
    vi.resetModules()

    const { $roomArchive: fresh } = await import('./group-archive')

    expect(isRoomArchived(fresh.get(), 'name:old:room:9')).toBe(true)
  })

  it('unpins the room when it is archived, and leaves pins alone on unarchive', () => {
    groupChats.get.mockReturnValue({
      room: { roomId: '1', pinned: true },
      other: { roomId: '2', pinned: false }
    })

    setRoomArchived('name:room:room:1', true)

    expect(toggleGroupChatPinned).toHaveBeenCalledWith('room')

    vi.clearAllMocks()

    setRoomArchived('name:room:room:1', false)

    expect(toggleGroupChatPinned).not.toHaveBeenCalled()
  })

  it('ignores empty keys and tombstoned rooms', () => {
    groupChats.get.mockReturnValue({ gone: { roomId: '3', pinned: true, tombstone: true } })

    setRoomArchived('', true)
    setRoomArchived('name:gone:room:3', true)

    expect($roomArchive.get()).toEqual({ 'name:gone:room:3': true })
    expect(toggleGroupChatPinned).not.toHaveBeenCalled()
  })
})
