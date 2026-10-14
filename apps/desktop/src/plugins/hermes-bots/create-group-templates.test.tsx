import type * as HermesSdk from '@hermes/plugin-sdk'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBotsIn } from './i18n-test-helper'
import type * as RoutingModule from './routing'
import type * as SharedModule from './shared'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, host: { ...sdk.host, notify: vi.fn() }, usePluginI18n: () => translateBotsIn('en') }
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

const mocked = vi.hoisted(() => ({
  chats: null as null | {
    get: () => Record<string, Record<string, unknown>>
    set: (value: Record<string, Record<string, unknown>>) => void
  },
  meta: null as null | { get: () => Record<string, unknown>; set: (value: Record<string, unknown>) => void },
  setGroupChatGoal: vi.fn(),
  setGroupChatListener: vi.fn(),
  setRoomRoles: vi.fn()
}))

const { setGroupChatGoal, setGroupChatListener, setRoomRoles } = mocked

vi.mock('./group-chat', async () => {
  const { atom } = await import('nanostores')

  mocked.chats = atom<Record<string, Record<string, unknown>>>({})

  return {
    $groupChats: mocked.chats,
    GROUP_CHAT_MAX_MEMBERS: 8,
    groupChatRoomKey: (name: string, room: { roomId?: string }) => `name:${name}:room:${room?.roomId ?? ''}`,
    mintGroupRoomId: () => 'room-1',
    setGroupChatGoal: mocked.setGroupChatGoal,
    setGroupChatListener: mocked.setGroupChatListener,
    uniqueGroupChatName: (base: string) => base,
    updateGroupChat: (name: string, fn: (room: Record<string, unknown>) => Record<string, unknown>) => {
      const chats = mocked.chats!

      chats.set({ ...chats.get(), [name]: fn(chats.get()[name] ?? { members: [] }) })
    }
  }
})

vi.mock('./group-room-roles', () => ({ setRoomRoles: mocked.setRoomRoles }))

vi.mock('./data', async () => {
  const { atom } = await import('nanostores')

  mocked.meta = atom({})

  return {
    $botMeta: mocked.meta,
    $lastRoster: atom([]),
    ROSTER_KEY: 'r',
    botHandle: (name: string) => name,
    botRosterKey: (bot: { name?: string }) => `legacy::${bot?.name}`,
    filterBots: (roster: unknown[]) => roster,
    saveBotMeta: vi.fn()
  }
})

vi.mock('./routing', async importOriginal => ({
  ...(await importOriginal<typeof RoutingModule>()),
  botRosterMeta: () => undefined
}))

import { CreateGroupChatDialog } from './create-dialog'
import {
  assignGroupRole,
  buildGroupRoleLabels,
  GROUP_TEMPLATES,
  groupLeadListenerKey
} from './create-group-templates'
import type { RosterRow } from './types'

const roster = [{ name: 'alpha' }, { name: 'beta' }] as RosterRow[]

function openDialog() {
  render(<CreateGroupChatDialog onClose={() => undefined} onCreated={() => undefined} open roster={roster} />)
}

function checkBot(name: 'alpha' | 'beta') {
  const boxes = screen.getAllByRole('checkbox')

  fireEvent.click(boxes[name === 'alpha' ? 0 : 1])
}

beforeEach(() => {
  storage.clear()
  mocked.chats?.set({})
  vi.clearAllMocks()
})

describe('group template helpers', () => {
  it('keeps a single Lead across seats', () => {
    const one = assignGroupRole({}, 'legacy::alpha', 'Lead')
    const two = assignGroupRole(one, 'legacy::beta', 'Lead')

    expect(two).toEqual({ 'legacy::alpha': 'Member', 'legacy::beta': 'Lead' })
  })

  it('builds member-keyed labels without the default Member', () => {
    expect(buildGroupRoleLabels(roster, { 'legacy::alpha': 'Lead', 'legacy::beta': 'Member' })).toEqual({
      alpha: 'Lead'
    })
    expect(groupLeadListenerKey(roster, { 'legacy::alpha': 'Lead' })).toBe('alpha')
    expect(groupLeadListenerKey(roster, {})).toBeNull()
  })

  it('ships the specced templates', () => {
    expect(GROUP_TEMPLATES.map(template => template.id)).toEqual(['blank', 'launch', 'research', 'review', 'standup'])
    expect(GROUP_TEMPLATES.find(template => template.id === 'launch')?.roles).toEqual([
      'Lead',
      'Researcher',
      'Designer',
      'Builder',
      'Writer'
    ])
  })
})

describe('new group dialog templates', () => {
  it('fills the room name from the template until the user types one', () => {
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: /Research desk/ }))

    expect((screen.getByLabelText('Group name') as HTMLInputElement).value).toBe('Research desk')

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Our room' } })
    fireEvent.click(screen.getByRole('radio', { name: /Launch team/ }))

    expect((screen.getByLabelText('Group name') as HTMLInputElement).value).toBe('Our room')
  })

  it('offers role selects per seat and writes goal, listener and labels on create', () => {
    openDialog()

    fireEvent.click(screen.getByRole('radio', { name: /Research desk/ }))
    checkBot('alpha')
    checkBot('beta')

    const alphaRole = screen.getByLabelText(/Role: alpha/i) as HTMLSelectElement
    const betaRole = screen.getByLabelText(/Role: beta/i) as HTMLSelectElement

    expect(alphaRole.value).toBe('Member')
    fireEvent.change(alphaRole, { target: { value: 'Lead' } })
    fireEvent.change(betaRole, { target: { value: 'Researcher' } })
    // One room, one Lead: taking Lead drops it from the other seat.
    fireEvent.change(betaRole, { target: { value: 'Lead' } })

    expect(alphaRole.value).toBe('Member')
    expect(betaRole.value).toBe('Lead')

    fireEvent.change(alphaRole, { target: { value: 'Researcher' } })
    fireEvent.change(betaRole, { target: { value: 'Lead' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Group (2)' }))

    expect(setGroupChatGoal).toHaveBeenCalledWith(
      'Research desk',
      'Answer the question with sources and a short brief.'
    )
    expect(setGroupChatListener).toHaveBeenCalledWith('Research desk', 'beta')
    expect(setRoomRoles).toHaveBeenCalledWith('name:Research desk:room:room-1', {
      alpha: 'Researcher',
      beta: 'Lead'
    })
  })

  it('writes no goal for the blank template', () => {
    openDialog()

    checkBot('alpha')
    checkBot('beta')
    fireEvent.click(screen.getByRole('button', { name: /Create Group/ }))

    expect(setGroupChatGoal).not.toHaveBeenCalled()
    expect(setGroupChatListener).not.toHaveBeenCalled()
    expect(setRoomRoles).not.toHaveBeenCalled()
  })
})
