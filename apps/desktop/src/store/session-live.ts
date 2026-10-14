/**
 * SESSION LIVE SUMMARY — what one session is doing right now, in the shape the
 * parallel-sessions surfaces paint: the sidebar's live groups and rows, the
 * row's live preview, and the session overview grid. One derivation so those
 * surfaces cannot disagree about a session's group, step or progress.
 *
 * The group folds `$sessionDotStateById` (the same resolved state the dots
 * paint) into the three buckets a person sorts parallel work into:
 * "needs you", "working" and "done".
 */

import { computed, type ReadableAtom } from 'nanostores'

import type { ClientSessionState } from '@/app/types'
import type { ChatMessage } from '@/lib/chat-messages/types'
import { type LiveActionStatus, toLiveAction, type ToolCallPart } from '@/lib/live-actions'
import type { TodoItem } from '@/lib/todos'

import { $sessions, lineageAliases } from './session'
import { $sessionDotStateById, type SessionDotState, sessionStatusBucket } from './session-dot-state'
import { $sessionStates } from './session-states'
import { $retainedTodosBySession, $todosBySession } from './todos'

export type SessionLiveGroup = 'done' | 'needs-you' | 'working'

/** Loudest first: the order the sidebar groups and the overview grid use. */
export const SESSION_LIVE_GROUPS: readonly SessionLiveGroup[] = ['needs-you', 'working', 'done']

export const sessionLiveGroup = (state: SessionDotState = 'idle'): SessionLiveGroup =>
  state === 'needs-input' ? 'needs-you' : sessionStatusBucket(state) === 'working' ? 'working' : 'done'

export interface LiveToolCall {
  id: string
  name: string
  /** What the call acted on (command, path, query, URL); '' when none. */
  target: string
  status: LiveActionStatus
  /** Unix seconds. */
  startedAt: number
}

export interface SessionLiveSummary {
  storedSessionId: string
  runtimeId: null | string
  dotState: SessionDotState
  group: SessionLiveGroup
  /** Epoch ms the live turn started; null unless the session is working. */
  turnStartedAt: null | number
  /** The session's most recent tool call; `status === 'running'` is the current one. */
  tool: LiveToolCall | null
  todos: readonly TodoItem[]
  todoDone: number
  /** Non-cancelled todo items. */
  todoTotal: number
  /** The plan item in progress, if the session keeps a plan. */
  step: null | string
}

// Only recent turns can hold the latest call; capping the walk keeps a long
// tool-free transcript from costing a full scan on every stream delta.
const TOOL_SCAN_MESSAGES = 40

// Parts are replaced, not mutated, when a call updates, so a part's identity
// is a safe cache key and the args JSON is parsed once per call state.
const toolCallCache = new WeakMap<object, LiveToolCall>()

export function latestToolCall(messages: readonly ChatMessage[] | undefined): LiveToolCall | null {
  if (!messages?.length) {
    return null
  }

  const stop = Math.max(0, messages.length - TOOL_SCAN_MESSAGES)

  for (let m = messages.length - 1; m >= stop; m--) {
    const message = messages[m]

    for (let p = message.parts.length - 1; p >= 0; p--) {
      const part = message.parts[p]

      if (part.type !== 'tool-call') {
        continue
      }

      const cached = toolCallCache.get(part)

      if (cached) {
        return cached
      }

      const action = toLiveAction(part as ToolCallPart, (part as ToolCallPart).toolCallId || `${message.id}:${p}`)

      const call: LiveToolCall = {
        id: action.id,
        name: action.tool,
        target: action.target,
        status: action.status,
        startedAt: action.startedAt
      }

      toolCallCache.set(part, call)

      return call
    }
  }

  return null
}

function runtimeIdFor(
  storedSessionId: string,
  states: Readonly<Record<string, ClientSessionState>>,
  aliases: readonly string[]
): null | string {
  if (states[storedSessionId] && !states[storedSessionId].storedSessionId) {
    return storedSessionId
  }

  let match: null | string = null

  for (const [runtimeId, state] of Object.entries(states)) {
    if (state.storedSessionId && aliases.includes(state.storedSessionId)) {
      // A busy runtime outranks a cached idle twin of the same lineage.
      if (state.busy) {
        return runtimeId
      }

      match ??= runtimeId
    }
  }

  return match
}

const EMPTY_TODOS: readonly TodoItem[] = Object.freeze([])

export interface SummarizeInput {
  dotState: SessionDotState
  runtimeId: null | string
  state: ClientSessionState | undefined
  storedSessionId: string
  todos: readonly TodoItem[] | undefined
}

export function summarizeSessionLive({
  dotState,
  runtimeId,
  state,
  storedSessionId,
  todos = EMPTY_TODOS
}: SummarizeInput): SessionLiveSummary {
  const group = sessionLiveGroup(dotState)
  const counted = todos.filter(item => item.status !== 'cancelled')

  return {
    storedSessionId,
    runtimeId,
    dotState,
    group,
    turnStartedAt: group === 'done' ? null : (state?.turnStartedAt ?? null),
    tool: latestToolCall(state?.messages),
    todos,
    todoDone: counted.filter(item => item.status === 'completed').length,
    todoTotal: counted.length,
    step: todos.find(item => item.status === 'in_progress')?.content ?? null
  }
}

function sameSummary(a: SessionLiveSummary, b: SessionLiveSummary): boolean {
  return (
    a.runtimeId === b.runtimeId &&
    a.dotState === b.dotState &&
    a.turnStartedAt === b.turnStartedAt &&
    a.tool === b.tool &&
    a.todos === b.todos &&
    a.step === b.step
  )
}

const summaryStores = new Map<string, ReadableAtom<SessionLiveSummary>>()

/** The live summary for one stored session id (any lineage tip). Cached per
 *  id and reference-stable while nothing it reports has changed, so a row can
 *  subscribe without re-rendering on every stream delta. */
export function sessionLiveSummary(storedSessionId: string): ReadableAtom<SessionLiveSummary> {
  const existing = summaryStores.get(storedSessionId)

  if (existing) {
    return existing
  }

  let previous: null | SessionLiveSummary = null

  const store = computed(
    [$sessionDotStateById, $sessionStates, $todosBySession, $retainedTodosBySession, $sessions],
    (dots, states, liveTodos, retainedTodos, sessions) => {
      const aliases = lineageAliases(storedSessionId, sessions)
      const runtimeId = runtimeIdFor(storedSessionId, states, aliases)

      const next = summarizeSessionLive({
        dotState: dots[storedSessionId] ?? 'idle',
        runtimeId,
        state: runtimeId ? states[runtimeId] : undefined,
        storedSessionId,
        todos: runtimeId ? (liveTodos[runtimeId] ?? retainedTodos[runtimeId]) : undefined
      })

      if (previous && sameSummary(previous, next)) {
        return previous
      }

      return (previous = next)
    }
  )

  summaryStores.set(storedSessionId, store)

  return store
}
