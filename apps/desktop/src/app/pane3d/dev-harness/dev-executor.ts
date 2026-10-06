/**
 * The dev-harness TaskExecutor — version 1 of `TaskExecutor` (architecture
 * §8.7, §11).
 *
 * LABELLED scaffolding: its label and `isDevHarness` flag make every surface it
 * drives carry the Dev-harness badge. The script is deterministic — three
 * progress steps, a stream of tokens that quotes the captured title/selection,
 * and a result that references the same context — so a validator can assert the
 * whole working sequence without a model.
 *
 * `devScript` is pure: given the task it returns the ordered `{ at, event }`
 * steps, which is what makes the labels, the stream and the chart decision
 * unit-testable without timers.
 */

import type { AvatarTask, TaskEvent, TaskExecutor, TaskResult } from '../director/tasks'

import { DEMO_CHART } from './demo-data'
import { LAUNCH_DEMO_DRAFT } from './launch-demo'

export const DEV_PROGRESS_STEPS = ['Reading the post', 'Sketching the build', 'Rendering preview'] as const

const PROGRESS_AT_MS = [120, 700, 1600]
const PROGRESS_PCT = [0.08, 0.42, 0.8]
const TOKEN_START_MS = 260
const TOKEN_EVERY_MS = 190
const DONE_TAIL_MS = 240
const EXCERPT_MAX = 90

export interface DevStep {
  at: number
  event: TaskEvent
}

/** Dash characters a keyboard, autocorrect or a chat client can produce. */
const DASH_VARIANTS = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFF0D]/g
/** What a user may add to (or drop from) the end of the story line. */
const TRAILING_PUNCTUATION = /[.!?…,;:'"”’)\]]+$/u

/**
 * The story line is the launch demo's own pre-filled request, but the demo is
 * optional: a user who watched it (or was told about it) retypes the line, and
 * a validator types it into Grok's composer directly. All three forms must ask
 * for the same chart, so the comparison forgives dashes, case, spacing and the
 * trailing question mark.
 */
function normalizeRequest(text: string): string {
  return text
    .replace(DASH_VARIANTS, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_PUNCTUATION, '')
    .trim()
    .toLowerCase()
}

function isLaunchStoryRequest(text: string): boolean {
  return normalizeRequest(text) === normalizeRequest(LAUNCH_DEMO_DRAFT)
}

/** The chart rides along when the request is about numbers, or the launch demo asks. */
export function shouldAttachChart(text: string, demoRequested = false): boolean {
  return demoRequested || isLaunchStoryRequest(text) || /growth|chart|stats/i.test(text)
}

function excerpt(text: string, max = EXCERPT_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim()

  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

/**
 * How the script refers to the captured page. Titles already carry their own
 * quotes (`Ada on X: "Look at this generative shader"`), so this never wraps
 * them in a second pair — nested quotes read as a bug.
 */
function pageLabel(task: AvatarTask, max = 64): string {
  const title = task.context.title?.replace(/\s+/g, ' ').trim()

  return title ? excerpt(title, max) : 'the current screen'
}

/** What the avatar says while it works — every line quotes the captured page. */
function sentences(task: AvatarTask, chart: boolean): string[] {
  const selection = task.context.selection?.trim()

  return [
    `Reading ${pageLabel(task)} now.`,
    selection ? `You had “${excerpt(selection)}” selected, so that is the focus.` : 'Working from what is on screen.',
    'Here is the build I would ship: a hero with the headline, the image, then one clear call to action.',
    'It is mobile-first, and the type scale is fluid so it holds at every width.',
    'I kept the page’s own accent for the primary button.',
    chart
      ? 'I added a weekly chart underneath so the numbers read at a glance.'
      : 'The section order follows the page hierarchy.',
    'That is the plan — tell me what you would change.'
  ]
}

/** Split a sentence into small pieces so the pill's stream visibly grows. */
function chunks(text: string, words = 4): string[] {
  const tokens = text.split(' ')
  const out: string[] = []

  for (let index = 0; index < tokens.length; index += words) {
    out.push(`${tokens.slice(index, index + words).join(' ')} `)
  }

  return out
}

export function devResult(task: AvatarTask, chart: boolean): TaskResult {
  const selection = task.context.selection?.trim()
  const label = pageLabel(task, 48)

  return {
    body: [
      `Built from ${pageLabel(task)}.`,
      selection
        ? `It leads with the part you selected: “${excerpt(selection, 120)}”.`
        : 'It leads with the headline and one clear call to action.',
      'Responsive, token-driven, and ready for a review pass.'
    ].join(' '),
    chart: chart ? DEMO_CHART : undefined,
    links: task.context.url ? [{ label: 'Open the source page', url: task.context.url }] : undefined,
    presentChart: chart && task.demo === 'launch' ? true : undefined,
    title: `A build for ${label}`
  }
}

export function devScript(task: AvatarTask): DevStep[] {
  const chart = shouldAttachChart(task.text, task.demo === 'launch')
  const steps: DevStep[] = [{ at: 0, event: { type: 'accepted' } }]

  DEV_PROGRESS_STEPS.forEach((label, index) => {
    steps.push({ at: PROGRESS_AT_MS[index], event: { label, pct: PROGRESS_PCT[index], type: 'progress' } })
  })

  const stream = sentences(task, chart).flatMap(sentence => chunks(sentence))

  stream.forEach((text, index) => {
    steps.push({ at: TOKEN_START_MS + index * TOKEN_EVERY_MS, event: { text, type: 'token' } })
  })

  steps.push({
    at: TOKEN_START_MS + stream.length * TOKEN_EVERY_MS + DONE_TAIL_MS,
    event: { result: devResult(task, chart), type: 'done' }
  })

  return steps.sort((a, b) => a.at - b.at)
}

export class DevHarnessExecutor implements TaskExecutor {
  readonly isDevHarness = true
  readonly label = 'Dev harness'

  run(task: AvatarTask, emit: (event: TaskEvent) => void): () => void {
    // Only the launch demo's own task carries the marker (§11), so the chart
    // is automatic on that one task; a user's story-line request gets the same
    // chart but keeps its card and reaches it through "Show chart" (§8.9).
    const steps = devScript(task)
    const timers = steps.map(step => setTimeout(() => emit(step.event), step.at))

    return () => {
      timers.forEach(clearTimeout)
      timers.length = 0
    }
  }
}
