import { computed } from 'nanostores'

import { persistentAtom } from '@/lib/persisted'

// Working-rapport meter — a per-bot measure of *work trust*, not affection.
// It answers one question: how well does this bot know the user's workflow?
// Higher rapport unlocks more autonomy: proactive suggestions, bolder
// defaults, warmer tone. It is earned through completed work, never through
// flattery or emotional hooks. Professional framing, always.
//
// Score: 0-100. Starts at 20 (a new colleague). Gains come from real signals:
// completed tasks, accepted suggestions, approvals granted. It decays slowly
// with disuse so a stale bot does not keep privileges it no longer deserves.

export interface BotRapport {
  /** 0-100 work-trust score. */
  score: number
  /** Completed tasks together. */
  tasksCompleted: number
  /** Suggestions the user accepted. */
  suggestionsAccepted: number
  /** Approvals the user granted to this bot. */
  approvalsGranted: number
  /** Last interaction timestamp. */
  lastActiveAt: number
}

const DEFAULT_RAPPORT: BotRapport = {
  score: 20,
  tasksCompleted: 0,
  suggestionsAccepted: 0,
  approvalsGranted: 0,
  lastActiveAt: 0
}

const DECAY_PER_DAY = 1
const DECAY_FLOOR = 10

export const $botRapport = persistentAtom<Record<string, BotRapport>>(
  'hermes:bot-rapport:v1',
  {},
  {
    encode: JSON.stringify,
    decode: (raw: string) => {
      try {
        const parsed = JSON.parse(raw) as Record<string, BotRapport>

        return typeof parsed === 'object' && parsed !== null ? parsed : {}
      } catch {
        return {}
      }
    }
  }
)

export function getRapport(profileKey: string): BotRapport {
  return $botRapport.get()[profileKey] ?? { ...DEFAULT_RAPPORT }
}

/** Autonomy tier derived from score. UI copy stays honest about what changes. */
export type RapportTier = 'new' | 'trusted' | 'seasoned'

export function rapportTier(score: number): RapportTier {
  if (score >= 70) {return 'seasoned'}

  if (score >= 40) {return 'trusted'}

  return 'new'
}

export function rapportTierLabel(tier: RapportTier): string {
  switch (tier) {
    case 'seasoned':
      return 'Seasoned'

    case 'trusted':
      return 'Trusted'

    default:
      return 'New'
  }
}

function bump(profileKey: string, patch: Partial<BotRapport>, scoreDelta: number): void {
  const all = $botRapport.get()
  const prev = all[profileKey] ?? { ...DEFAULT_RAPPORT }
  const score = Math.max(0, Math.min(100, prev.score + scoreDelta))
  $botRapport.set({
    ...all,
    [profileKey]: { ...prev, ...patch, score, lastActiveAt: Date.now() }
  })
}

/** Record a completed task together. Small, steady trust builder. */
export function recordTaskCompleted(profileKey: string): void {
  const prev = getRapport(profileKey)
  bump(profileKey, { tasksCompleted: prev.tasksCompleted + 1 }, 2)
}

/** Record an accepted suggestion. Stronger signal than a completed task. */
export function recordSuggestionAccepted(profileKey: string): void {
  const prev = getRapport(profileKey)
  bump(profileKey, { suggestionsAccepted: prev.suggestionsAccepted + 1 }, 4)
}

/** Record a granted approval. The user trusted the bot with something real. */
export function recordApprovalGranted(profileKey: string): void {
  const prev = getRapport(profileKey)
  bump(profileKey, { approvalsGranted: prev.approvalsGranted + 1 }, 3)
}

/** Apply time decay. Call on session start; cheap and idempotent per day. */
export function applyRapportDecay(): void {
  const all = $botRapport.get()
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  let changed = false
  const next: Record<string, BotRapport> = {}

  for (const [key, r] of Object.entries(all)) {
    const daysIdle = (now - (r.lastActiveAt || now)) / dayMs

    if (daysIdle >= 1 && r.score > DECAY_FLOOR) {
      const decay = Math.min(Math.floor(daysIdle) * DECAY_PER_DAY, r.score - DECAY_FLOOR)
      next[key] = { ...r, score: r.score - decay }
      changed = true
    } else {
      next[key] = r
    }
  }

  if (changed) {$botRapport.set(next)}
}

/** Live per-bot rapport map for the UI. */
export const $rapportByBot = computed($botRapport, all => all)
