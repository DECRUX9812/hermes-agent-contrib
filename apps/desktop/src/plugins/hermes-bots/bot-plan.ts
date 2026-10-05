/**
 * Bot plan mode (bot-mode B1 + B2) — renderer-side plan approval, zero backend
 * state.
 *
 * B1: `/plan <task>` typed in a bot's canonical chat is rewritten by composer
 * middleware into a plan-mode prompt (`planModePrompt`). The model replies
 * with a numbered plan ending in a bare `::botplan` marker paragraph, which a
 * `transcript.directives` contribution renders as an approval card
 * (bot-plan-card.tsx). Approve submits the execution prompt; dismiss/edit
 * leave the reply as ordinary chat.
 *
 * B2: the live checklist derives ENTIRELY from the transcript — an approved
 * plan is a `::botplan` assistant message followed by a user message starting
 * with EXECUTE_PLAN_PREFIX; progress comes from the model's own `DONE: step N`
 * lines, which the execute prompt asks for. A renderer restart re-derives the
 * same checklist — the conversation is the authority, so there is nothing to
 * persist, sync, or migrate.
 *
 * All model-bound strings (the mode prefix, the execute prompt, the `::botplan`
 * marker, the `DONE:` convention) stay English — they are addressed to the
 * model, which reads English best (see the i18n header). Everything the user
 * SEES lives in i18n.ts.
 */

import { type ChatMessage, chatMessageText } from '@hermes/plugin-sdk'

/** The transcript directive name the model addresses — `::botplan` alone on
 *  its own paragraph at the end of the plan reply. */
export const BOT_PLAN_DIRECTIVE = 'botplan'

/** `/plan` or `/plan <task>` — only ever intercepted inside a canonical bot
 *  chat; everywhere else the draft passes through to the backend's own
 *  `/plan` (which writes .hermes/plans/*.md). */
export const BOT_PLAN_SLASH_RE = /^\/plan(?:\s+([\s\S]*))?$/

/** First words of the approve submit — how the checklist recognizes an
 *  approved plan in the transcript without any stored id. */
export const EXECUTE_PLAN_PREFIX = 'Execute this plan'

const MAX_PLAN_STEPS = 12

// `::botplan` on its own line — tolerant of trailing attrs/whitespace.
// Non-global for `.test` (a `g` regex keeps lastIndex between calls, which
// alternates results); the global twin below is only for stripping.
const PLAN_MARKER_TEST_RE = /^::botplan\b[^\n]*$/im
const PLAN_MARKER_LINE_RE = /^::botplan\b[^\n]*$/gim

// One numbered step: `1. Do the thing` / `2) Check the output`.
const NUMBERED_STEP_RE = /^[ \t]*(\d{1,2})[.)][ \t]+(\S[^\n]*)$/gm

// `DONE: step 3`, `DONE 3`, `done - step 3`; and the flipped `Step 3 done`.
const DONE_FORWARD_RE = /\b(?:done|finished|completed)[\s:—–-]*(?:step\s*)?#?\s*(\d{1,2})\b/gi
const DONE_REVERSE_RE = /\bstep\s*(\d{1,2})\b[\s:—–-]*\b(?:done|finished|complete)\b/gi

/**
 * What the model sees when the user sends `/plan <task>` in a bot chat.
 * Written for the model (English), never rendered as chrome.
 *
 * The contract: a numbered plan, then a final `::botplan` paragraph. The
 * marker must sit in its own paragraph — a `::` line that merges into the
 * list above never claims, and the reply falls back to plain text.
 */
export function planModePrompt(task: string): string {
  const trimmed = task.trim()

  const brief = trimmed
    ? `The task to plan:\n\n${trimmed}`
    : 'No task was given yet — first ask the user (in one short question) what to plan.'

  return (
    '[plan mode] The user wants a reviewed plan before anything runs. ' +
    'Do NOT call tools, write files, or execute anything — this turn is planning only.\n\n' +
    'Reply with ONLY:\n' +
    '  1. A numbered plan — one short step per line, at most 8 steps.\n' +
    '  2. A blank line, then the exact marker `::botplan` alone on the last line.\n\n' +
    'The desktop renders that reply as an approval card; on approve you will get ' +
    'a follow-up telling you to execute.\n\n' +
    brief
  )
}

/**
 * Rewrite a `/plan` draft into the plan-mode prompt. Returns null when the
 * draft is not a bare `/plan` command or the composer isn't a canonical bot
 * chat — the caller passes the draft through untouched in both cases. The
 * bubble keeps what the user typed (`displayText`), so the transcript reads
 * `/plan <task>`, not the model-bound scaffold.
 */
export function rewritePlanDraft(text: string, canonicalChat: boolean): { displayText: string; text: string } | null {
  if (!canonicalChat) {
    return null
  }

  const match = BOT_PLAN_SLASH_RE.exec(text.trim())

  if (!match) {
    return null
  }

  return {
    displayText: text.trim(),
    text: planModePrompt(match[1] ?? '')
  }
}

export interface ParsedBotPlan {
  /** Ordered step bodies, numbers stripped (`['Do the thing', …]`). */
  steps: string[]
  /** The reply minus the `::botplan` marker line — the text an approve turn
   *  hands back as the plan to run. */
  planText: string
}

/**
 * Pull the numbered plan out of a `::botplan` assistant reply. Returns null
 * only when there are no numbered lines at all — a non-compliant reply still
 * parses so the card can offer "run it anyway".
 */
export function parseBotPlanReply(text: string): ParsedBotPlan {
  const planText = text.replace(PLAN_MARKER_LINE_RE, '').trim()

  const steps: string[] = []
  NUMBERED_STEP_RE.lastIndex = 0

  for (const match of planText.matchAll(NUMBERED_STEP_RE)) {
    if (steps.length >= MAX_PLAN_STEPS) {
      break
    }

    const body = match[2].trim()

    if (body) {
      steps.push(body)
    }
  }

  return { planText, steps }
}

/**
 * The turn the Approve button sends. `planText` is the plan the card parsed
 * out of the reply — restating it (rather than a bare "execute the plan
 * above") keeps the instruction intact across compaction. The `DONE:` line
 * convention is what the checklist reads; it is part of the prompt because
 * nothing else can carry it — the model never saw this turn coming.
 */
export function buildPlanExecutePrompt(planText: string): string {
  const plan = planText.trim()

  return (
    `${EXECUTE_PLAN_PREFIX}${plan ? `:\n\n${plan}` : ' you just proposed.'}\n\n` +
    'Work through it now. After you finish each numbered step, emit exactly one line ' +
    '`DONE: step N` (N = the step number) on its own line so the checklist can tick it off.'
  )
}

export interface BotPlanState {
  /** The `::botplan` assistant message this plan came from. */
  planMessageId: string
  steps: string[]
  /** Step numbers (1-based) the agent has reported DONE so far. */
  doneSteps: Set<number>
  /** Every declared step ticked. */
  complete: boolean
}

function isPlanMessage(message: ChatMessage): boolean {
  return message.role === 'assistant' && PLAN_MARKER_TEST_RE.test(chatMessageText(message))
}

function hasExecutePrefix(message: ChatMessage): boolean {
  return (
    message.role === 'user' && !message.hidden && chatMessageText(message).trimStart().startsWith(EXECUTE_PLAN_PREFIX)
  )
}

function collectDoneSteps(text: string, out: Set<number>): void {
  DONE_FORWARD_RE.lastIndex = 0
  DONE_REVERSE_RE.lastIndex = 0

  for (const match of text.matchAll(DONE_FORWARD_RE)) {
    out.add(Number(match[1]))
  }

  for (const match of text.matchAll(DONE_REVERSE_RE)) {
    out.add(Number(match[1]))
  }
}

/**
 * Derive the session's active plan, or null. The ACTIVE plan is the LAST
 * `::botplan` message that a following user message approved (the
 * EXECUTE_PLAN_PREFIX turn the Approve button sends). A plan the user
 * answered with any other message — or hasn't answered at all — stays a
 * proposal, never a checklist.
 *
 * Pure over the transcript: streaming deltas, hydration, and reloads all read
 * the same shape, so the checklist never has a sync problem to solve.
 */
export function deriveBotPlanState(messages: readonly ChatMessage[]): BotPlanState | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const candidate = messages[index]

    if (!isPlanMessage(candidate)) {
      continue
    }

    // The approval is the NEXT visible user message — anything else in
    // between (a steer, another question) means this plan was never taken up.
    const approval = messages.slice(index + 1).find(message => message.role === 'user' && !message.hidden)

    if (!approval || !hasExecutePrefix(approval)) {
      continue
    }

    const { steps } = parseBotPlanReply(chatMessageText(candidate))

    if (!steps.length) {
      return null
    }

    const approvalIndex = messages.indexOf(approval)
    const doneSteps = new Set<number>()

    for (const message of messages.slice(approvalIndex + 1)) {
      if (message.role === 'assistant') {
        collectDoneSteps(chatMessageText(message), doneSteps)
      }
    }

    for (const step of doneSteps) {
      if (step < 1 || step > steps.length) {
        doneSteps.delete(step)
      }
    }

    return {
      complete: doneSteps.size === steps.length,
      doneSteps,
      planMessageId: candidate.id,
      steps
    }
  }

  return null
}
