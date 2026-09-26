import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ColorSwatches } from '@/components/ui/color-swatches'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { SessionInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { isSubmitEnter } from '@/lib/ime'
import { PROFILE_SWATCHES } from '@/lib/profile-color'
import { confirm } from '@/store/confirm'
import { $pinnedSessionIds, pinSession, unpinSession } from '@/store/layout'
import { notify } from '@/store/notifications'
import { sessionPinId } from '@/store/session'
import { archiveSessions } from '@/store/session-bulk-archive'
import { isSessionMuted, toggleSessionMuted } from '@/store/session-mute'
import { $selectedSessions, clearSessionSelection } from '@/store/session-selection'
import { addSessionTag } from '@/store/session-tags'

const BAR_BUTTON =
  'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[0.6875rem] leading-none text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)'

/**
 * The multi-select action bar — a floating pill pinned to the bottom of the
 * sessions column while one or more rows are ⌘/⇧-click selected. Every action
 * is the single-row verb fanned out over the set (pins/mutes/tags write the
 * durable lineage id; archive goes through the same tile delegate a row's
 * own menu uses), so bulk semantics can't drift from the row's.
 */
export function SessionSelectionBar() {
  const { t } = useI18n()
  const sel = t.sidebar.selection
  const selected = useStore($selectedSessions)
  const pinnedIds = useStore($pinnedSessionIds)
  const [tagOpen, setTagOpen] = useState(false)

  const count = selected.length
  const isPinned = (s: (typeof selected)[number]) => s.pinned === true || pinnedIds.includes(sessionPinId(s))
  const allPinned = count > 0 && selected.every(isPinned)
  const allMuted = count > 0 && selected.every(s => isSessionMuted(s.id))

  if (count === 0) {
    return null
  }

  const togglePinAll = () => {
    for (const s of selected) {
      const durableId = sessionPinId(s)

      if (allPinned) {
        unpinSession(durableId)
      } else if (!isPinned(s)) {
        pinSession(durableId)
      }
    }
  }

  const toggleMuteAll = () => {
    for (const s of selected) {
      // A mixed set: mute-all touches only the unmuted; unmute-all the muted.
      if (isSessionMuted(s.id) === allMuted) {
        toggleSessionMuted(s.id)
      }
    }
  }

  const archiveAll = () => {
    void confirm({
      confirmLabel: t.sidebar.archive.confirmAction,
      description: t.sidebar.archive.confirmBody,
      title: t.sidebar.archive.confirmTitle(count)
    }).then(ok => {
      if (!ok) {
        return
      }

      void archiveSessions(selected.map(s => s.id)).then(archived => {
        clearSessionSelection()

        if (archived > 0) {
          notify({ kind: 'success', message: t.sidebar.archive.done(archived) })
        }
      })
    })
  }

  return (
    <div
      aria-label={sel.ariaLabel}
      className="pointer-events-none sticky bottom-1 z-20 mt-auto flex justify-center"
      role="toolbar"
    >
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-(--ui-stroke-tertiary) bg-(--ui-sidebar-surface-background) py-1 pl-2.5 pr-1.5 shadow-lg">
        <span className="whitespace-nowrap pr-1 text-[0.6875rem] tabular-nums text-(--ui-text-secondary)">
          {sel.count(count)}
        </span>
        <button
          aria-label={allPinned ? sel.unpin : sel.pin}
          className={BAR_BUTTON}
          onClick={() => {
            triggerHaptic('selection')
            togglePinAll()
          }}
          type="button"
        >
          <Codicon name="pin" size="0.6875rem" />
          {allPinned ? sel.unpin : sel.pin}
        </button>
        <button
          aria-label={allMuted ? sel.unmute : sel.mute}
          className={BAR_BUTTON}
          onClick={() => {
            triggerHaptic('selection')
            toggleMuteAll()
          }}
          type="button"
        >
          <Codicon name={allMuted ? 'bell' : 'bell-slash'} size="0.6875rem" />
          {allMuted ? sel.unmute : sel.mute}
        </button>
        <button
          aria-label={sel.tag}
          className={BAR_BUTTON}
          onClick={() => {
            triggerHaptic('selection')
            setTagOpen(true)
          }}
          type="button"
        >
          <Codicon name="tag" size="0.6875rem" />
          {sel.tag}
        </button>
        <button
          aria-label={sel.archive}
          className={BAR_BUTTON}
          onClick={() => {
            triggerHaptic('selection')
            archiveAll()
          }}
          type="button"
        >
          <Codicon name="archive" size="0.6875rem" />
          {sel.archive}
        </button>
        <button
          aria-label={sel.clear}
          className="grid size-5 place-items-center rounded-full text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)"
          onClick={() => {
            triggerHaptic('selection')
            clearSessionSelection()
          }}
          type="button"
        >
          <Codicon name="close" size="0.6875rem" />
        </button>
      </div>
      <SelectionTagsDialog count={count} onOpenChange={setTagOpen} open={tagOpen} selected={selected} />
    </div>
  )
}

interface SelectionTagsDialogProps {
  count: number
  onOpenChange: (open: boolean) => void
  open: boolean
  selected: readonly SessionInfo[]
}

// The row's own tags dialog recolors one session; this one fans the same
// addSessionTag write out over every selected row — the durable lineage id
// under the row's owning profile, so tags ride out compression and stay in
// their profile island exactly like the single-session path.
function SelectionTagsDialog({ count, onOpenChange, open, selected }: SelectionTagsDialogProps) {
  const { t } = useI18n()
  const sel = t.sidebar.selection
  const r = t.sidebar.row
  const [label, setLabel] = useState('')
  const [color, setColor] = useState<null | string>(PROFILE_SWATCHES[0] ?? null)

  useEffect(() => {
    if (open) {
      setLabel('')
      setColor(PROFILE_SWATCHES[0] ?? null)
    }
  }, [open])

  const add = () => {
    const trimmed = label.trim()

    if (!trimmed || !color) {
      return
    }

    for (const s of selected) {
      addSessionTag(s.profile, sessionPinId(s), { color, label: trimmed })
    }

    setLabel('')
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{sel.tagDialogTitle(count)}</DialogTitle>
          <DialogDescription>{sel.tagDialogDesc}</DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <ColorSwatches
              clearLabel={t.sidebar.projects.noColor}
              onChange={setColor}
              swatches={PROFILE_SWATCHES}
              value={color}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            autoFocus
            onChange={event => setLabel(event.target.value)}
            onKeyDown={event => {
              if (isSubmitEnter(event)) {
                event.preventDefault()
                add()
              } else if (event.key === 'Escape') {
                onOpenChange(false)
              }
            }}
            placeholder={r.tagsAddPlaceholder}
            value={label}
          />
          <Button disabled={!label.trim() || !color} onClick={add} type="button">
            {r.tagsAdd}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
