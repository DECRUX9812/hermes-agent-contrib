import { useStore } from '@nanostores/react'

import { PetSprite } from '@/components/pet/pet-sprite'
import { BrandMark } from '@/components/brand-mark'
import { cn } from '@/lib/utils'
import { $activeWork } from '@/store/active-work'
import { $petEmotion, emotionCaption, type PetEmotion } from '@/store/pet-emotion'
import { $petActive, $petInfo } from '@/store/pet'
import { $activeGatewayProfile, $profiles, profileLabel } from '@/store/profile'

// Agent Presence Header — the "who's here and what are they doing" strip.
// Per-bot: shows the ACTIVE colony bot's name (profile label), its living pet
// avatar, and an emotion-driven status line. Status derives from real stores
// only ($petEmotion <- $petActivity + message sentiment; $activeWork).
// Muse-inspired pattern, Hermes design: one glanceable line, never invented.

function statusTone(emotion: PetEmotion): string {
  switch (emotion) {
    case 'concerned':
      return 'text-red-400'
    case 'waiting':
      return 'text-amber-400'
    case 'working':
    case 'thinking':
      return 'text-violet-300'
    case 'happy':
    case 'proud':
      return 'text-emerald-300'
    case 'neutral':
    default:
      return 'text-(--ui-text-tertiary)'
  }
}

export function AgentPresence() {
  const petActive = useStore($petActive)
  const petInfo = useStore($petInfo)
  const emotion = useStore($petEmotion)
  const work = useStore($activeWork)
  const activeProfile = useStore($activeGatewayProfile)
  const profiles = useStore($profiles)

  const profile = (profiles ?? []).find(p => p.name === activeProfile)
  const botName = profile ? profileLabel(profile) : 'Hermes'

  const workingTitle = work.count > 0 ? (work.titles[0] ?? null) : null
  // When actually working, name the task; otherwise the emotion caption.
  const line = workingTitle && (emotion === 'working' || emotion === 'thinking')
    ? `Working on ${workingTitle}`
    : emotionCaption(emotion)

  const isBusy = emotion === 'working' || emotion === 'thinking'

  return (
    <div
      aria-live="polite"
      className="flex items-center gap-2.5 rounded-xl bg-(--ui-control-background) px-2.5 py-2"
      data-tour="agent-presence"
    >
      <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-(--ui-control-hover-background)">
        {petActive ? (
          <PetSprite info={petInfo} zoom={0.42} pauseWhenUnfocused />
        ) : (
          <BrandMark className="size-6 text-violet-300" />
        )}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[0.8125rem] font-semibold text-foreground">{botName}</div>
        <div className={cn('truncate text-[0.6875rem] font-medium transition-colors duration-200', statusTone(emotion))}>
          {line}
        </div>
      </div>
      {isBusy ? (
        <span aria-hidden="true" className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-violet-400" />
        </span>
      ) : null}
    </div>
  )
}
