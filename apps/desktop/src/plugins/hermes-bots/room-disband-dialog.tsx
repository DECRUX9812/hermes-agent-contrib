/**
 * The disband confirmation, shared by both room surfaces.
 *
 * The gateway room (`canonical-group-header.tsx`) and the Desktop-local room
 * (`group-chat-view.tsx`) both end a room through this dialog and both spell
 * the copy the same way: a prefix, the room name in bold, then a suffix that
 * carries the member count. Keeping one renderer means the bold-name
 * interpolation and the destructive treatment cannot drift apart.
 *
 * Callers own the labels because the two rooms resolve them from different
 * bundles; the shape of the sentence is what is shared.
 */

import { ConfirmDialog } from '@hermes/plugin-sdk'

interface RoomDisbandDialogProps {
  busyLabel: string
  confirmLabel: string
  /** Sentence before the room name; often empty when the name leads. */
  descPrefix: string
  descSuffix: (memberCount: number) => string
  doneLabel: string
  memberCount: number
  name: string
  onClose: () => void
  /** Rejects to keep the dialog open with the error. */
  onConfirm: () => Promise<void>
  open: boolean
  title: string
}

export function RoomDisbandDialog({
  busyLabel,
  confirmLabel,
  descPrefix,
  descSuffix,
  doneLabel,
  memberCount,
  name,
  onClose,
  onConfirm,
  open,
  title
}: RoomDisbandDialogProps) {
  return (
    <ConfirmDialog
      busyLabel={busyLabel}
      confirmLabel={confirmLabel}
      description={
        <span>
          {descPrefix}
          <span className="font-medium text-foreground">{name}</span>
          {descSuffix(memberCount)}
        </span>
      }
      destructive
      doneLabel={doneLabel}
      onClose={onClose}
      onConfirm={onConfirm}
      open={open}
      title={title}
    />
  )
}
