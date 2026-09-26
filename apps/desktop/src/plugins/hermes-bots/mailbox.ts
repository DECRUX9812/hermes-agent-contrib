/**
 * The agent mailbox (#48): structured async task hand-offs between bots —
 * `bots_mailbox.*` on each connected gateway over that install's shared note
 * store (`tools/bot_mailbox.py`). Bots file notes through `message_agent`'s
 * `task` param and flip them with `update_task`; this module is the union
 * view: it fans out `bots_mailbox.list` across every connection
 * `host.profileRoutes()` knows, stamps each note with the connection it was
 * read from so writes route back to the right gateway, and dedupes by id
 * (the sender mints the id, so a relayed copy can never fork).
 */

import { host, queryClient, useQuery } from '@hermes/plugin-sdk'

import { RELAY_DELIVER_TIMEOUT_MS } from './relay'
import { ID } from './shared'
import type { GroupMember, ProfileRoute } from './types'

export const MAILBOX_KEY = [ID, 'mailbox']

/** A note's asker or addressee, as `tools/bot_mailbox.py::_normalize_party`
 *  stores it. `kind` is 'bot' or 'user'; `connection` is the sender-side id —
 *  display only, never routing. */
export interface MailboxParty {
  connection?: string
  handle?: string
  kind?: string
  name?: string
  profile?: string
}

export type MailboxNoteStatus = 'accepted' | 'declined' | 'done' | 'open'

/** One note as `bots_mailbox.list` returns it, plus the connection it was
 *  read from (the union's write-back route). */
export interface MailboxNote {
  body?: string
  /** Stamped by fetchMailboxNotes — the connection whose gateway owns the
   *  canonical copy; `updateMailboxNote`/`sendMailboxNote` route on it. */
  connectionId?: string
  created_at?: number
  id: string
  kind?: string
  payload?: Record<string, unknown> | null
  reply?: string
  room?: string
  sender?: MailboxParty
  status?: MailboxNoteStatus
  title: string
  to?: MailboxParty
  updated_at?: number
}

/** One route per connection — the same collapse the relay uses: any profile
 *  route onto a gateway reaches its install-wide mailbox. */
function mailboxRoutes(routes: ProfileRoute[]): Map<string, ProfileRoute> {
  const byConnection = new Map<string, ProfileRoute>()

  for (const route of Array.isArray(routes) ? routes : []) {
    const id = String(route?.connectionId || '')

    if (id && !byConnection.has(id)) {
      byConnection.set(id, route)
    }
  }

  return byConnection
}

/** Every connected install's mailbox, unioned. An unreachable or older
 *  gateway (no bots_mailbox.*) contributes nothing — never fails the view. */
export async function fetchMailboxNotes(): Promise<MailboxNote[]> {
  if (typeof host.profileRoutes !== 'function' || typeof host.requestProfile !== 'function') {
    return []
  }

  const routes = mailboxRoutes(await host.profileRoutes().catch(() => [] as ProfileRoute[]))
  const seen = new Set<string>()
  const notes: MailboxNote[] = []

  await Promise.all(
    [...routes.entries()].map(async ([connectionId, route]) => {
      try {
        const res = await host.requestProfile<{ notes?: MailboxNote[] }>(route, 'bots_mailbox.list', {})

        for (const note of Array.isArray(res?.notes) ? res.notes : []) {
          const key = `${connectionId}::${String(note?.id || '')}`

          if (note?.id && !seen.has(key)) {
            seen.add(key)
            notes.push({ ...note, connectionId })
          }
        }
      } catch {
        /* offline gateway or an older backend — this connection adds no notes */
      }
    })
  )

  notes.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))

  return notes
}

export function useMailbox() {
  return useQuery({
    queryKey: MAILBOX_KEY,
    queryFn: fetchMailboxNotes,
    refetchInterval: 8000,
    staleTime: 5000
  })
}

/** Drop the cached union so the next render refetches (after a send/update). */
export function invalidateMailbox() {
  void queryClient?.invalidateQueries?.({ queryKey: MAILBOX_KEY })?.catch?.(() => {})
}

/** Resolve the route a note's canonical copy lives behind (the connection
 *  it was stamped with). */
async function routeForNote(note: MailboxNote): Promise<ProfileRoute | null> {
  if (typeof host.profileRoutes !== 'function') {
    return null
  }

  const routes = mailboxRoutes(await host.profileRoutes().catch(() => [] as ProfileRoute[]))

  return routes.get(String(note.connectionId || '')) || null
}

/** File a user-authored note and deliver its text — `bots_mailbox.send` on
 *  the connection that hosts the target's mailbox (local bots deliver a full
 *  turn, remote ones queue onto the relay). Returns the stored note. */
export async function sendMailboxNote(
  member: GroupMember,
  input: { body?: string; title: string }
): Promise<MailboxNote> {
  const route = member?.route

  if (!route) {
    throw new Error('bot is not reachable')
  }

  const res = await host.requestProfile<{ note?: MailboxNote; delivery_error?: string }>(
    route,
    'bots_mailbox.send',
    {
      to: String(member.handle || member.name || ''),
      title: input.title,
      body: input.body || ''
    },
    // A local target takes a whole turn — same deadline as a relayed DM.
    RELAY_DELIVER_TIMEOUT_MS
  )

  invalidateMailbox()

  return { ...(res?.note || { id: '', title: input.title }), connectionId: route.connectionId }
}

/** Flip a note's status on the gateway that owns it. */
export async function updateMailboxNote(note: MailboxNote, status: MailboxNoteStatus): Promise<void> {
  const route = await routeForNote(note)

  if (!route) {
    throw new Error('mailbox gateway is not connected')
  }

  await host.requestProfile(route, 'bots_mailbox.update', { id: note.id, status })
  invalidateMailbox()
}

/** Notes a room shows: ones addressed to (or sent by) a member, matched on
 *  handle OR profile name against each member row. Remote members carry the
 *  connection the note lives on. */
export function roomMailboxNotes(notes: MailboxNote[], members: GroupMember[]): MailboxNote[] {
  const seen = new Set<string>()

  const keys = members.flatMap(member =>
    [member?.handle, member?.name]
      .map(value => `${String(member?.connectionId || '')}::${String(value || '').toLowerCase()}`)
      .filter(key => !key.endsWith('::'))
  )

  return notes.filter(note => {
    for (const party of [note?.to, note?.sender]) {
      if (!party || party.kind !== 'bot') {
        continue
      }

      const partyKeys = [party.handle, party.profile]
        .map(value => `${String(note?.connectionId || '')}::${String(value || '').toLowerCase()}`)
        .filter(key => !key.endsWith('::'))

      if (partyKeys.some(key => keys.includes(key)) && !seen.has(note.id)) {
        seen.add(note.id)

        return true
      }
    }

    return false
  })
}

/** Open notes addressed to ONE bot — the roster row's badge. */
export function mailboxOpenCountFor(notes: MailboxNote[], member: GroupMember): number {
  const handle = String(member?.handle || '').toLowerCase()
  const name = String(member?.name || '').toLowerCase()
  const connectionId = String(member?.connectionId || '')

  return notes.filter(note => {
    if (note.status !== 'open' || note.to?.kind !== 'bot') {
      return false
    }

    if (connectionId && String(note.connectionId || '') !== connectionId) {
      return false
    }

    const toHandle = String(note.to?.handle || '').toLowerCase()
    const toProfile = String(note.to?.profile || '').toLowerCase()

    return (handle && toHandle === handle) || (name && toProfile === name)
  }).length
}
