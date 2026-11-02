/**
 * One pending-attachment chip, shared by both room surfaces.
 *
 * Bot Mode draws a room twice: the Desktop-local room
 * (`group-chat-view.tsx`, atom state, data-URL attachments) and the gateway
 * room (`canonical-group-attachments.tsx`, RPC state, uploaded manifests).
 * Each used to draw its own chips, so the same defect had to be fixed twice —
 * two attachments meant two identically named buttons in both files.
 *
 * Accessible naming, keying and ordering live here once. The row wrapper stays
 * with each caller because the two rooms space it differently; only the chip
 * and its button names are shared.
 *
 * `dense` keeps each surface's existing look: the local room paints the image
 * and an icon-only remove, the gateway room prints word buttons because a
 * downloaded file is worth spelling out. The naming contract is identical.
 */

import { Button, Codicon, Tip } from '@hermes/plugin-sdk'

export type RoomAttachmentKind = 'image' | 'pdf' | 'file'

export interface RoomAttachmentChip {
  /** Stable within the row; survives a rename of the file. */
  key: string
  kind: RoomAttachmentKind
  name: string
  /** Data URL. Only the local room can paint it; the gateway stores a manifest. */
  previewSrc?: string
  onDownload?: () => void
  onRemove?: () => void
}

interface RoomAttachmentChipsProps {
  chips: RoomAttachmentChip[]
  disabled?: boolean
  /** Icon-and-thumbnail chip (local room) instead of word buttons (gateway). */
  dense?: boolean
  /** Required when any chip can download; ignored otherwise. */
  downloadLabel?: string
  removeLabel: string
  /** Shown when the file arrived without a name. */
  fallbackName?: string
}

const KIND_ICON: Record<Exclude<RoomAttachmentKind, 'image'>, string> = {
  file: 'file',
  pdf: 'file-pdf'
}

/** `Download: spec.pdf` / `Remove attachment: spec.pdf` — the file name is what
 *  makes two chips distinguishable, so it is never optional when known. */
const namedAction = (label: string, name: string) => (name ? `${label}: ${name}` : label)

export function RoomAttachmentChips({
  chips,
  dense = false,
  disabled = false,
  downloadLabel,
  removeLabel,
  fallbackName = ''
}: RoomAttachmentChipsProps) {
  return (
    <>
      {chips.map(chip => {
        const name = chip.name || fallbackName
        const size = dense ? 'icon-xs' : 'micro'
        const variant = dense ? 'ghost' : 'text'

        const remove = chip.onRemove ? (
          <Button
            aria-label={namedAction(removeLabel, chip.name)}
            disabled={disabled}
            onClick={chip.onRemove}
            size={size}
            type="button"
            variant={variant}
          >
            {dense ? <Codicon name="close" /> : removeLabel}
          </Button>
        ) : null

        const download = chip.onDownload && downloadLabel ? (
          <Button
            aria-label={namedAction(downloadLabel, chip.name)}
            disabled={disabled}
            onClick={chip.onDownload}
            size={size}
            type="button"
            variant={variant}
          >
            {dense ? <Codicon name="cloud-download" /> : downloadLabel}
          </Button>
        ) : null

        return (
          <div
            className={
              dense
                ? 'flex items-center gap-1 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-1 py-0.5'
                : 'flex items-center gap-1 rounded bg-(--ui-bg-quaternary) px-1.5 py-0.5 text-xs'
            }
            key={chip.key}
          >
            {chip.kind === 'image' && chip.previewSrc ? (
              <img alt="" className="size-6 rounded object-cover" src={chip.previewSrc} />
            ) : chip.kind === 'image' ? null : (
              <Codicon className="text-[0.875rem] text-(--ui-text-secondary)" name={KIND_ICON[chip.kind]} />
            )}
            <span className={dense ? 'max-w-32 truncate text-[0.625rem] text-(--ui-text-secondary)' : 'max-w-40 truncate'}>{name}</span>
            {download}
            {dense && remove ? <Tip label={removeLabel}>{remove}</Tip> : remove}
          </div>
        )
      })}
    </>
  )
}
