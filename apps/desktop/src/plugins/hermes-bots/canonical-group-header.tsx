import { Button, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { CanonicalGroupRoster, type CanonicalMemberPhase } from './canonical-group-activity'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import type { CanonicalRoom } from './canonical-groups'
import { RoomDisbandDialog } from './room-disband-dialog'

interface CanonicalGroupHeaderProps {
  busy: boolean
  canStop: boolean
  onBack?: () => void
  onDisband: () => Promise<void>
  onRename: (name: string) => void
  onStop: () => void
  phases: Map<string, CanonicalMemberPhase>
  room?: CanonicalRoom
}

export function CanonicalGroupHeader({ busy, canStop, onBack, onDisband, onRename, onStop, phases, room }: CanonicalGroupHeaderProps) {
  const labels = useCanonicalGroupLabels()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)

  const rename = (name: string) => {
    setRenaming(null)

    if (name) {onRename(name)}
  }

  return <>
    <header className="flex min-w-0 items-center gap-2">
      {onBack && <Button onClick={onBack} size="sm" variant="ghost">{labels.back}</Button>}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-medium">{room?.name || labels.loadingGroup}</h2>
        <CanonicalGroupRoster label={labels.members} labels={labels} members={room?.members} phases={phases} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button disabled={busy || !canStop} onClick={onStop} size="sm" variant="secondary">{labels.stop}</Button>
        {/* Rename and Disband live behind the overflow: a destructive action
            sitting shoulder-to-shoulder with Stop is one slipped click from a
            lost room, and the local-room header already hides them here. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={labels.moreActions} disabled={!room} size="sm" variant="ghost">
              <Codicon name="kebab-horizontal" size="0.875rem" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={busy} onSelect={() => setRenaming(room?.name ?? '')}>
              {labels.rename}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={busy}
              onSelect={() => setEnding(true)}
            >
              {labels.disband}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    {renaming !== null && <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); rename(renaming.trim()) }}>
      <Input aria-label={labels.renameLabel} autoFocus className="min-w-0 flex-1" onChange={event => setRenaming(event.target.value)} value={renaming} />
      <Button disabled={busy || !renaming.trim()} size="sm" type="submit" variant="secondary">{labels.save}</Button>
      <Button onClick={() => setRenaming(null)} size="sm" type="button" variant="ghost">{labels.cancel}</Button>
    </form>}
    {ending && <RoomDisbandDialog busyLabel={labels.disbanding} confirmLabel={labels.disband}
      descPrefix={labels.disbandDescPrefix} descSuffix={labels.disbandDescSuffix} doneLabel={labels.disbandDone}
      memberCount={room?.members?.length ?? 0} name={room?.name ?? ''} onClose={() => setEnding(false)}
      onConfirm={onDisband} open title={labels.disbandTitle} />}
  </>
}
