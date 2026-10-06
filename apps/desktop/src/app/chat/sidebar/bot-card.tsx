import { useState } from 'react'

import { cn } from '@/lib/utils'
import {
  applyRolePreset,
  BOT_ROLE_PRESETS,
  type ColonyBot,
  setBotCharacter,
} from '@/store/bot-character'

// Bot character card — name, visual identity, tone, strengths, quirks.
// Shown on hover/long-press over a roster avatar. Editable: name, role preset,
// tone, and quirks. Professional framing: work strengths, never personas.

export function BotCard({ bot }: { bot: ColonyBot }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bot.character.name)
  const [tone, setTone] = useState(bot.character.tone)
  const [quirks, setQuirks] = useState(bot.character.quirks.join(', '))
  const char = bot.character

  const save = () => {
    setBotCharacter(bot.profileKey, {
      name: name.trim() || char.name,
      tone: tone.trim() || char.tone,
      quirks: quirks.split(',').map(q => q.trim()).filter(Boolean),
    })
    setEditing(false)
  }

  const presetLabel = BOT_ROLE_PRESETS.find(p => p.role === char.role)?.label ?? 'Custom'

  return (
    <div
      aria-label={`${char.name} character card`}
      className="w-60 rounded-xl border border-(--ui-edge-border) bg-(--ui-popover-background) p-3 shadow-xl"
      role="dialog"
    >
      {editing ? (
        <div className="flex flex-col gap-2" onClick={e => e.stopPropagation()}>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-(--ui-text-secondary)">
            Name
            <input
              className="rounded-md border border-(--ui-edge-border) bg-(--ui-control-background) px-2 py-1 text-[0.75rem] text-foreground outline-none focus:border-violet-400"
              onChange={e => setName(e.target.value)}
              value={name}
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-(--ui-text-secondary)">
            Role
            <select
              className="rounded-md border border-(--ui-edge-border) bg-(--ui-control-background) px-2 py-1 text-[0.75rem] text-foreground outline-none focus:border-violet-400"
              onChange={e => applyRolePreset(bot.profileKey, e.target.value as typeof char.role)}
              value={char.role}
            >
              {BOT_ROLE_PRESETS.map(p => (
                <option key={p.role} value={p.role}>{p.label}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-(--ui-text-secondary)">
            Tone
            <input
              className="rounded-md border border-(--ui-edge-border) bg-(--ui-control-background) px-2 py-1 text-[0.75rem] text-foreground outline-none focus:border-violet-400"
              onChange={e => setTone(e.target.value)}
              value={tone}
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-(--ui-text-secondary)">
            Quirks (comma-separated)
            <input
              className="rounded-md border border-(--ui-edge-border) bg-(--ui-control-background) px-2 py-1 text-[0.75rem] text-foreground outline-none focus:border-violet-400"
              onChange={e => setQuirks(e.target.value)}
              value={quirks}
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button
              className="rounded-md bg-violet-500 px-2.5 py-1 text-[0.75rem] font-semibold text-white hover:bg-violet-400"
              onClick={save}
              type="button"
            >
              Save
            </button>
            <button
              className="rounded-md px-2.5 py-1 text-[0.75rem] font-medium text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background)"
              onClick={() => setEditing(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[0.8125rem] font-bold text-foreground">{char.name}</div>
              <div className="text-[0.6875rem] font-medium text-violet-300">{presetLabel}</div>
            </div>
            <button
              aria-label={`Edit ${char.name}`}
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium text-(--ui-text-tertiary)',
                'hover:bg-(--ui-control-hover-background) hover:text-foreground'
              )}
              onClick={() => {
                setName(char.name)
                setTone(char.tone)
                setQuirks(char.quirks.join(', '))
                setEditing(true)
              }}
              type="button"
            >
              Edit
            </button>
          </div>
          <p className="text-[0.6875rem] leading-snug text-(--ui-text-secondary)">{char.tone}</p>
          {char.strengths.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {char.strengths.map(s => (
                <span
                  className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[0.625rem] font-semibold text-violet-200"
                  key={s}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
          {char.quirks.length > 0 && (
            <p className="text-[0.625rem] italic text-(--ui-text-tertiary)">
              Quirks: {char.quirks.join(' · ')}
            </p>
          )}
          <p className="border-t border-(--ui-edge-border) pt-1.5 text-[0.625rem] text-(--ui-text-quaternary)">
            Same brain, different character — identity is presentation only.
          </p>
        </div>
      )}
    </div>
  )
}
