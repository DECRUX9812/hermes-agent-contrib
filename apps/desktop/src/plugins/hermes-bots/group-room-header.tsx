/**
 * The room's header: back, the room's face and goal, its members' faces (lit
 * while working) with a "Working now" chip, then the view and panel switches,
 * focus mode and settings. Lifted out of the room view, which hands it the
 * state it reads; it owns none of its own.
 */

import { Button, cn, Codicon, Tip, useI18n } from '@hermes/plugin-sdk'
import type { Dispatch, SetStateAction } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { $groupChatWorkspace, type GroupChatRoom } from './group-chat'
import { useBots } from './i18n'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember } from './types'

export interface GroupRoomHeaderProps {
  allMeta: Record<string, BotMeta>
  availabilityLabel: string
  availableMembers: number
  focusMode: boolean
  group: string
  memberNames: string
  members: GroupMember[]
  onBack?: () => void
  panelOpen: boolean
  room: GroupChatRoom
  setFocusMode: Dispatch<SetStateAction<boolean>>
  setMemberPickerOpen: (open: boolean) => void
  setPanelOpen: Dispatch<SetStateAction<boolean>>
  setSettingsOpen: (open: boolean) => void
  setView: (view: 'board' | 'room') => void
  view: 'board' | 'room'
  workingLabel: string
  workingNow: ReadonlySet<string>
}

export function GroupRoomHeader({
  allMeta,
  availabilityLabel,
  availableMembers,
  focusMode,
  group,
  memberNames,
  members,
  onBack,
  panelOpen,
  room,
  setFocusMode,
  setMemberPickerOpen,
  setPanelOpen,
  setSettingsOpen,
  setView,
  view,
  workingLabel,
  workingNow
}: GroupRoomHeaderProps) {
  const { t } = useI18n()
  const b = useBots()

  return (
    <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-2">
      <Tip label={t.common.back}>
        <Button
          aria-label={t.common.back}
          className="shrink-0 text-(--ui-text-tertiary) hover:text-foreground"
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
          className="size-6 shrink-0 rounded-md object-cover ring-1 ring-(--ui-stroke-secondary)"
          src={room.image}
        />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-(--chrome-action-hover) text-(--ui-text-tertiary)">
          <Codicon name="organization" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{group}</div>
        {room.goal ? (
          <div className="truncate text-[0.6875rem] text-(--ui-text-tertiary)" data-testid="group-goal">
            {room.goal}
          </div>
        ) : null}
      </div>
      {/* Face pile: the member count alone reads as a number; overlapping
          faces read as a ROOM. Click opens the member manager. */}
      {members.length ? (
        <Tip label={memberNames}>
          <Button
            aria-label="Manage group members"
            className={cn('flex shrink-0 items-center -space-x-1 rounded-full p-0.5', panelOpen && '@5xl:hidden')}
            onClick={() => setMemberPickerOpen(true)}
            size="inline"
            variant="text"
          >
            {members.slice(0, 5).map((member, faceIndex) => {
              const faceAppearance = botAppearance(member.name, botRosterMeta(member, allMeta))
              const faceImage = faceAppearance.image
              const working = workingNow.has(member.name)

              return (
                <span
                  className={cn('relative shrink-0', working && 'z-10')}
                  data-working={working ? '' : undefined}
                  key={`face:${member.connectionId || ''}:${member.name}:${faceIndex}`}
                >
                  {/* The face clips its own overflow, so the working ring can't
                      live on it — an opacity fade on an 18px avatar read as
                      nothing. The halo is a sibling square that scales out and
                      fades (ping), over a steady accent ring underneath. */}
                  <span
                    className={cn(
                      'block overflow-hidden rounded-[22%] bg-(--ui-bg-primary) ring-1 ring-(--ui-bg-primary)',
                      working && 'ring-2 ring-(--ui-accent)'
                    )}
                  >
                    <BotFace
                      color={avatarColor(faceAppearance.color, member.name)}
                      image={faceImage && !isBackfilledFacePng(faceImage) ? faceImage : null}
                      name={member.name}
                      shape={faceAppearance.shape}
                      size={18}
                    />
                  </span>
                  {working ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-[22%] ring-2 ring-(--ui-accent) motion-safe:animate-ping"
                      data-testid="group-working-halo"
                    />
                  ) : null}
                </span>
              )
            })}
            {members.length > 5 ? (
              <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-(--chrome-action-hover) text-[0.55rem] font-medium text-(--ui-text-tertiary) ring-1 ring-(--ui-bg-primary)">
                {`+${members.length - 5}`}
              </span>
            ) : null}
          </Button>
        </Tip>
      ) : null}
      {/* The ring lives on an 18px face in a corner — easy to miss, which is
          exactly what happened. The same fact in words, next to the faces,
          answers "are you guys even working?" without anyone hunting for it. */}
      {workingLabel ? (
        <span
          className="flex min-w-0 max-w-[11rem] shrink items-center gap-1.5 rounded-full border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 py-0.5 text-[0.625rem] text-(--ui-text-secondary)"
          data-testid="group-working-chip"
        >
          <span aria-hidden className="relative flex size-1.5 shrink-0">
            <span className="absolute inset-0 rounded-full bg-(--ui-accent) motion-safe:animate-ping" />
            <span className="relative inline-flex size-1.5 rounded-full bg-(--ui-accent)" />
          </span>
          <span className="truncate">{b.group.workingNow(workingLabel)}</span>
        </span>
      ) : null}
      {/* The face pile already says how many; the label only speaks up when
          a member can't answer right now. */}
      {members.length > 0 && availableMembers < members.length ? (
        <span aria-label={availabilityLabel} className="shrink-0 text-[0.625rem] text-amber-600 dark:text-amber-300">
          {availabilityLabel}
        </span>
      ) : null}
      <div
        aria-label={b.group.viewBoard}
        className="flex shrink-0 rounded-md bg-(--chrome-action-hover)/60 p-0.5"
        role="group"
      >
        {(['room', 'board'] as const).map(mode => (
          <button
            aria-pressed={view === mode}
            className={cn(
              'h-6 cursor-pointer rounded px-2 text-[0.6875rem] transition-colors',
              view === mode
                ? 'bg-(--ui-bg-primary) font-semibold text-foreground shadow-sm'
                : 'text-(--ui-text-tertiary)'
            )}
            key={mode}
            onClick={() => setView(mode)}
            type="button"
          >
            {mode === 'room' ? b.group.viewRoom : b.group.viewBoard}
          </button>
        ))}
      </div>
      <Tip label={b.group.panelToggle}>
        <Button
          aria-label={b.group.panelToggle}
          aria-pressed={panelOpen}
          className={cn(
            'hidden shrink-0 hover:text-foreground @5xl:inline-flex',
            panelOpen ? 'text-foreground' : 'text-(--ui-text-tertiary)'
          )}
          onClick={() => setPanelOpen(open => !open)}
          size="sm"
          variant="ghost"
        >
          <Codicon name="layout-sidebar-right" />
        </Button>
      </Tip>
      <Tip label={b.group.focusModeHint}>
        <Button
          aria-label={b.group.focusMode}
          aria-pressed={focusMode}
          className={cn(
            'shrink-0 hover:text-foreground',
            focusMode ? 'text-(--ui-accent)' : 'text-(--ui-text-tertiary)'
          )}
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
          className="shrink-0 text-(--ui-text-tertiary) hover:text-foreground"
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
