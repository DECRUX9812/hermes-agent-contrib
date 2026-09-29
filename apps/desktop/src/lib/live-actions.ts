import type { ChatMessage, ChatMessagePart } from '@/lib/chat-messages'

/**
 * The Live feed's data: every tool call a session made, in the order it made
 * them, with the raw input and the raw output — never the transcript's
 * grouped summary ("ran 6 commands"). Derived from the tool-call parts the
 * session already holds: `tool.start` carries the full args and
 * `tool.complete` the full parsed result, so nothing here needs a new RPC.
 */

export type LiveActionStatus = 'error' | 'ok' | 'running'

export interface LiveAction {
  id: string
  tool: string
  /** What the call acted on, as the user would type it: the shell command,
   *  the file path, the search query, the URL. '' when the tool has no
   *  single target (then `input` carries the full args). */
  target: string
  /** Raw args when `target` does not already say everything. */
  input: string
  /** Raw output text, untruncated. '' while running or when the tool
   *  returned nothing. */
  output: string
  exitCode: null | number
  status: LiveActionStatus
  /** Seconds since epoch (the part timestamps' unit). */
  startedAt: number
  completedAt: null | number
}

type ToolCallPart = Extract<ChatMessagePart, { type: 'tool-call' }>

/** The arg that names a call's target, per tool family, most specific first.
 *  Data, not a switch: a tool not listed falls through to its raw args. */
const TARGET_KEYS: readonly string[] = ['command', 'path', 'file_path', 'query', 'url', 'pattern', 'name', 'goal']

const SHELL_TOOLS = new Set(['terminal', 'process', 'execute_code'])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const text = value.trim()

  if (!(text.startsWith('{') || text.startsWith('['))) {
    return value
  }

  try {
    return JSON.parse(text)
  } catch {
    return value
  }
}

function pretty(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function targetOf(args: Record<string, unknown> | null): { key: string; value: string } | null {
  if (!args) {
    return null
  }

  for (const key of TARGET_KEYS) {
    const value = args[key]

    if (typeof value === 'string' && value.trim()) {
      return { key, value: value.trim() }
    }
  }

  return null
}

/** A shell result is `{output, exit_code, error}`; show the stream the
 *  command printed, then the error text if the tool added one. Other tools
 *  show their whole result, pretty-printed, so nothing is hidden. */
function outputOf(tool: string, result: unknown): { exitCode: null | number; text: string } {
  const value = parsed(result)
  const body = record(value)

  if (body && SHELL_TOOLS.has(tool) && ('output' in body || 'exit_code' in body)) {
    const exitCode = typeof body.exit_code === 'number' ? body.exit_code : null
    const output = typeof body.output === 'string' ? body.output : pretty(body.output)
    const error = typeof body.error === 'string' && body.error.trim() ? body.error : ''

    return { exitCode, text: [output, error].filter(Boolean).join(output && error ? '\n' : '') }
  }

  return { exitCode: null, text: pretty(value) }
}

function toAction(part: ToolCallPart, id: string): LiveAction {
  const args = record(parsed(part.args))
  const target = targetOf(args)
  const rest = args && target ? Object.fromEntries(Object.entries(args).filter(([key]) => key !== target.key)) : args
  const done = part.completedAt !== undefined
  const { exitCode, text } = done ? outputOf(part.toolName, part.result) : { exitCode: null, text: '' }
  const failed = Boolean(part.isError) || (exitCode !== null && exitCode !== 0)

  return {
    id,
    tool: part.toolName,
    target: target?.value ?? '',
    input: rest && Object.keys(rest).length ? pretty(rest) : '',
    output: text,
    exitCode,
    status: !done ? 'running' : failed ? 'error' : 'ok',
    startedAt: part.timestamp ?? 0,
    completedAt: done ? (part.completedAt ?? null) : null
  }
}

/** Every tool call across a session's messages, oldest first. A call id seen
 *  twice (a replayed completion, a resealed bubble) keeps its latest state. */
export function deriveLiveActions(messages: readonly ChatMessage[] | undefined): LiveAction[] {
  const byId = new Map<string, LiveAction>()

  for (const message of messages ?? []) {
    message.parts.forEach((part, index) => {
      if (part.type === 'tool-call') {
        const id = part.toolCallId || `${message.id}:${index}`

        byId.set(id, toAction(part as ToolCallPart, id))
      }
    })
  }

  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt)
}
