import {
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { useCanonicalGroupLabels } from './canonical-group-labels'
import { useBots } from './i18n'

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
      aria-label={name}
      className={cn(
        'group flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-md px-2 py-2 text-left transition-colors',
        'hover:bg-(--chrome-action-hover)',
        active && 'bg-(--ui-row-active-background)'
      )}
      onClick={onOpen}
      type="button"
    >
      <span className="relative shrink-0">
        <Codicon className="text-(--ui-text-quaternary)" name="hubot" size="0.9375rem" />
        {needsYou || running ? (
          <span
            aria-hidden="true"
            className={running
              ? 'absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-(--ui-green) ring-2 ring-background'
              : 'absolute -right-0.5 -top-0.5 size-2 rounded-full bg-(--ui-icon-attention) ring-2 ring-background'}
            data-slot={running ? 'row-running-dot' : 'row-needs-you-dot'}
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-(--ui-text-primary)">{name}</span>
      <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">{group.memberCount(memberCount)}</span>
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
        <ConfirmDialog
          busyLabel={labels.disbanding}
          confirmLabel={labels.disband}
          description={
            <span>
              {labels.disbandDescPrefix}
              <span className="font-medium text-foreground">{name}</span>
              {labels.disbandDescSuffix(memberCount)}
            </span>
          }
          destructive
          doneLabel={labels.disbandDone}
          onClose={() => setConfirming(false)}
          onConfirm={onDelete}
          open
          title={labels.disbandTitle}
        />
      )}
    </>
  )
}
