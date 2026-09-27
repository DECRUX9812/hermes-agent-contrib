/**
 * Bot plan mode invariants (B1 + B2).
 *
 * B1 — `/plan <task>` in a canonical Bot Chat is rewritten into a plan-mode
 * prompt (numbered plan + `::botplan` marker, no tool calls), and ONLY there —
 * a non-canonical composer's `/plan` belongs to the backend's own planner and
 * must pass through untouched. The approve turn the card sends starts with
 * `Execute this plan` — that literal prefix is the transcript marker B2 keys
 * on, so it is an interface, not phrasing.
 *
 * B2 — the checklist derives ENTIRELY from the transcript: the last `::botplan`
 * assistant message whose next visible user message carries the execute prefix
 * is the active plan; `DONE: step N` lines in later assistant turns tick it.
 * No store, no ids, no backend state — reloads and streaming re-derive the
 * same answer, which is what makes these derivable invariants worth pinning.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  buildPlanExecutePrompt,
  deriveBotPlanState,
  EXECUTE_PLAN_PREFIX,
  parseBotPlanReply,
  rewritePlanDraft
} from './bot-plan'

vi.mock('@hermes/plugin-sdk', () => ({
  // The real `chatMessageText` joins a message's text parts — the module
  // under test uses nothing else off the SDK, so the seam under test stays
  // the real code (plugin tests may not import `@/` internals).
  chatMessageText: (message: { parts: Array<{ text?: string; type: string }> }) =>
    message.parts
      .filter(part => part.type === 'text')
      .map(part => part.text ?? '')
      .join('')
}))

type Msg = Parameters<typeof deriveBotPlanState>[0][number]

const textPart = (text: string): Msg['parts'][number] => ({ text, type: 'text' }) as Msg['parts'][number]

const user = (id: string, text: string, hidden?: boolean): Msg => ({
  hidden,
  id,
  parts: [textPart(text)],
  role: 'user'
})

const assistant = (id: string, text: string): Msg => ({ id, parts: [textPart(text)], role: 'assistant' })

const PLAN_REPLY = '1. Audit the parser\n2. Add the flag\n3. Update the tests\n\n::botplan'
const EXECUTE_TURN = `${EXECUTE_PLAN_PREFIX}:\n\n1. Audit the parser\n2. Add the flag\n3. Update the tests`

describe('B1 — /plan rewrite is canonical-chat-scoped', () => {
  it('rewrites a /plan draft for the model while the bubble keeps the typed text', () => {
    const rewritten = rewritePlanDraft('/plan audit the auth flow', true)

    expect(rewritten).not.toBeNull()
    expect(rewritten?.displayText).toBe('/plan audit the auth flow')
    // The model gets the scaffold, not the slash text — so submitText never
    // dispatches it to the backend's own /plan handler.
    expect(rewritten?.text).not.toMatch(/^\/plan/)
    expect(rewritten?.text).toContain('audit the auth flow')
    // The plan contract: numbered plan, planning-only turn, marker last.
    expect(rewritten?.text).toContain('::botplan')
    expect(rewritten?.text).toMatch(/do not call tools|Do NOT call tools/i)
  })

  it('leaves non-canonical chats and non-plan text alone', () => {
    // Same text outside a canonical bot chat is the backend's /plan.
    expect(rewritePlanDraft('/plan audit the auth flow', false)).toBeNull()
    // Only a bare /plan command intercepts — ordinary chat passes through.
    expect(rewritePlanDraft('what is the plan for auth?', true)).toBeNull()
  })

  it('builds the approve turn off the plan text with the DONE convention', () => {
    const prompt = buildPlanExecutePrompt('1. Audit\n2. Ship')

    expect(prompt.startsWith(EXECUTE_PLAN_PREFIX)).toBe(true)
    expect(prompt).toContain('1. Audit')
    // The checklist's only signal is the agent's own DONE lines — they must
    // be part of the prompt it acts on.
    expect(prompt).toContain('DONE: step')
  })
})

describe('B1 — plan reply parsing', () => {
  it('extracts numbered steps and strips the marker', () => {
    const parsed = parseBotPlanReply(PLAN_REPLY)

    expect(parsed.steps).toEqual(['Audit the parser', 'Add the flag', 'Update the tests'])
    expect(parsed.planText).not.toContain('::botplan')
    expect(parsed.planText).toContain('Audit the parser')
  })

  it('accepts the ) variant and ignores bullets and prose', () => {
    const parsed = parseBotPlanReply('Here is the plan.\n1) First\n2) Second\n- not a step\n\n::botplan')

    expect(parsed.steps).toEqual(['First', 'Second'])
  })
})

describe('B2 — checklist derives from the transcript only', () => {
  it('exposes an approved plan only after the execute turn, and ticks DONE steps', () => {
    const messages: Msg[] = [
      user('u0', '/plan audit the auth flow'),
      assistant('p1', PLAN_REPLY),
      user('u1', EXECUTE_TURN),
      assistant('a1', 'Auditing…\n\nDONE: step 1'),
      assistant('a2', 'Flag added.\nDONE: step 2')
    ]

    const plan = deriveBotPlanState(messages)

    expect(plan?.planMessageId).toBe('p1')
    expect(plan?.steps).toEqual(['Audit the parser', 'Add the flag', 'Update the tests'])
    expect(plan?.doneSteps).toEqual(new Set([1, 2]))
    expect(plan?.complete).toBe(false)
  })

  it('an unapproved proposal is not a checklist', () => {
    // The user answered with anything BUT the execute prefix (typed reply,
    // edit, dismiss) — the card settled, the plan never ran.
    expect(
      deriveBotPlanState([user('u0', '/plan x'), assistant('p1', PLAN_REPLY), user('u1', 'actually never mind')])
    ).toBeNull()

    // No answer at all — the proposal is still on the card.
    expect(deriveBotPlanState([user('u0', '/plan x'), assistant('p1', PLAN_REPLY)])).toBeNull()
  })

  it('completes when every step reports done, and ignores out-of-range DONE lines', () => {
    const messages: Msg[] = [
      assistant('p1', PLAN_REPLY),
      user('u1', EXECUTE_TURN),
      assistant('a1', 'DONE: step 1\nDONE: step 2\nDONE: step 3\nDONE: step 9')
    ]

    const plan = deriveBotPlanState(messages)

    expect(plan?.doneSteps).toEqual(new Set([1, 2, 3]))
    expect(plan?.complete).toBe(true)
  })
})
