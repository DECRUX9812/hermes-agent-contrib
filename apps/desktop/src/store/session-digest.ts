import { computed } from 'nanostores'

import type { ClientSessionState } from '@/app/types'
import { isToolCallPart, summarizeToolRun, toolPresentVerb } from '@/components/assistant-ui/tool/run-summary'
import { translateNow } from '@/i18n'
import { chatMessageText } from '@/lib/chat-messages/parts'
import { stableRecord } from '@/lib/stable-array'
import { type TodoItem } from '@/lib/todos'
import { isCardTool, isFileEditTool, isSilentTool } from '@/lib/tool-render-class'

import { $clarifyRequests, type ClarifyRequest } from './clarify'
import { $compactingSessions } from './compaction'
import { $backgroundStatusBySession, type ComposerStatusItem } from './composer-status'
import { $approvalRequests, type ApprovalRequest } from './prompts'
import { $providerWaitSessions, providerWaitText } from './provider-wait'
import { $sessions, lineageAliases } from './session'
import { $sessionDotStateById, type SessionDotState } from './session-dot-state'
import { $sessionStates } from './session-states'
import { $subagentsBySession, type SubagentProgress } from './subagents'
import { $todosBySession } from './todos'
import { $draftingToolSessions, type DraftingTool } from './tool-drafting'

/**
 * The one-line "what it's doing now" digest the session rail paints under a
 * row's title — the renderer-only counterpart of a live status readout. Every
 * input is an existing store the sidebar already maintains; nothing here
 * fetches or subscribes to anything new.
 *
 * The digest answers three questions per dot state, in order:
 *   needs-input → what it is waiting on (the question, the command to approve)
 *   working/stalled/background → the current action (compaction, provider wait,
 *     tool being drafted, running subagent, pending tool call, background
 *     process, current plan step) or a plain running label
 *   unread → the last assistant text the user has not seen
 * Idle and draft rows get `null` — with nothing to say, the row keeps its
 * usual metadata/preview line instead of placeholder noise.
 */

export interface SessionDigestSources {
  approval?: ApprovalRequest
  background?: readonly ComposerStatusItem[]
  clarify?: ClarifyRequest
  compacting?: boolean
  drafting?: DraftingTool
  providerWait?: string
  state?: ClientSessionState
  subagents?: readonly SubagentProgress[]
  todos?: readonly TodoItem[]
}

const oneLine = (value: null | string | undefined): string => value?.replace(/\s+/g, ' ').trim() ?? ''

// A run summary only narrates ephemeral activity — card tools render their own
// surface in the transcript. File edits are the exception worth keeping in the
// digest: "Editing wiring.tsx" is exactly the glance a run line exists for.
const digestable = (toolName: string) => !isSilentTool(toolName) && (!isCardTool(toolName) || isFileEditTool(toolName))

const pendingTool = (tool: { completedAt?: number; result?: unknown }) =>
  tool.result === undefined && tool.completedAt === undefined

/** What the live turn is doing — shared by working and stalled rows. */
function liveDigest(dot: SessionDotState, src: SessionDigestSources): string {
  if (src.compacting) {
    return translateNow('sidebar.row.digest.compacting')
  }

  const wait = providerWaitText(src.providerWait ?? '')

  if (wait) {
    return wait
  }

  if (src.drafting) {
    return toolPresentVerb(src.drafting.name)
  }

  const running = (src.subagents ?? []).filter(s => s.status === 'running' || s.status === 'queued')

  if (running.length > 1) {
    return translateNow('sidebar.row.digest.agents', running.length)
  }

  if (running.length === 1) {
    const sub = running[0]!

    return oneLine(sub.stream.at(-1)?.text) || oneLine(sub.goal) || translateNow('sidebar.row.digest.agents', 1)
  }

  const last = src.state?.messages.at(-1)

  if (last?.role === 'assistant') {
    const tools = last.parts.filter(isToolCallPart).filter(part => digestable(part.toolName))

    if (tools.some(pendingTool)) {
      return summarizeToolRun(tools, true)
    }

    if (last.pending && chatMessageText(last).trim()) {
      return translateNow('sidebar.row.digest.replying')
    }

    if (tools.length && src.state?.busy) {
      return summarizeToolRun(tools, false)
    }
  }

  const proc = src.background?.find(item => item.state === 'running')

  if (proc) {
    return oneLine(proc.title) || translateNow('sidebar.row.backgroundRunning')
  }

  // Same denominator as the row's "3/7" plan chip: cancelled items don't count.
  const counted = src.todos?.filter(todo => todo.status !== 'cancelled') ?? []
  const current = counted.find(todo => todo.status === 'in_progress')

  if (current) {
    const done = counted.filter(todo => todo.status === 'completed').length

    return translateNow('sidebar.row.digest.todo', done, counted.length, oneLine(current.content))
  }

  if (dot === 'stalled') {
    return translateNow('sidebar.row.digest.stalled')
  }

  return dot === 'background'
    ? translateNow('sidebar.row.backgroundRunning')
    : translateNow('sidebar.row.sessionRunning')
}

/** The digest for one session, or `null` when the row has nothing to say. */
export function deriveSessionDigest(dot: SessionDotState, src: SessionDigestSources): null | string {
  if (dot === 'needs-input') {
    const question = oneLine(src.clarify?.questions?.[0]?.question) || oneLine(src.clarify?.question)

    if (question) {
      return question
    }

    const command = oneLine(src.approval?.command) || oneLine(src.approval?.description)

    return command ? translateNow('sidebar.row.digest.approve', command) : translateNow('sidebar.row.waitingForAnswer')
  }

  if (dot === 'working' || dot === 'stalled' || dot === 'background') {
    return liveDigest(dot, src)
  }

  if (dot === 'unread') {
    const last = src.state?.messages.findLast(message => message.role === 'assistant')
    const text = last ? oneLine(chatMessageText(last)) : ''

    return text || translateNow('sidebar.row.finishedUnread')
  }

  return null
}

const EMPTY_LIST: readonly never[] = []

let prevDigests: Readonly<Record<string, string>> = {}

/**
 * Stored-id → digest text for every session the dot state considers live or
 * notable. All the per-session activity sources are keyed by RUNTIME id while
 * rows key on the STORED id, so the same bridge the working/attention
 * projections use applies here too: `states[runtimeId].storedSessionId`, then
 * `lineageAliases` covers whichever tip of that conversation the row holds.
 *
 * `stableRecord` keeps the previous map when no digest actually changed, so a
 * stream tick repaints only the rows whose line moved.
 */
export const $sessionDigestById = computed(
  [
    $sessionDotStateById,
    $sessionStates,
    $sessions,
    $clarifyRequests,
    $approvalRequests,
    $draftingToolSessions,
    $providerWaitSessions,
    $compactingSessions,
    $subagentsBySession,
    $backgroundStatusBySession,
    $todosBySession
  ],
  (dotStates, states, sessions, clarifies, approvals, drafting, waits, compacting, subagents, background, todos) => {
    // Stored id → runtime id. A fresh chat not yet persisted keys everything
    // by its runtime id, which the dot state claims as the id — so a key that
    // resolves to itself is the runtime id already.
    const runtimeByStored = new Map<string, string>()

    for (const [runtimeId, state] of Object.entries(states)) {
      runtimeByStored.set(state.storedSessionId ?? runtimeId, runtimeId)
    }

    const next: Record<string, string> = {}

    for (const [storedId, dot] of Object.entries(dotStates)) {
      const runtimeId = runtimeByStored.get(storedId) ?? storedId

      const digest = deriveSessionDigest(dot, {
        approval: approvals[runtimeId],
        background: background[runtimeId] ?? EMPTY_LIST,
        clarify: clarifies[runtimeId],
        compacting: compacting[runtimeId] === true,
        drafting: drafting[runtimeId],
        providerWait: waits[runtimeId],
        state: states[runtimeId],
        subagents: subagents[runtimeId] ?? EMPTY_LIST,
        todos: todos[runtimeId] ?? EMPTY_LIST
      })

      if (digest) {
        for (const alias of lineageAliases(storedId, sessions)) {
          next[alias] = digest
        }
      }
    }

    return (prevDigests = stableRecord(prevDigests, next))
  }
)
