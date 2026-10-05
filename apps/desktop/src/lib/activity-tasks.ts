import type { ChatMessage } from '@/lib/chat-messages'
import { type LiveAction, toLiveAction, type ToolCallPart } from '@/lib/live-actions'

/**
 * The Activity view's data: a session read as a list of TASKS instead of one
 * long transcript. Each user request opens a task; the tool calls the agent
 * made answering it are that task's steps, in order, each with the raw
 * command/input/output the Live feed already shows. Derived from the parts
 * the session holds, so nothing here needs a new RPC and a reload rebuilds
 * the same list.
 */

/** What a step did, as one plain verb. The UI owns the wording. */
export type ActivityVerb =
  | 'asked'
  | 'browsed'
  | 'created'
  | 'delegated'
  | 'edited'
  | 'looked'
  | 'operated'
  | 'planned'
  | 'ran'
  | 'read'
  | 'remembered'
  | 'scheduled'
  | 'searched'
  | 'tracked'
  | 'used'

export type ActivityStatus = 'done' | 'error' | 'running' | 'stopped'

export interface ActivityStep {
  id: string
  verb: ActivityVerb
  /** The thing acted on, short: a file name, a command's first line, a
   *  query, a host. '' when the call has no single target. */
  subject: string
  action: LiveAction
}

export interface ActivityTask {
  id: string
  /** The request, first line, as the user wrote it. '' for work the agent
   *  started on its own (an intro, a resumed turn with no request in view). */
  title: string
  status: ActivityStatus
  /** Seconds since epoch. */
  startedAt: number
  completedAt: null | number
  steps: ActivityStep[]
  /** First sentence of the agent's final reply, '' until it has one. */
  outcome: string
  errorCount: number
}

const VERB_BY_TOOL: Readonly<Record<string, ActivityVerb>> = {
  clarify: 'asked',
  computer_use: 'operated',
  cronjob_manage: 'scheduled',
  delegate_task: 'delegated',
  execute_code: 'ran',
  image_generate: 'created',
  memory: 'remembered',
  patch: 'edited',
  process: 'ran',
  process_manage: 'ran',
  read_file: 'read',
  search_files: 'searched',
  session_search: 'searched',
  skill_manage: 'edited',
  skill_view: 'read',
  skills_list: 'searched',
  terminal: 'ran',
  text_to_speech: 'created',
  todo_list: 'planned',
  vision_analyze: 'looked',
  web_extract: 'browsed',
  web_search: 'searched',
  write_file: 'edited',
  x_search: 'searched'
}

/** Tool families named by prefix rather than one by one. */
const VERB_BY_PREFIX: readonly (readonly [string, ActivityVerb])[] = [
  ['browser_', 'browsed'],
  ['kanban_', 'tracked']
]

export function activityVerb(tool: string): ActivityVerb {
  const exact = VERB_BY_TOOL[tool]

  if (exact) {
    return exact
  }

  return VERB_BY_PREFIX.find(([prefix]) => tool.startsWith(prefix))?.[1] ?? 'used'
}

const SUBJECT_MAX = 80

function clip(text: string, max = SUBJECT_MAX): string {
  const line = text.split('\n', 1)[0].trim()

  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')

  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed
}

function host(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function subjectOf(verb: ActivityVerb, target: string): string {
  if (!target) {
    return ''
  }

  if (verb === 'read' || verb === 'edited') {
    return clip(basename(target))
  }

  if (verb === 'browsed' && /^https?:\/\//i.test(target)) {
    return clip(host(target))
  }

  return clip(target)
}

function textOf(message: ChatMessage): string {
  return message.parts
    .map(part => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim()
}

/** The reply's opening sentence: what a glance at the list should say. */
function firstSentence(text: string): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const end = flat.search(/[.!?](\s|$)/)

  return clip(end > 0 ? flat.slice(0, end + 1) : flat, 140)
}

function isRequest(message: ChatMessage): boolean {
  return message.role === 'user' && message.userOriginated !== false
}

interface Draft {
  task: ActivityTask
  reply: string
  ended: 'error' | 'stopped' | null
}

function openTask(id: string, title: string, startedAt: number): Draft {
  return {
    task: { completedAt: null, errorCount: 0, id, outcome: '', startedAt, status: 'done', steps: [], title },
    reply: '',
    ended: null
  }
}

function addMessage(draft: Draft, message: ChatMessage, seen: Map<string, ActivityStep>): void {
  message.parts.forEach((part, index) => {
    if (part.type !== 'tool-call') {
      return
    }

    const id = part.toolCallId || `${message.id}:${index}`
    const action = toLiveAction(part as ToolCallPart, id)
    const known = seen.get(id)

    if (known) {
      // A replayed completion or resealed bubble: keep the call's latest state.
      known.action = action

      return
    }

    const verb = activityVerb(action.tool)
    const step: ActivityStep = { action, id, subject: subjectOf(verb, action.target), verb }

    seen.set(id, step)
    draft.task.steps.push(step)
  })

  const text = textOf(message)

  if (text) {
    draft.reply = text
  }

  if (message.error) {
    draft.ended = 'error'
  } else if (message.interrupted) {
    draft.ended = 'stopped'
  }

  const end = message.completedAt ?? message.timestamp

  if (end) {
    draft.task.completedAt = Math.max(draft.task.completedAt ?? 0, end)
  }

  if (!draft.task.startedAt && message.timestamp) {
    draft.task.startedAt = message.timestamp
  }
}

function seal(draft: Draft, live: boolean): ActivityTask {
  const { task } = draft
  const steps = task.steps
  const anyRunning = steps.some(step => step.action.status === 'running')

  task.errorCount = steps.filter(step => step.action.status === 'error').length
  task.outcome = draft.reply ? firstSentence(draft.reply) : ''

  for (const step of steps) {
    task.startedAt ||= step.action.startedAt
    task.completedAt = Math.max(task.completedAt ?? 0, step.action.completedAt ?? 0) || task.completedAt
  }

  task.status = live || anyRunning ? 'running' : (draft.ended ?? 'done')

  if (task.status === 'running') {
    task.completedAt = null
  }

  return task
}

/** A session's messages as tasks, oldest first. `busy` marks the newest task
 *  as still running (the turn is live even between tool calls). Tasks with
 *  neither a request nor a step (a bare greeting) are left out: there was no
 *  work to show. */
export function deriveActivityTasks(
  messages: readonly ChatMessage[] | undefined,
  { busy = false }: { busy?: boolean } = {}
): ActivityTask[] {
  const drafts: Draft[] = []
  const seen = new Map<string, ActivityStep>()

  for (const message of messages ?? []) {
    if (message.hidden && !isRequest(message)) {
      continue
    }

    if (isRequest(message)) {
      drafts.push(openTask(message.id, clip(textOf(message), 120), message.timestamp ?? 0))

      continue
    }

    if (message.role !== 'assistant') {
      continue
    }

    if (!drafts.length) {
      drafts.push(openTask(message.id, '', message.timestamp ?? 0))
    }

    addMessage(drafts[drafts.length - 1], message, seen)
  }

  return drafts
    .map((draft, index) => seal(draft, busy && index === drafts.length - 1))
    .filter(task => task.title || task.steps.length)
}

/** The step a list row should name: the one running, else the last. */
export function currentStep(task: ActivityTask): ActivityStep | null {
  return task.steps.find(step => step.action.status === 'running') ?? task.steps.at(-1) ?? null
}
