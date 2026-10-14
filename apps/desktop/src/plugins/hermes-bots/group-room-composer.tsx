/**
 * One composer box for a room: the main one (starts a new thread) and the
 * thread panel's reply box draw the same thing. Pending attachments preview
 * above the input; the room owns the drafts and the send.
 */

import { Button, Codicon, Tip } from '@hermes/plugin-sdk'
import type { ClipboardEvent } from 'react'

import { GroupMentionInput } from './group-chat-parts'
import { useBots } from './i18n'
import type { Attachment, GroupMember } from './types'

/** Round arrow send: the 1:1 composer's primary icon button look, so both
 *  composers read the same. */
const SEND_BTN =
  'size-7 shrink-0 rounded-full p-0 bg-fg text-surface hover:bg-fg/90 disabled:bg-fg/30 disabled:text-surface disabled:opacity-100'

export interface GroupRoomComposerProps {
  ariaLabel: string
  images: Attachment[]
  members: GroupMember[]
  onChange: (text: string) => void
  onEscape?: () => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onPick: () => void
  onRemoveImage: (index: number) => void
  onSubmit: () => void
  placeholder: string
  sendLabel: string
  value: string
}

function AttachmentChips({ images, onRemove }: { images: Attachment[]; onRemove: (index: number) => void }) {
  const b = useBots()

  if (!images.length) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1" data-testid="group-composer-attachments">
      {images.map((img, index) => (
        <div
          className="flex items-center gap-1 rounded-control border border-line bg-surface-sunken px-1 py-0.5"
          key={`${img.name || 'img'}:${index}`}
        >
          {img.kind === 'pdf' || img.kind === 'file' ? (
            <Codicon className="text-fg-muted" name={img.kind === 'pdf' ? 'file-pdf' : 'file'} />
          ) : (
            <img alt="" className="size-6 rounded-control object-cover" src={img.data} />
          )}
          <span className="max-w-32 truncate text-ui-2xs text-fg-muted">{img.name || 'image'}</span>
          <Tip label={b.group.removeAttachment}>
            <Button aria-label={b.group.removeAttachment} onClick={() => onRemove(index)} size="icon-xs" variant="ghost">
              <Codicon name="close" />
            </Button>
          </Tip>
        </div>
      ))}
    </div>
  )
}

export function GroupRoomComposer(props: GroupRoomComposerProps) {
  const b = useBots()
  const empty = !props.value.trim() && !props.images.length

  return (
    <form
      className="grid gap-0"
      onSubmit={event => {
        event.preventDefault()
        props.onSubmit()
      }}
    >
      <AttachmentChips images={props.images} onRemove={props.onRemoveImage} />
      <div className="flex items-center gap-1.5">
        <GroupMentionInput
          aria-label={props.ariaLabel}
          members={props.members}
          onChange={props.onChange}
          onEscape={props.onEscape}
          onPaste={props.onPaste}
          onSubmitDraft={props.onSubmit}
          placeholder={props.placeholder}
          value={props.value}
        />
        <Tip label={b.group.attachHint}>
          <Button
            aria-label={b.group.attachHint}
            className="shrink-0 text-fg-muted hover:text-fg"
            onClick={props.onPick}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Codicon name="attach" />
          </Button>
        </Tip>
        <Tip label={props.sendLabel}>
          <Button aria-label={props.sendLabel} className={SEND_BTN} disabled={empty} type="submit">
            <Codicon name="arrow-up" size="0.875rem" />
          </Button>
        </Tip>
      </div>
    </form>
  )
}
