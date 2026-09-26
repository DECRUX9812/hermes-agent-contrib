import { atom } from 'nanostores'

import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { translateNow } from '@/i18n'
import { persistString, storedString } from '@/lib/storage'
import { type ComposerSuggestion, offerSuggestions } from '@/store/composer-suggestions'
import { $sessions } from '@/store/session'
import { $sessionDigestById } from '@/store/session-digest'
import { $sessionDotStateById, type SessionDotState } from '@/store/session-dot-state'

/**
 * Proactive nudges (roadmap #43, opt-in): when a session's turn settles, the
 * pill strip above its composer offers next-step chips — "open a PR" when the
 * last reply reads like finished code work, "schedule a follow-up" always.
 *
 * The contract is deliberately thin: a nudge only writes draft text for the
 * user to review and send. Nothing auto-acts and nothing calls the model —
 * the trigger is a dot-state transition and the heuristics are regexes over
 * text the app already holds. A nudge withdraws the moment the session starts
 * working again: a new turn already says the user moved on.
 */

const STORAGE_KEY = 'hermes:proactive-nudges'

// Dot states where the turn is live (or the session is blocked on the user —
// answering a prompt resumes work, it doesn't settle). A session whose id
// leaves the map entirely has settled to plain `idle`; `unread` is a settled
// turn the user hasn't opened yet. Both are settle moments.
const LIVE: ReadonlySet<SessionDotState> = new Set(['background', 'needs-input', 'stalled', 'working'])

const PROVIDER = 'nudges'

/** Sessions currently holding an offered nudge, by stored id — so a return to
 *  work or a pref flip can withdraw it explicitly. */
const armed = new Set<string>()

/** Opt-in (off by default): proactive UI is the kind of feature you choose. */
export const $proactiveNudgesEnabled = atom<boolean>(storedString(STORAGE_KEY) === '1')

export function setProactiveNudgesEnabled(on: boolean) {
  $proactiveNudgesEnabled.set(on)
  persistString(STORAGE_KEY, on ? '1' : '0')

  if (!on) {
    for (const id of armed) {
      offerSuggestions(id, PROVIDER, [])
    }

    armed.clear()
  }
}

/** Last assistant text for a session: the unread digest when the turn ended
 *  unseen, else the session list's preview. Exported shape feeds the heuristics. */
function settleTextOf(storedId: string): string {
  return (
    $sessionDigestById.get()[storedId] ??
    $sessions.get().find(session => session.id === storedId)?.preview ??
    ''
  )
}

// "Finished code work" tells — deliberately narrow (same lesson as the cron
// provider's recurrence matcher: a chip that fires on every settle is noise).
// Matches verbs the assistant writes when it wrapped a change, not the mere
// mention of code.
const PR_WORTHY_RE =
  /\b(commit(?:s|ted)?|pushed|pull request|\bPR\b|branch(?:es|ed)?|merges?|merged|diff|patch(?:ed|es)?|hotfix)\b/i

const copy = (key: string, ...args: unknown[]) => translateNow(`composer.nudges.${key}`, ...args)

function nudgeChip(id: 'followup' | 'pr', icon: string): ComposerSuggestion {
  return {
    doneLabel: copy(`${id}Done`),
    doneTip: copy(`${id}DoneTip`),
    icon,
    id,
    // A nudge's entire action is drafting text — the user reviews and sends.
    invoke: async () => {
      requestComposerInsert(copy(`${id}Draft`), { mode: 'block' })
      requestComposerFocus()
    },
    label: copy(`${id}Label`),
    provider: PROVIDER,
    tip: copy(`${id}Tip`),
    workingLabel: copy(`${id}Label`),
    workingTip: copy(`${id}Tip`)
  }
}

/** The chips a settled session earns, exported for tests. `settleText` is the
 *  last assistant reply; it decides whether the PR chip joins the follow-up. */
export function nudgeChips(settleText: string): ComposerSuggestion[] {
  const chips: ComposerSuggestion[] = []

  if (PR_WORTHY_RE.test(settleText)) {
    chips.push(nudgeChip('pr', 'git-pull-request'))
  }

  chips.push(nudgeChip('followup', 'calendar'))

  return chips
}

function offer(id: string): void {
  armed.add(id)
  offerSuggestions(id, PROVIDER, nudgeChips(settleTextOf(id)))
}

function withdraw(id: string): void {
  if (armed.delete(id)) {
    offerSuggestions(id, PROVIDER, [])
  }
}

let previousDots: Readonly<Record<string, SessionDotState>> = {}

/** Settle detection, separated from the subscription for tests: live →
 *  settled (missing/`unread`) offers nudges when the pref is on; a session
 *  back in any live state withdraws whatever it was offered. */
export function processDotStates(next: Readonly<Record<string, SessionDotState>>): void {
  const enabled = $proactiveNudgesEnabled.get()

  for (const [id, prev] of Object.entries(previousDots)) {
    const state = next[id]

    if (enabled && LIVE.has(prev) && (state === undefined || state === 'unread')) {
      offer(id)
    }
  }

  for (const [id, state] of Object.entries(next)) {
    if (LIVE.has(state)) {
      withdraw(id)
    }
  }

  previousDots = next
}

// Dot-state transitions are the settle signal: live → missing (idle) or
// 'unread'. The listener is cheap — a diff over a small map that already
// recomputes for the sidebar.
$sessionDotStateById.listen(next => processDotStates(next))

/** Test hook: reset watcher state between cases. */
export function __resetNudgesForTests(): void {
  previousDots = {}

  for (const id of armed) {
    offerSuggestions(id, PROVIDER, [])
  }

  armed.clear()
}
