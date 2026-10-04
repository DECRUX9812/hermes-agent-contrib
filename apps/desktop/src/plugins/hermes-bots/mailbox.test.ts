/**
 * The agent mailbox union view (#48): notes are read via `bots_mailbox.list`
 * fanned out across every connection (one route per install, since the mailbox
 * is install-wide), stamped with the connection they were read from so writes
 * route back to the owning gateway. `roomMailboxNotes` is the group-chat
 * filter: a note renders in a room when a member is its sender or addressee,
 * matched on handle OR profile name against that connection.
 */

import type * as PluginSdk from '@hermes/plugin-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchMailboxNotes,
  type MailboxNote,
  mailboxOpenCountFor,
  roomMailboxNotes,
  sendMailboxNote,
  updateMailboxNote
} from './mailbox'
import type { GroupMember, ProfileRoute } from './types'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const actual = await importOriginal<typeof PluginSdk>()

  return {
    ...actual,
    host: {
      ...actual.host,
      profileRoutes: vi.fn(async () => [] as ProfileRoute[]),
      requestProfile: vi.fn()
    }
  }
})

const { host } = await import('@hermes/plugin-sdk')
const routesMock = vi.mocked(host.profileRoutes!)
const requestMock = vi.mocked(host.requestProfile!)

beforeEach(() => {
  vi.clearAllMocks()
  routesMock.mockResolvedValue([])
})

function note(over: Partial<MailboxNote> = {}): MailboxNote {
  return {
    id: 'mbx_1',
    title: 'task',
    status: 'open',
    to: { kind: 'bot', handle: 'bob', profile: 'bob' },
    sender: { kind: 'bot', handle: 'alice', profile: 'alice' },
    ...over
  }
}

function member(over: Partial<GroupMember> = {}): GroupMember {
  return { name: 'bob', handle: 'bob', connectionId: 'conn-a', ...over } as GroupMember
}

const ROUTE_A = { connectionId: 'conn-a', profile: 'main' } as ProfileRoute
const ROUTE_B = { connectionId: 'conn-b', profile: 'main' } as ProfileRoute

describe('fetchMailboxNotes', () => {
  it('fans out one list call per connection and stamps the route connection', async () => {
    // Two profiles on the same install share one mailbox — collapse to one call.
    routesMock.mockResolvedValue([ROUTE_A, { ...ROUTE_A, profile: 'other' } as ProfileRoute, ROUTE_B])
    requestMock.mockImplementation(async (route, method) => {
      expect(method).toBe('bots_mailbox.list')

      return route === ROUTE_A
        ? { notes: [note({ id: 'mbx_a', created_at: 1 })] }
        : { notes: [note({ id: 'mbx_b', created_at: 2 })] }
    })

    const notes = await fetchMailboxNotes()
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(notes.map(n => n.id)).toEqual(['mbx_b', 'mbx_a'])
    expect(notes.map(n => n.connectionId)).toEqual(['conn-b', 'conn-a'])
  })

  it('contributes nothing for a gateway that fails or lacks bots_mailbox', async () => {
    routesMock.mockResolvedValue([ROUTE_A, ROUTE_B])
    requestMock.mockImplementation(async route => {
      if (route === ROUTE_B) {
        throw new Error('unknown method bots_mailbox.list')
      }

      return { notes: [note()] }
    })

    const notes = await fetchMailboxNotes()
    expect(notes).toHaveLength(1)
    expect(notes[0].connectionId).toBe('conn-a')
  })
})

describe('sendMailboxNote / updateMailboxNote', () => {
  it('sends on the member route and returns the stamped note', async () => {
    routesMock.mockResolvedValue([ROUTE_A])
    requestMock.mockResolvedValue({ note: note({ id: 'mbx_new' }) })

    const sent = await sendMailboxNote(member({ route: ROUTE_A }), { title: 'Do the thing', body: 'details' })
    expect(requestMock).toHaveBeenCalledWith(
      ROUTE_A,
      'bots_mailbox.send',
      { to: 'bob', title: 'Do the thing', body: 'details' },
      expect.any(Number)
    )
    expect(sent.connectionId).toBe('conn-a')
  })

  it('updates on the connection that owns the note', async () => {
    routesMock.mockResolvedValue([ROUTE_A, ROUTE_B])
    requestMock.mockResolvedValue({ note: note({ status: 'done' }) })

    await updateMailboxNote(note({ connectionId: 'conn-b' }), 'done')
    expect(requestMock).toHaveBeenCalledWith(ROUTE_B, 'bots_mailbox.update', {
      id: 'mbx_1',
      status: 'done'
    })
  })
})

describe('roomMailboxNotes', () => {
  it('includes notes a member sends or receives on their connection', () => {
    const members = [member({ name: 'alice', handle: 'alice', connectionId: 'conn-a' })]

    const notes = [
      note({ id: 'in', connectionId: 'conn-a' }),
      note({ id: 'other-conn', connectionId: 'conn-b' }),
      note({ id: 'unrelated', connectionId: 'conn-a', to: { kind: 'bot', handle: 'carol' }, sender: undefined })
    ]

    expect(roomMailboxNotes(notes, members).map(n => n.id)).toEqual(['in'])
  })

  it('dedupes a note that matches more than one member', () => {
    const members = [
      member({ name: 'alice', handle: 'alice', connectionId: 'conn-a' }),
      member({ name: 'bob', handle: 'bob', connectionId: 'conn-a' })
    ]

    expect(roomMailboxNotes([note({ connectionId: 'conn-a' })], members)).toHaveLength(1)
  })

  it('matches a member on profile name when no handle is stored', () => {
    const members = [member({ handle: '', connectionId: 'conn-a' })]

    expect(roomMailboxNotes([note({ connectionId: 'conn-a' })], members)).toHaveLength(1)
  })
})

describe('mailboxOpenCountFor', () => {
  it('counts open notes addressed to the bot on its connection only', () => {
    const bob = member()

    const notes = [
      note({ connectionId: 'conn-a' }),
      note({ id: 'mbx_2', connectionId: 'conn-a', status: 'done' }),
      note({ id: 'mbx_3', connectionId: 'conn-b' }),
      note({ id: 'mbx_4', connectionId: 'conn-a', to: { kind: 'bot', handle: 'carol', profile: 'carol' } }),
      note({ id: 'mbx_5', connectionId: 'conn-a', to: { kind: 'user', handle: 'bob', profile: 'bob' } })
    ]

    expect(mailboxOpenCountFor(notes, bob)).toBe(1)
  })
})
