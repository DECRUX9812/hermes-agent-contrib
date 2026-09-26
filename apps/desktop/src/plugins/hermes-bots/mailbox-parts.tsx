/**
 * The mailbox's leaf components (#48): the note card group chats and the
 * roster's task list render, and the "Assign task" compose dialog a bot row's
 * menu opens. Both talk to `bots_mailbox.*` through `mailbox.ts` — nothing
 * here touches the note files directly.
 */

import { Button, cn, Codicon, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, host, Input, Textarea, useI18n } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { useBots } from './i18n'
import { displayName } from './labels'
import type { MailboxNote, MailboxNoteStatus } from './mailbox'
import { sendMailboxNote, updateMailboxNote } from './mailbox'
import type { GroupMember } from './types'

const STATUS_ICONS: Record<MailboxNoteStatus, string> = {
  accepted: 'check',
  declined: 'circle-slash',
  done: 'check-all',
  open: 'inbox'
}

function statusLabel(b: ReturnType<typeof useBots>, status: MailboxNoteStatus): string {
  switch (status) {
    case 'accepted':
      return b.mailbox.statusAccepted

    case 'declined':
      return b.mailbox.statusDeclined

    case 'done':
      return b.mailbox.statusDone

    default:
      return b.mailbox.statusOpen
  }
}

function partyLabel(party: MailboxNote['to'] | MailboxNote['sender'], members: GroupMember[], you: string): string {
  if (!party || party.kind === 'user') {
    return you
  }

  const member = members.find(m => {
    const handle = String(m?.handle || '').toLowerCase()
    const name = String(m?.name || '').toLowerCase()

    return (handle && handle === String(party.handle || '').toLowerCase()) || (name && name === String(party.profile || '').toLowerCase())
  })

  return member ? displayName(member) : party.name || (party.handle ? `@${party.handle}` : party.profile || '?')
}

/** One note: sender → addressee, title, body, status chip, and the triage
 *  buttons an open note takes (the same transitions the bot's update_task
 *  tool enforces). Terminal notes render the reply instead. */
export function MailboxNoteCard({ note, members }: { note: MailboxNote; members: GroupMember[] }) {
  const b = useBots()
  const [busy, setBusy] = useState(false)
  const status = (note.status || 'open') as MailboxNoteStatus
  const open = status === 'open'

  const setStatus = (next: MailboxNoteStatus) => {
    if (busy) {
      return
    }

    setBusy(true)
    void updateMailboxNote(note, next)
      .catch(error => host.notify({ kind: 'error', message: b.mailbox.updateFailed(String(error?.message || error)) }))
      .finally(() => setBusy(false))
  }

  return (
    <div className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-surface-secondary) px-2.5 py-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Codicon className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)" name="mail" />
        <span className="min-w-0 truncate font-medium text-(--ui-text-secondary)">{note.title}</span>
        <span
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium',
            status === 'open' && 'bg-(--ui-accent) text-(--ui-accent-foreground, #fff) opacity-90',
            status === 'accepted' && 'bg-(--chrome-action-hover) text-(--ui-text-secondary)',
            status === 'declined' && 'bg-(--chrome-action-hover) text-(--ui-text-quaternary)',
            status === 'done' && 'bg-(--chrome-action-hover) text-(--ui-text-tertiary)'
          )}
        >
          <Codicon name={STATUS_ICONS[status]} />
          {statusLabel(b, status)}
        </span>
      </div>
      <div className="mt-0.5 text-[0.6875rem] text-(--ui-text-quaternary)">
        {b.mailbox.cardRoute(partyLabel(note.sender, members, b.group.you), partyLabel(note.to, members, b.group.you))}
      </div>
      {note.body ? (
        <div className="mt-1 whitespace-pre-wrap break-words text-(--ui-text-tertiary)">{note.body}</div>
      ) : null}
      {note.reply ? (
        <div className="mt-1 border-t border-(--ui-stroke-tertiary) pt-1 text-(--ui-text-tertiary)">
          {b.mailbox.replyPrefix}: {note.reply}
        </div>
      ) : null}
      {open ? (
        <div className="mt-1.5 flex gap-1">
          <Button disabled={busy} onClick={() => setStatus('accepted')} size="sm" variant="secondary">
            {b.mailbox.accept}
          </Button>
          <Button disabled={busy} onClick={() => setStatus('done')} size="sm" variant="secondary">
            {b.mailbox.markDone}
          </Button>
          <Button disabled={busy} onClick={() => setStatus('declined')} size="sm" variant="ghost">
            {b.mailbox.decline}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** "Assign task to <bot>" — title + optional body, filed as a note and
 *  delivered into the bot's canonical Bot Chat (or queued onto the relay for
 *  a remote member). */
export function MailboxTaskDialog({ member, onClose }: { member: GroupMember | null; onClose: () => void }) {
  const b = useBots()
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const send = () => {
    if (!member || !title.trim() || sending) {
      return
    }

    setSending(true)
    void sendMailboxNote(member, { title: title.trim(), body: body.trim() })
      .then(() => {
        host.notify({ kind: 'success', message: b.mailbox.sent(displayName(member)) })
        onClose()
      })
      .catch(error => host.notify({ kind: 'error', message: b.mailbox.sendFailed(String(error?.message || error)) }))
      .finally(() => setSending(false))
  }

  return (
    <Dialog onOpenChange={open => !open && onClose()} open={Boolean(member)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{member ? b.mailbox.assignTitle(displayName(member)) : b.mailbox.assignTitleGeneric}</DialogTitle>
          <DialogDescription>{b.mailbox.assignDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-1">
          <Input
            autoFocus
            onChange={event => setTitle(event.target.value)}
            placeholder={b.mailbox.titlePlaceholder}
            value={title}
          />
          <Textarea
            className="min-h-20"
            onChange={event => setBody(event.target.value)}
            placeholder={b.mailbox.bodyPlaceholder}
            value={body}
          />
        </div>
        <DialogFooter>
          <Button onClick={onClose} size="sm" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={!title.trim() || sending} onClick={send} size="sm">
            {b.mailbox.send}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The roster's mailbox section: every non-terminal note across the connected
 *  installs, as cards. Rendered inside the roster's scroll area — an empty
 *  mailbox renders nothing, so a clean install sees no chrome. Tasks are
 *  assigned from a bot row's "Assign task…" menu item. */
export function RosterMailboxSection({
  collapsed,
  notes,
  roster,
  onToggle
}: {
  collapsed: boolean
  notes: MailboxNote[]
  roster: GroupMember[]
  onToggle: () => void
}) {
  const b = useBots()

  if (!notes.length) {
    return null
  }

  return (
    <div className="mt-1 border-t border-(--ui-stroke-tertiary) pt-1" key={'mailbox-section'}>
      <button
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[0.6875rem] font-medium text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover)"
        onClick={onToggle}
        type="button"
      >
        <Codicon name={collapsed ? 'chevron-right' : 'chevron-down'} />
        <span>{b.mailbox.section}</span>
        <span className="text-(--ui-text-quaternary)">{notes.length}</span>
      </button>
      {!collapsed ? (
        <div className="grid gap-1 px-1 pb-1">
          {notes.map(note => (
            <MailboxNoteCard key={`${note.connectionId || ''}:${note.id}`} members={roster} note={note} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
