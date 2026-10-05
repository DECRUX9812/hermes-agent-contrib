import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { PetSprite } from '@/components/pet/pet-sprite'
import { cn } from '@/lib/utils'
import { resolveProfileColor } from '@/lib/profile-color'
import { $petEmotion, emotionToPetState } from '@/store/pet-emotion'
import { $petActive, $petInfo } from '@/store/pet'
import { $colonyBots, type ColonyBot } from '@/store/bot-character'
import { $profileColors, switchProfile } from '@/store/profile'

import { BotCard } from './bot-card'

// Colony roster — the "who's here" strip. One row of bot avatars under the
// presence header: the active bot's live pet sprite, every other bot a
// profile-colored initial with a status dot. Click switches. Hover (or
// long-press) opens the character card. Compact by design: this is a roster,
// not a dashboard.

function statusDotClass(bot: ColonyBot, isActive: boolean): string {
  if (!isActive) return 'bg-(--ui-text-quaternary)'
  // Active bot's dot mirrors the live emotion.
  return 'bg-emerald-400'
}

function BotAvatar({ bot }: { bot: ColonyBot }) {
  const petActive = useStore($petActive)
  const petInfo = useStore($petInfo)
  const emotion = useStore($petEmotion)
  const colors = useStore($profileColors)
  const char = bot.character

  if (bot.active && petActive && char.avatar === 'pet') {
    // The active bot shows its own living pet — expression follows emotion.
    return (
      <span className="grid size-8 place-items-center overflow-hidden rounded-full bg-(--ui-control-hover-background)">
        <PetSprite info={petInfo} stateOverride={emotionToPetState(emotion)} zoom={0.34} pauseWhenUnfocused />
      </span>
    )
  }

  const color = resolveProfileColor(bot.profileKey, colors ?? {}) ?? '#8b5cf6'
  const initial = (char.name || bot.label || '?').trim().charAt(0).toUpperCase()
  return (
    <span
      aria-hidden="true"
      className="grid size-8 place-items-center rounded-full text-[0.75rem] font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {initial}
    </span>
  )
}

export function ColonyRoster() {
  const bots = useStore($colonyBots)
  const [cardFor, setCardFor] = useState<string | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  if (bots.length <= 1) return null // Solo bot — no roster needed.

  const onSelect = async (bot: ColonyBot) => {
    if (bot.active || switching) return
    setSwitching(bot.profileKey)
    try {
      await switchProfile(bot.profileKey)
    } finally {
      setSwitching(null)
    }
  }

  return (
    <div className="flex items-center gap-1.5 px-1 pb-2" data-tour="colony-roster">
      <span className="sr-only">Bots in this colony</span>
      {bots.slice(0, 6).map(bot => (
        <div key={bot.profileKey} className="relative">
          <button
            aria-label={`Switch to ${bot.character.name}`}
            aria-pressed={bot.active}
            className={cn(
              'relative grid size-9 place-items-center rounded-full outline-none transition-transform duration-150',
              'hover:scale-110 focus-visible:ring-2 focus-visible:ring-(--ui-accent)/50',
              bot.active && 'ring-2 ring-violet-400/70 ring-offset-2 ring-offset-(--ui-sidebar-surface-background)',
              switching === bot.profileKey && 'animate-pulse'
            )}
            onClick={() => onSelect(bot)}
            onMouseEnter={() => setCardFor(bot.profileKey)}
            onMouseLeave={() => setCardFor(null)}
            onFocus={() => setCardFor(bot.profileKey)}
            onBlur={() => setCardFor(null)}
            title={bot.character.name}
            type="button"
          >
            <BotAvatar bot={bot} />
            <span
              aria-hidden="true"
              className={cn(
                'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-(--ui-sidebar-surface-background)',
                statusDotClass(bot, bot.active)
              )}
            />
          </button>
          {cardFor === bot.profileKey && (
            <div className="absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2">
              <BotCard bot={bot} />
            </div>
          )}
        </div>
      ))}
      {bots.length > 6 && (
        <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">+{bots.length - 6}</span>
      )}
    </div>
  )
}
