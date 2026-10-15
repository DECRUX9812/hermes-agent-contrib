import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { iconSize } from '@/lib/icons'
import type { QueuedPromptEntry } from '@/store/composer-queue'

import { queuedEntryPreview } from './queue-panel'

/** Two queued turns still read as a list; a third turns the bar into a count. */
export const QUEUED_PILL_FOLD_ABOVE = 2

interface QueuedPillsProps {
  entries: QueuedPromptEntry[]
  onDelete: (id: string) => void
  onEdit: (entry: QueuedPromptEntry) => void
}

/**
 * The composer's own trace of what Enter did while a turn was running. The
 * queue itself lives in the status drawer (collapsed by default), so without
 * this bar a message sent mid-turn looks like it vanished.
 */
export function QueuedPills({ entries, onDelete, onEdit }: QueuedPillsProps) {
  const { t } = useI18n()
  const c = t.composer
  const [expanded, setExpanded] = useState(false)

  if (entries.length === 0) {
    return null
  }

  const folded = entries.length > QUEUED_PILL_FOLD_ABOVE && !expanded

  return (
    <div className="flex min-w-0 flex-col gap-1 text-ui-2xs" data-slot="composer-queued-pills">
      {folded ? (
        <div
          className="flex min-w-0 items-center gap-1.5 self-start rounded-pill bg-surface-raised px-2 py-1 text-fg-secondary"
          data-slot="queued-pill-fold"
        >
          <Codicon className="text-fg-muted" name="layers" size="0.75rem" />
          <span className="font-mono tabular-nums">{entries.length}</span>
          <span className="truncate">{c.queuedPillFolded}</span>
          <span aria-hidden className="text-fg-subtle">
            ·
          </span>
          <button
            className="focus-ring rounded-control px-1 text-fg-secondary hover:text-fg"
            onClick={() => setExpanded(true)}
            type="button"
          >
            {c.queueEdit}
          </button>
        </div>
      ) : (
        entries.map(entry => {
          const preview = queuedEntryPreview(entry, c)

          return (
            <div
              className="flex min-w-0 items-center gap-1.5 self-start rounded-pill bg-surface-raised px-2 py-1"
              data-slot="queued-pill"
              key={entry.id}
            >
              <Tip label={preview}>
                <button
                  className="focus-ring min-w-0 max-w-full truncate rounded-control text-left text-fg-secondary hover:text-fg"
                  onClick={() => onEdit(entry)}
                  type="button"
                >
                  {preview}
                </button>
              </Tip>
              <Tip label={c.queueDelete}>
                <Button
                  aria-label={c.queueDelete}
                  className="size-4 rounded-control"
                  onClick={() => onDelete(entry.id)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Codicon name="close" size={iconSize.xs} />
                </Button>
              </Tip>
            </div>
          )
        })
      )}
      {expanded && entries.length > QUEUED_PILL_FOLD_ABOVE && (
        <button
          className="focus-ring self-start rounded-control px-1 text-fg-muted hover:text-fg-secondary"
          onClick={() => setExpanded(false)}
          type="button"
        >
          {c.queueCollapse}
        </button>
      )}
    </div>
  )
}
