import {
  cn,
  Codicon,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { useCanonicalGroupLabels } from './canonical-group-labels'
import { useBots } from './i18n'
import { RoomDisbandDialog } from './room-disband-dialog'

interface CanonicalGroupRowProps {
  active?: boolean
  memberCount: number
  name: string
  /** Pending clarify/approval cards for this room — amber dot. */
  needsYou?: boolean
  /** A round is currently running in this room — pulsing emerald dot. */
  running?: boolean
  /** Rejects with the gateway's refusal so the confirm stays open and shows it. */
  onDelete: () => Promise<void>
  onOpen: () => void
}

/** One gateway Group Chat in the roster list. Same row shape as the
 *  Desktop-local GroupRow — icon, name, member count — with the same
 *  right-click Open / Delete (#143571). A bare text button read as a dead
 *  label, which is why remote rooms looked unopenable. */
export function CanonicalGroupRow({ active = false, memberCount, name, needsYou = false, onDelete, onOpen, running = false }: CanonicalGroupRowProps) {
  const labels = useCanonicalGroupLabels()
  const { group } = useBots()
  const [confirming, setConfirming] = useState(false)

  const row = (
    <button
      className={cn(
        'group relative flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-md px-2 py-2 text-left transition-colors',
        'hover:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--dt-ring)',
        active && 'bg-(--ui-row-active-background) before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-(--dt-ring)'
      )}
      onClick={onOpen}
      type="button"
    >
      <span className="relative shrink-0">
        <Codicon className="text-(--ui-text-secondary)" name="hubot" size="0.9375rem" />
        {needsYou || running ? (
          <span
            aria-hidden="true"
            className={running
              ? 'absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-(--ui-green) ring-2 ring-background motion-reduce:animate-none'
              : 'absolute -right-0.5 -top-0.5 size-2 rounded-full bg-(--ui-icon-attention) ring-2 ring-background'}
            data-slot={running ? 'row-running-dot' : 'row-needs-you-dot'}
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-(--ui-text-primary)">{name}</span>
      {/* State dots are decoration; the words are what a screen reader needs.
          No `aria-label` on the row: it would replace the name + member count
          the row already shows. */}
      {running ? <span className="sr-only">{labels.memberWorking}</span> : null}
      {needsYou ? <span className="sr-only">{group.needsYourInput}</span> : null}
      <span className="shrink-0 rounded-full bg-(--ui-surface-overlay) px-1.5 py-0.5 text-[0.625rem] tabular-nums font-medium text-(--ui-text-secondary) group-hover:bg-(--chrome-action-hover)">{group.memberCount(memberCount)}</span>
    </button>
  )

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onOpen}>{labels.openGroup}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setConfirming(true)} variant="destructive">
            {group.deleteAction}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {confirming && (
        <RoomDisbandDialog
          busyLabel={labels.disbanding}
          confirmLabel={labels.disband}
          descPrefix={labels.disbandDescPrefix}
          descSuffix={labels.disbandDescSuffix}
          doneLabel={labels.disbandDone}
          memberCount={memberCount}
          name={name}
          onClose={() => setConfirming(false)}
          onConfirm={onDelete}
          open
          title={labels.disbandTitle}
        />
      )}
    </>
  )
}
