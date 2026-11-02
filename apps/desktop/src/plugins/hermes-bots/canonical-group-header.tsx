import { Button, Input } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { CanonicalGroupRoster, type CanonicalMemberPhase } from './canonical-group-activity'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import type { CanonicalRoom } from './canonical-groups'
import { RoomDisbandDialog } from './room-disband-dialog'
import { RoomHeader } from './room-header'

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
    {/* Rename and Disband live behind the overflow: a destructive action
        sitting shoulder-to-shoulder with Stop is one slipped click from a
        lost room, and the local-room header does the same. */}
    <RoomHeader
      back={onBack ? { label: labels.back, onClick: onBack } : undefined}
      busy={busy || !room}
      menuItems={[
        [{ disabled: busy, label: labels.rename, onSelect: () => setRenaming(room?.name ?? '') }],
        [{ destructive: true, disabled: busy, label: labels.disband, onSelect: () => setEnding(true) }]
      ]}
      menuLabel={labels.moreActions}
      primary={<Button disabled={busy || !canStop} onClick={onStop} size="sm" variant="secondary">{labels.stop}</Button>}
      subtitle={<CanonicalGroupRoster label={labels.members} labels={labels} members={room?.members} phases={phases} />}
      title={room?.name || labels.loadingGroup} />
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
