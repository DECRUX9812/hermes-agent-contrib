/** Shared wording for the Activity feed and its detail view. */

import type { ActivityStep, ActivityTask, ActivityVerb } from '@hermes/plugin-sdk'

import type { BotsText } from './i18n'

export function clockTime(epochSeconds: number): string {
  return epochSeconds
    ? new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : ''
}

/** A row subject's cap — the line a glance reads first. */
const SUBJECT_MAX = 60

/** Cut `text` to `max` chars on a WORD boundary, so a row never ends
 *  mid-word. First line only: a subject is one line or it isn't a subject. */
export function clipWords(text: string, max = SUBJECT_MAX): string {
  const line = text
    .split('\n', 1)[0]
    .replace(/\s+/g, ' ')
    .trim()

  if (line.length <= max) {
    return line
  }

  const window = line.slice(0, max - 1)
  const boundary = window.lastIndexOf(' ')

  return `${(boundary > 0 ? window.slice(0, boundary) : window).trimEnd()}…`
}

/** The shell families whose `input` carries the command itself when the call
 *  had no single target to name (execute_code's payload is never a target). */
const SHELL_TOOLS = new Set(['terminal', 'execute_code', 'process', 'process_manage'])

/** Pretty-printed args are structure, not a subject: `{` / `[` / a JSON key
 *  line never reads as something the bot did. */
function inputLine(input: string): string {
  const line = (input || '').split('\n', 1)[0].trim()

  if (!line || /^[{[]/.test(line) || /^"[^"]*"\s*:/.test(line)) {
    return ''
  }

  return line
}

/** A tool id as a reader would say it: the provider prefix and the snake_case
 *  are plumbing — `mcp_server__search_issues` → `search issues`. */
export function prettifyTool(tool: string): string {
  const name = tool.split('__').pop() || tool

  return name.split('_').filter(Boolean).join(' ').trim()
}

/** What a step acted on, as one phrase — the order a row reads it in:
 *  the target the call carried, then a shell call's first input line, then
 *  (for a tool the verb table doesn't know) its prettified name. '' only
 *  when nothing can name it, which is what makes the bare verb a last
 *  resort rather than the default. */
export function stepSubject(step: ActivityStep): string {
  if (step.subject) {
    return clipWords(step.subject)
  }

  const input = SHELL_TOOLS.has(step.action.tool) ? inputLine(step.action.input) : ''

  if (input) {
    return clipWords(input)
  }

  return step.verb === 'used' ? clipWords(prettifyTool(step.action.tool)) : ''
}

export function stepLabel(step: ActivityStep, a: BotsText['activity'], tense: 'doing' | 'verbs' = 'verbs'): string {
  const verb = a[tense][step.verb]
  const subject = stepSubject(step)

  return subject ? `${verb} ${subject}` : verb
}

/** The step a row's subject names: the verb the task used MOST (so the
 *  headline reads as the work it did — "Ran npm run build"), else the first
 *  step that has anything to name. */
export function subjectStep(task: ActivityTask): ActivityStep | null {
  if (!task.steps.length) {
    return null
  }

  const counts = new Map<ActivityVerb, number>()

  for (const step of task.steps) {
    counts.set(step.verb, (counts.get(step.verb) ?? 0) + 1)
  }

  const [topEntry] = [...counts].sort((left, right) => right[1] - left[1])
  const top = topEntry[0]

  return (
    task.steps.find(step => step.verb === top && stepSubject(step)) ??
    task.steps.find(step => stepSubject(step)) ??
    null
  )
}

/** A task's row subject, as one line:
 *
 *  1. `task.subject` — the model-written subject when the async upgrade
 *     layer has cached one (it lands in this slot), else the request run
 *     through `requestSubject` at derivation;
 *  2. `task.title` — the request, for a task built without the slot filled;
 *  3. the work its steps name, in this locale's wording;
 *  4. the locale's fallback for work that names nothing.
 *
 *  Pure: no RPC, no cache lookup — the UI never waits on a model. */
export function taskSubject(task: ActivityTask, a: BotsText['activity']): string {
  if (task.subject) {
    return task.subject
  }

  if (task.title) {
    return clipWords(task.title)
  }

  const step = subjectStep(task)

  return step ? stepLabel(step, a) : a.onItsOwn
}

/** What the bot is doing right now, for the hero's live line: the running
 *  step, else "Thinking" while the turn is live with no call in flight. */
export function activityNow(tasks: readonly ActivityTask[], a: BotsText['activity']): null | string {
  const live = tasks.at(-1)

  if (live?.status !== 'running') {
    return null
  }

  const step = live.steps.find(s => s.action.status === 'running')

  return step ? stepLabel(step, a, 'doing') : a.thinking
}
