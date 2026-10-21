import { atom, computed } from 'nanostores'

import { storedString } from '@/lib/storage'
import { $activeGatewayProfile, $profiles, normalizeProfileKey, profileLabel } from '@/store/profile'

// Character profile cards — the colony's "who's who". Personality is
// presentation only: every bot runs the same brain; the card is the character
// (name, tone, avatar, strengths, quirks). Stored per profile, editable in the
// bot card UI. Professional framing only — work strengths, not personas.

export type BotRole = 'planner' | 'coder' | 'researcher' | 'assistant' | 'custom'

export interface BotRolePreset {
  role: BotRole
  label: string
  tagline: string
  tone: string
  strengths: string[]
}

export const BOT_ROLE_PRESETS: readonly BotRolePreset[] = [
  {
    role: 'planner',
    label: 'The Planner',
    tagline: 'Breaks big goals into shippable steps.',
    tone: 'Structured, calm, asks one clarifying question at a time.',
    strengths: ['Roadmaps', 'Task breakdown', 'Prioritization'],
  },
  {
    role: 'coder',
    label: 'The Coder',
    tagline: 'Writes, tests, and ships code.',
    tone: 'Direct, shows the diff, explains the why in one line.',
    strengths: ['Implementation', 'Debugging', 'Code review'],
  },
  {
    role: 'researcher',
    label: 'The Researcher',
    tagline: 'Finds answers and cites sources.',
    tone: 'Thorough, cites sources, flags uncertainty honestly.',
    strengths: ['Web research', 'Summaries', 'Fact-checking'],
  },
  {
    role: 'assistant',
    label: 'The Assistant',
    tagline: 'Day-to-day help, fast and friendly.',
    tone: 'Warm, concise, gets to the point.',
    strengths: ['Q&A', 'Drafting', 'Scheduling'],
  },
]

export interface BotCharacter {
  /** Display name — defaults to the profile label. */
  name: string
  role: BotRole
  /** One-line tone card, e.g. "Direct, shows the diff." */
  tone: string
  strengths: string[]
  quirks: string[]
  /** 'pet' uses the profile's pet sprite; 'initial' uses a colored initial. */
  avatar: 'pet' | 'initial'
}

const CHAR_KEY = (profileKey: string) => `hermes.desktop.bot-character.${profileKey}.v1`

function defaultCharacter(profileKey: string): BotCharacter {
  return {
    name: profileKey === 'default' ? 'Hermes' : profileKey,
    role: 'assistant',
    tone: 'Warm, concise, gets to the point.',
    strengths: [],
    quirks: [],
    avatar: 'pet',
  }
}

function loadCharacter(profileKey: string): BotCharacter {
  const raw = storedString(CHAR_KEY(profileKey))

  if (!raw) {return defaultCharacter(profileKey)}

  try {
    const parsed = JSON.parse(raw) as Partial<BotCharacter>

    return { ...defaultCharacter(profileKey), ...parsed }
  } catch {
    return defaultCharacter(profileKey)
  }
}

function saveCharacter(profileKey: string, char: BotCharacter): void {
  try {
    localStorage.setItem(CHAR_KEY(profileKey), JSON.stringify(char))
  } catch {
    // Storage full/blocked — character stays in memory for the session.
  }
}

// The roster of known profiles, each with its character card.
export interface ColonyBot {
  profileKey: string
  label: string
  character: BotCharacter
  active: boolean
}

const $characterVersion = atom(0)

function bumpCharacters(): void {
  $characterVersion.set($characterVersion.get() + 1)
}

export function getBotCharacter(profileKey: string): BotCharacter {
  void $characterVersion.get()

  return loadCharacter(normalizeProfileKey(profileKey))
}

export function setBotCharacter(profileKey: string, patch: Partial<BotCharacter>): void {
  const key = normalizeProfileKey(profileKey)
  saveCharacter(key, { ...loadCharacter(key), ...patch })
  bumpCharacters()
}

export function applyRolePreset(profileKey: string, role: BotRole): void {
  const preset = BOT_ROLE_PRESETS.find(p => p.role === role)

  if (!preset) {return}
  setBotCharacter(profileKey, {
    role,
    tone: preset.tone,
    strengths: preset.strengths,
  })
}

export const $colonyBots = computed(
  [$profiles, $activeGatewayProfile, $characterVersion],
  (profiles, activeProfile): ColonyBot[] => {
    void $characterVersion.get()
    const activeKey = normalizeProfileKey(activeProfile)

    const list = (profiles ?? []).map(p => {
      const key = normalizeProfileKey(p.name)
      const char = loadCharacter(key)
      // Prefer the profile's display label for the card name unless the user
      // renamed the bot explicitly (stored name differs from default).
      const defaultName = key === 'default' ? 'Hermes' : key

      return {
        profileKey: key,
        label: profileLabel(p),
        character: char.name === defaultName ? { ...char, name: profileLabel(p) } : char,
        active: key === activeKey,
      }
    })

    // Active bot first, then alphabetical.
    return list.sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label))
  }
)
