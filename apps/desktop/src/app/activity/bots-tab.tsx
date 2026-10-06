import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { PetSprite } from '@/components/pet/pet-sprite'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'
import { resolveProfileColor } from '@/lib/profile-color'
import {
  $rapportByBot,
  getRapport,
  rapportTier,
  rapportTierLabel
} from '@/store/bot-rapport'
import {
  $colonyBots,
  applyRolePreset,
  BOT_ROLE_PRESETS,
  type BotRole,
  type ColonyBot
} from '@/store/bot-character'
import { $petActive, $petInfo } from '@/store/pet'
import { $petEmotion, emotionToPetState } from '@/store/pet-emotion'
import { $profileColors, switchProfile } from '@/store/profile'

// Bots tab — the colony, up close. Bot picker with role presets, character
// cards, and the working-rapport meter (work trust, never romance). Every
// bot runs the same brain; identity is presentation only.

function RapportRing({ score }: { score: number }) {
  const tier = rapportTier(score)
  const radius = 14
  const circumference = 2 * Math.PI * radius
  const filled = (score / 100) * circumference
  const color =
    tier === 'seasoned' ? 'stroke-emerald-400' : tier === 'trusted' ? 'stroke-violet-400' : 'stroke-(--ui-text-quaternary)'

  return (
    <span className="relative grid size-9 shrink-0 place-items-center" title={`${rapportTierLabel(tier)}: ${score}/100 work trust`}>
      <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
        <circle cx="18" cy="18" r={radius} fill="none" className="stroke-(--ui-control-hover-background)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          className={cn(color, 'transition-all duration-500')}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <span className="absolute text-[0.5625rem] font-bold text-(--ui-text-secondary)">{score}</span>
    </span>
  )
}

function BotAvatar({ bot }: { bot: ColonyBot }) {
  const petActive = useStore($petActive)
  const petInfo = useStore($petInfo)
  const emotion = useStore($petEmotion)
  const colors = useStore($profileColors)

  if (bot.active && petActive && bot.character.avatar === 'pet') {
    return (
      <span className="grid size-11 place-items-center overflow-hidden rounded-full bg-(--ui-control-hover-background)">
        <PetSprite info={petInfo} stateOverride={emotionToPetState(emotion)} zoom={0.44} pauseWhenUnfocused />
      </span>
    )
  }

  const color = resolveProfileColor(bot.profileKey, colors ?? {}) ?? '#8b5cf6'
  const initial = (bot.character.name || bot.label || '?').trim().charAt(0).toUpperCase()
  return (
    <span
      aria-hidden="true"
      className="grid size-11 place-items-center rounded-full text-[1rem] font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {initial}
    </span>
  )
}

function BotRow({ bot }: { bot: ColonyBot }) {
  const [expanded, setExpanded] = useState(false)
  const [switching, setSwitching] = useState(false)
  useStore($rapportByBot) // re-render on rapport changes
  const rapport = getRapport(bot.profileKey)
  const char = bot.character

  const onSwitch = async () => {
    if (bot.active || switching) return
    setSwitching(true)
    try {
      await switchProfile(bot.profileKey)
    } finally {
      setSwitching(false)
    }
  }

  const onPreset = (role: BotRole) => applyRolePreset(bot.profileKey, role)

  return (
    <div
      className={cn(
        'rounded-xl border border-(--ui-edge-border)',
        'bg-(--ui-control-background)'
      )}
    >
      <div className="flex items-center gap-3 p-3">
        <BotAvatar bot={bot} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.875rem] font-semibold text-foreground">{char.name}</span>
            {bot.active && (
              <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wide text-violet-300">
                Active
              </span>
            )}
          </div>
          <div className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">
            {BOT_ROLE_PRESETS.find(p => p.role === char.role)?.label ?? 'Custom'} · {rapportTierLabel(rapportTier(rapport.score))} rapport
          </div>
        </div>
        <RapportRing score={rapport.score} />
      </div>

      <div className="flex items-center gap-2 border-t border-(--ui-edge-border) px-3 py-2">
        {!bot.active && (
          <button
            className={cn(
              'rounded-lg bg-violet-500/15 px-3 py-1 text-[0.75rem] font-semibold text-violet-200',
              'hover:bg-violet-500/25 disabled:opacity-50'
            )}
            disabled={switching}
            onClick={onSwitch}
            type="button"
          >
            {switching ? 'Switching...' : 'Switch to'}
          </button>
        )}
        <button
          aria-expanded={expanded}
          className="rounded-lg px-2 py-1 text-[0.75rem] font-medium text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background)"
          onClick={() => setExpanded(v => !v)}
          type="button"
        >
          {expanded ? 'Hide details' : 'Character card'}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-(--ui-edge-border) p-3">
          <p className="text-[0.75rem] leading-relaxed text-(--ui-text-secondary)">{char.tone}</p>
          {char.strengths.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {char.strengths.map(s => (
                <span
                  key={s}
                  className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[0.625rem] font-semibold text-violet-200"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
          <div>
            <p className="pb-1.5 text-[0.6875rem] font-semibold text-(--ui-text-tertiary)">Role preset</p>
            <div className="grid grid-cols-2 gap-1.5">
              {BOT_ROLE_PRESETS.map(preset => (
                <button
                  key={preset.role}
                  aria-pressed={char.role === preset.role}
                  className={cn(
                    'rounded-lg border p-2 text-left transition-colors',
                    char.role === preset.role
                      ? 'border-violet-400/60 bg-violet-500/10'
                      : 'border-(--ui-edge-border) hover:bg-(--ui-control-hover-background)'
                  )}
                  onClick={() => onPreset(preset.role)}
                  type="button"
                >
                  <div className="text-[0.75rem] font-semibold text-foreground">{preset.label}</div>
                  <div className="text-[0.625rem] leading-snug text-(--ui-text-tertiary)">{preset.tagline}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg bg-(--ui-control-hover-background) p-2">
            <p className="text-[0.625rem] leading-relaxed text-(--ui-text-tertiary)">
              Rapport {rapport.score}/100 from {rapport.tasksCompleted} completed tasks,{' '}
              {rapport.suggestionsAccepted} accepted suggestions, {rapport.approvalsGranted} granted
              approvals. Higher rapport means more autonomy and proactive help.
            </p>
          </div>
          <p className="text-[0.625rem] text-(--ui-text-quaternary)">
            Same brain, different character. Identity is presentation only.
          </p>
        </div>
      )}
    </div>
  )
}

export function BotsTab() {
  const bots = useStore($colonyBots)

  if (bots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <Codicon name="robot" className="text-[2rem] text-(--ui-text-quaternary)" />
        <p className="text-[0.875rem] font-medium text-foreground">No bots yet</p>
        <p className="max-w-60 text-[0.75rem] leading-relaxed text-(--ui-text-tertiary)">
          Your colony will appear here once profiles are set up.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2" aria-label="Bot colony">
      <p className="px-1 text-[0.6875rem] font-medium text-(--ui-text-tertiary)">
        {bots.length === 1
          ? '1 bot in your colony'
          : `${bots.length} bots in your colony`}
      </p>
      {bots.map(bot => (
        <BotRow key={bot.profileKey} bot={bot} />
      ))}
    </div>
  )
}
