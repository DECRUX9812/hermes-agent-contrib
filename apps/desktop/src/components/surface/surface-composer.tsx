/**
 * SurfaceComposer — the composer frame every surface uses.
 *
 * Same story as SurfaceHeader: Bot Mode drew a room twice and each copy built its
 * own form — one with `items-center gap-2 border-t pt-3`, one with `grid gap-0`
 * and its own paste handler. The frame is not where rooms differ; the room differs
 * in what goes inside it. So the frame lives here and the surface supplies only
 * the slots: an attachments row, the field row (attach + input + status + send).
 *
 * What the frame owns, and what a caller can therefore stop re-deciding:
 *   - submit is intercepted once (`preventDefault`), never per caller
 *   - paste and drop are only hijacked when files are present, so text still
 *     lands in the field (a caller that wants its own handling passes `onPaste`)
 *   - the border/padding/row layout, from tokens only
 *
 * It deliberately does NOT own send-enablement, upload state or drafts: those are
 * per-surface behaviour, and a frame that guessed them would be the coupling this
 * file exists to remove.
 */

import { type ClipboardEvent, type DragEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface SurfaceComposerProps {
  /** The pending-attachment row, above the field. */
  attachments?: ReactNode
  /** Attach control + mention/plain input + status pill + submit button. */
  children: ReactNode
  /** Extra frame classes; the default is the room composer's chrome. */
  className?: string
  /** `inline`: the attachments row shares the field row (the room composer's
   *  paperclip sits beside the input). Default `stacked`: chips above it. Both
   *  are real shapes in this app, so the frame expresses both rather than
   *  forcing one surface to change how it looks. */
  inline?: boolean
  /** The field row's own classes; surfaces space controls differently (6px vs
   *  8px is a real difference at this density) and that is theirs to decide. */
  rowClassName?: string
  onDrop?: (event: DragEvent) => void
  onSubmit: () => void
  onPaste?: (event: ClipboardEvent) => void
}

const carriesFiles = (event: DragEvent | ClipboardEvent) => {
  const data = 'dataTransfer' in event ? event.dataTransfer : event.clipboardData

  return Boolean(data && ('files' in data ? data.files.length > 0 : false))
}

export function SurfaceComposer({ attachments, children, className, inline = false, onDrop, onSubmit, onPaste, rowClassName }: SurfaceComposerProps) {
  const row = rowClassName ?? 'flex items-center gap-2'

  return (
    <form
      className={cn('flex shrink-0 flex-col gap-1', className ?? 'border-t border-(--ui-stroke-tertiary) pt-3 pb-1')}
      onDragOver={event => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
        }
      }}
      onDrop={event => {
        if (!onDrop || !carriesFiles(event)) {
          return
        }

        event.preventDefault()
        onDrop(event)
      }}
      onPaste={event => {
        if (!onPaste || !carriesFiles(event)) {
          return
        }

        event.preventDefault()
        onPaste(event)
      }}
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
    >
      {inline ? (
        <div className={row}>
          {attachments}
          {children}
        </div>
      ) : (
        <>
          {attachments}
          <div className={row}>{children}</div>
        </>
      )}
    </form>
  )
}
