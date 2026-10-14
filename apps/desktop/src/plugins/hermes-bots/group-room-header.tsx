/**
 * The room's header: back, the room's face and goal, its members' faces (lit
 * while working; the pile opens the members panel), then the view switch,
 * focus mode and settings. Lifted out of the room view, which hands it the
 * state it reads; it owns none of its own.
 */

import { Button, cn, Codicon, Tip, useI18n } from '@hermes/plugin-sdk'
import type { Dispatch, SetStateAction } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { $groupChatWorkspace, type GroupChatRoom } from './group-chat'
import { useBots } from './i18n'
import { useRoomText } from './room-i18n'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember } from './types'

export interface GroupRoomHeaderProps {
  allMeta: Record<string, BotMeta>
  availabilityLabel: string
  availableMembers: number
  focusMode: boolean
  group: string
  members: GroupMember[]
  onBack?: () => void
  panelOpen: boolean
  room: GroupChatRoom
  setFocusMode: Dispatch<SetStateAction<boolean>>
  setPanelOpen: Dispatch<SetStateAction<boolean>>
  setSettingsOpen: (open: boolean) => void
  setView: (view: 'board' | 'room') => void
  view: 'board' | 'room'
  workingNow: ReadonlySet<string>
}

export function GroupRoomHeader({
  allMeta,
  availabilityLabel,
  availableMembers,
  focusMode,
  group,
  members,
  onBack,
  panelOpen,
  room,
  setFocusMode,
  setPanelOpen,
  setSettingsOpen,
  setView,
  view,
  workingNow
}: GroupRoomHeaderProps) {
  const { t } = useI18n()
  const b = useBots()
  const r = useRoomText()

  return (
    <div className="flex h-13 shrink-0 items-center gap-2.5 border-b border-line px-3">
      <Tip label={t.common.back}>
        <Button
          aria-label={t.common.back}
          className="shrink-0 text-fg-muted hover:text-fg"
          onClick={() => (onBack ? onBack() : $groupChatWorkspace.set(null))}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="chevron-left" />
        </Button>
      </Tip>
      {/* Room picture (set via Group settings) leads the title when present. */}
      {room.image ? (
        <img
          alt=""
          className="size-7 shrink-0 rounded-control object-cover ring-1 ring-line"
          src={room.image}
        />
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-control bg-hover text-fg-muted">
          <Codicon name="organization" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui-base font-semibold text-fg">{group}</div>
        {room.goal ? (
          <div className="truncate text-ui-xs text-fg-muted" data-testid="group-goal">
            {room.goal}
          </div>
        ) : null}
      </div>
      {/* Overlapping faces read as a ROOM; the pile opens the members panel. */}
      {members.length ? (
        <Tip label={panelOpen ? r.members.hideMembers : r.members.showMembers}>
          <Button
            aria-label={panelOpen ? r.members.hideMembers : r.members.showMembers}
            aria-pressed={panelOpen}
            className="flex shrink-0 items-center -space-x-1.5 rounded-pill p-1 transition-colors duration-(--dur-fast) hover:bg-hover"
            onClick={() => setPanelOpen(open => !open)}
            size="inline"
            variant="text"
          >
            {members.slice(0, 5).map((member, faceIndex) => {
              const faceAppearance = botAppearance(member.name, botRosterMeta(member, allMeta))
              const faceImage = faceAppearance.image
              const working = workingNow.has(member.name)

              return (
                <span
                  className={cn('relative shrink-0 rounded-[22%]', working && 'motion-ring z-10 text-brand')}
                  data-working={working ? '' : undefined}
                  key={`face:${member.connectionId || ''}:${member.name}:${faceIndex}`}
                >
                  <span className="block overflow-hidden rounded-[22%] ring-1 ring-surface">
                    <BotFace
                      color={avatarColor(faceAppearance.color, member.name)}
                      image={faceImage && !isBackfilledFacePng(faceImage) ? faceImage : null}
                      name={member.name}
                      shape={faceAppearance.shape}
                      size={22}
                    />
                  </span>
                </span>
              )
            })}
            {members.length > 5 ? (
              <span className="flex size-5.5 shrink-0 items-center justify-center rounded-pill bg-hover text-ui-2xs font-medium text-fg-subtle ring-1 ring-surface">
                {`+${members.length - 5}`}
              </span>
            ) : null}
          </Button>
        </Tip>
      ) : null}
      {/* The face pile already says how many; the label only speaks up when
          a member can't answer right now. */}
      {members.length > 0 && availableMembers < members.length ? (
        <span aria-label={availabilityLabel} className="shrink-0 text-ui-2xs text-warning">
          {availabilityLabel}
        </span>
      ) : null}
      <div aria-label={b.group.viewBoard} className="flex shrink-0 rounded-control bg-hover p-0.5" role="group">
        {(['room', 'board'] as const).map(mode => (
          <button
            aria-pressed={view === mode}
            className={cn(
              'h-6 cursor-pointer rounded-control px-2.5 text-ui-xs transition-colors duration-(--dur-fast) focus-ring',
              view === mode ? 'bg-surface-raised font-medium text-fg shadow-e1' : 'text-fg-muted hover:text-fg'
            )}
            key={mode}
            onClick={() => setView(mode)}
            type="button"
          >
            {mode === 'room' ? b.group.viewRoom : b.group.viewBoard}
          </button>
        ))}
      </div>
      <Tip label={b.group.focusModeHint}>
        <Button
          aria-label={b.group.focusMode}
          aria-pressed={focusMode}
          className={cn('shrink-0 hover:text-fg', focusMode ? 'text-brand' : 'text-fg-muted')}
          data-testid="group-focus-toggle"
          onClick={() => setFocusMode(on => !on)}
          size="sm"
          variant="ghost"
        >
          <Codicon name="filter" />
        </Button>
      </Tip>
      <Tip label={b.group.settingsHint(group)}>
        <Button
          aria-label={b.group.settingsLabel(group)}
          className="shrink-0 text-fg-muted hover:text-fg"
          onClick={() => setSettingsOpen(true)}
          size="sm"
          variant="ghost"
        >
          <Codicon name="gear" />
        </Button>
      </Tip>
    </div>
  )
}
