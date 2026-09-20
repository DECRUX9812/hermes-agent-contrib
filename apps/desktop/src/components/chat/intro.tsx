import { useStore } from '@nanostores/react'
import { type ReactNode, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router'

import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { openSession } from '@/app/open-session'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { capitalize, normalize } from '@/lib/text'
import { relativeTime } from '@/lib/time'
import { $currentCwd, $sessions } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import introCopyJsonl from './intro-copy.jsonl?raw'
import { Wordmark } from './wordmark'

type IntroCopy = {
  headline: string
  body: string
}

type IntroCopyRecord = IntroCopy & {
  personality: string
}

export type IntroProps = {
  /** The live composer, rendered in the hero slot while the intro is up so the
   *  empty canvas has exactly one prompt surface (the dock stays empty). */
  composer?: ReactNode
  personality?: string
  seed?: number
}

const NEUTRAL_PERSONALITIES = new Set(['', 'default', 'none', 'neutral'])

const FALLBACK_COPY: IntroCopy[] = [
  {
    headline: 'What are we moving today?',
    body: "Send a bug, branch, plan, or rough idea. I'll inspect the repo and turn it into the next concrete step."
  },
  {
    headline: "What's on your mind?",
    body: "Bring the code, question, or stuck part. I'll read the room before making changes."
  },
  {
    headline: 'What should Hermes look at?',
    body: "Send the task, failing path, or half-formed plan. I'll help turn it into action."
  },
  {
    headline: 'Where should we start?',
    body: "Bring the problem, goal, or file. I'll inspect first and keep the next step concrete."
  },
  {
    headline: 'What needs attention?',
    body: "Send the context you have. I'll help sort it into a plan or a fix."
  }
]

function normalizeKey(value?: string): string {
  return normalize(value)
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ')
}

function isIntroCopyRecord(value: unknown): value is IntroCopyRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.personality === 'string' &&
    typeof record.headline === 'string' &&
    typeof record.body === 'string' &&
    Boolean(record.personality.trim()) &&
    Boolean(record.headline.trim()) &&
    Boolean(record.body.trim())
  )
}

function parseIntroCopy(raw: string): Record<string, IntroCopy[]> {
  const byPersonality: Record<string, IntroCopy[]> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      if (!isIntroCopyRecord(parsed)) {
        continue
      }

      const key = normalizeKey(parsed.personality)
      byPersonality[key] ??= []
      byPersonality[key].push({
        headline: parsed.headline.trim(),
        body: parsed.body.trim()
      })
    } catch {
      // Bad generated copy should not break the whole desktop app.
    }
  }

  return byPersonality
}

const INTRO_COPY_BY_PERSONALITY = parseIntroCopy(introCopyJsonl)

function neutralCopy(): IntroCopy[] {
  return INTRO_COPY_BY_PERSONALITY.none || INTRO_COPY_BY_PERSONALITY.default || FALLBACK_COPY
}

function fallbackCopyForPersonality(personalityKey: string): IntroCopy[] {
  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return neutralCopy()
  }

  const label = titleize(personalityKey)

  return [
    {
      headline: `${label} mode is on. What should we work on?`,
      body: "Send the task, file, or rough idea. I'll use your configured voice and keep the work grounded in this repo."
    },
    {
      headline: `What does ${label} Hermes need to see?`,
      body: "Bring the context or the stuck part. I'll adapt to your configured personality."
    },
    {
      headline: `${label} mode is ready.`,
      body: "Send the problem, file, or idea. I'll follow the personality you've configured."
    },
    {
      headline: `What should ${label} Hermes tackle?`,
      body: "Drop the task here. I'll keep the work grounded in the repo."
    },
    {
      headline: 'Where should we begin?',
      body: `Give me the context and I'll answer in ${label} mode.`
    }
  ]
}

function pickCopy(copies: IntroCopy[], seed = 0): IntroCopy {
  return copies[Math.abs(seed) % copies.length] || FALLBACK_COPY[0]
}

const WORDMARK = 'HERMES AGENT'

type IntroSuggestion = { icon: string; label: string; prompt: string }

const SUGGESTION_WHAT_CAN_YOU_DO: IntroSuggestion = {
  icon: 'sparkle',
  label: 'What can you do?',
  prompt: 'What can you do? Give me a quick tour of your capabilities and the kinds of tasks you can take on.'
}

const SUGGESTION_EXPLAIN_CODEBASE: IntroSuggestion = {
  icon: 'code',
  label: 'Explain this codebase',
  prompt:
    'Explore this codebase and explain what it does, how it is organized, and where a new contributor should start.'
}

const SUGGESTION_FIND_BUG: IntroSuggestion = {
  icon: 'bug',
  label: 'Find and fix a bug',
  prompt: 'Look through this project for a likely bug, explain what is wrong, and fix it.'
}

const SUGGESTION_PLAN_FEATURE: IntroSuggestion = {
  icon: 'lightbulb',
  label: 'Plan a new feature',
  prompt:
    'Help me plan a new feature for this project. Ask me what I want, then propose a concrete step-by-step plan.'
}

const SUGGESTION_LOOSE_ENDS: IntroSuggestion = {
  icon: 'history',
  label: 'Pick up loose ends',
  prompt: 'Review my recent sessions and tell me what is unfinished or needs a follow-up.'
}

const SUGGESTION_RECENT_RECAP: IntroSuggestion = {
  icon: 'notebook',
  label: 'Recap recent work',
  prompt: 'Summarize what we accomplished in my recent sessions and what is still open.'
}

const SUGGESTION_LIMIT = 4

// Chips adapt to what the app already knows: a picked workspace earns the
// codebase-oriented prompts, prior sessions earn the follow-up prompts, and a
// fresh install falls back to the tour + planning starters. Chips prefill the
// composer rather than sending — the user always sees and edits the ask first.
function introSuggestions({ hasSessions, hasWorkspace }: { hasSessions: boolean; hasWorkspace: boolean }): IntroSuggestion[] {
  const suggestions: IntroSuggestion[] = []

  if (hasWorkspace) {
    suggestions.push(SUGGESTION_EXPLAIN_CODEBASE, SUGGESTION_FIND_BUG)
  }

  if (hasSessions) {
    suggestions.push(SUGGESTION_LOOSE_ENDS, SUGGESTION_RECENT_RECAP)
  } else {
    suggestions.push(SUGGESTION_WHAT_CAN_YOU_DO)
  }

  suggestions.push(SUGGESTION_PLAN_FEATURE)

  return suggestions.slice(0, SUGGESTION_LIMIT)
}

function resolveCopy(personality?: string, seed?: number): IntroCopy {
  const personalityKey = normalizeKey(personality)

  const copies = NEUTRAL_PERSONALITIES.has(personalityKey)
    ? INTRO_COPY_BY_PERSONALITY[personalityKey] || neutralCopy()
    : INTRO_COPY_BY_PERSONALITY[personalityKey] || fallbackCopyForPersonality(personalityKey)

  return pickCopy(copies, seed)
}

const RECENT_SESSION_LIMIT = 3

// Backend timestamps arrive in seconds; relativeTime wants ms.
function sessionRecencyMs(session: SessionInfo): number {
  return (session.last_active || session.started_at || 0) * 1000
}

export function Intro({ composer, personality, seed }: IntroProps) {
  const { t } = useI18n()
  // Intro is mounted inside a Router in the app, but tests and other hosts
  // render it bare — the resume rows (which need `useNavigate`) mount only
  // when a router actually exists.
  const inRouter = useInRouterContext()
  const sessions = useStore($sessions)
  const currentCwd = useStore($currentCwd)
  const [mountSeed] = useState(() => Math.floor(Math.random() * 100000))
  const copy = resolveCopy(personality, mountSeed + (seed ?? 0))

  // "Pick up where you left off" — recency-sorted, most recent first.
  const recentSessions = sessions
    .filter(session => !session.archived)
    .sort((a, b) => sessionRecencyMs(b) - sessionRecencyMs(a))
    .slice(0, RECENT_SESSION_LIMIT)

  return (
    <div
      className="pointer-events-none relative isolate flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-6 text-center text-muted-foreground sm:px-6 lg:px-8"
      data-slot="aui_intro"
    >
      {/* Ambient brand wash — a soft radial fade that gives the empty canvas
          depth without any painted surface. Theme-token derived, so it follows
          accent + appearance changes for free. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 -top-8 -z-10 h-72 bg-[radial-gradient(ellipse_58%_100%_at_50%_0%,color-mix(in_srgb,var(--theme-midground)_10%,transparent),transparent_72%)]"
      />
      <div className="w-full min-w-0">
        <Wordmark
          className="mb-1 bg-gradient-to-b from-(--theme-midground) to-[color-mix(in_srgb,var(--theme-midground)_58%,var(--ui-bg-chrome))] bg-clip-text text-transparent dark:text-transparent"
          text={WORDMARK}
          width="min(36rem, 82%)"
        />

        <p className="m-0 text-center text-[0.9375rem] leading-normal tracking-tight text-(--ui-text-secondary)">
          {copy.body}
        </p>
      </div>

      {/* Everything actionable — the composer, the starter chips, the recency
          rows — sits on the composer's own width, so the empty canvas and the
          dock below it share one grid. The wrapper is deliberate:
          `[data-slot='aui_intro'] > div` in styles.css pins direct children to
          the composer width, which is what silently flattened the per-element
          `max-w-*` caps the stack used to carry. */}
      <div className="pointer-events-auto flex w-full min-w-0 flex-col items-center">
        {composer}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {introSuggestions({ hasSessions: recentSessions.length > 0, hasWorkspace: Boolean(currentCwd.trim()) }).map(
            suggestion => (
              <Button
                className="rounded-full"
                key={suggestion.label}
                onClick={() => {
                  triggerHaptic('selection')
                  requestComposerInsert(suggestion.prompt)
                  requestComposerFocus()
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Codicon className="opacity-70" name={suggestion.icon} />
                {suggestion.label}
              </Button>
            )
          )}
        </div>

        {inRouter && recentSessions.length > 0 && <RecentSessionRows sessions={recentSessions} />}
      </div>
    </div>
  )
}

function RecentSessionRows({ sessions }: { sessions: SessionInfo[] }) {
  const { t } = useI18n()
  const navigate = useNavigate()

  return (
    <div className="mt-5 w-full">
      <p className="mb-1 w-full px-2.5 text-left text-[0.6875rem] font-medium uppercase tracking-wider text-(--ui-text-quaternary)">
        {t.intro.recentSessions}
      </p>
      <div className="flex flex-col gap-0.5">
        {sessions.map(session => (
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] text-(--ui-text-tertiary) transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-secondary)"
            key={session.id}
            onClick={() => {
              triggerHaptic('selection')
              openSession(session.id, navigate, 'in-place')
            }}
            type="button"
          >
            <span className="min-w-0 flex-1 truncate">
              {session.title || session.preview || t.sidebar.row.untitledChat(session.id.slice(0, 8))}
            </span>
            <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">
              {relativeTime(sessionRecencyMs(session))}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
