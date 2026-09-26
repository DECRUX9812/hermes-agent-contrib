// Spoken "what's it doing?" — answered from the session stores, never a model
// call.
//
// In a hands-free voice chat the natural mid-task question is "what's it
// doing?" / "are you done yet?" Sending that as a normal turn would spin up a
// model call whose answer the agent fabricates from its own context — while
// the desktop already KNOWS the answer: the session dot state, the live todo
// list, and the tool the last assistant part is running. This matcher
// recognises a short utterance whose entire content is a status ask (same
// conservative whole-utterance rule as the stop-word matcher, so "check the
// build status when it finishes" still goes through as a real request), and
// `composeSessionStatusSpeech` renders the reply the voice speaks instead of
// submitting a turn.

import type { ChatMessage } from '@/lib/chat-messages'
import type { TodoItem } from '@/lib/todos'
import { normalizeVoiceUtterance, stripVoiceAddress } from '@/lib/voice-stop-word'
import { $sessionDotStateById, type SessionDotState } from '@/store/session-dot-state'
import { $todosBySession } from '@/store/todos'

/** Copy the reply is built from — `t.voiceStatus` in production, literals in tests. */
export interface VoiceStatusCopy {
  /** No turn is running. */
  idle: string
  /** A turn (or background job) is running, no detail worth naming. */
  working: string
  /** A turn is running; `detail` names the in-progress todo or running tool. */
  workingOn: (detail: string) => string
  /** A turn is running but has been quiet a while. */
  stalled: string
  /** A blocking prompt needs the user's answer. */
  needsInput: string
  /** The last turn finished and the reply is unread. */
  finished: string
  /** Task progress tail: "{done} of {total} tasks done." */
  progress: (done: number, total: number) => string
}

/** Whole-utterance status asks. English defaults — other languages still fall
 *  through to a real turn, which is the safe direction. */
const STATUS_QUESTION_PHRASES: readonly string[] = [
  'status',
  'status update',
  'status report',
  'update',
  'update me',
  'give me an update',
  'give me a status update',
  'progress',
  'progress report',
  "what's the status",
  'what is the status',
  "what's happening",
  'what is happening',
  'what are you doing',
  'what is it doing',
  "what's it doing",
  "what's going on",
  'what is going on',
  'what are you up to',
  'what are you working on',
  'where are we',
  'where are you at',
  'how is it going',
  "how's it going",
  'how are we doing',
  'are you done',
  'are you finished',
  'are you still working',
  'still working',
  'is it done',
  'is it finished',
  'did it finish',
  'report status',
  'report progress'
]

const DEFAULT_PHRASES = STATUS_QUESTION_PHRASES.map(normalizeVoiceUtterance)

/**
 * True when the entire spoken utterance is a status question (optionally
 * addressed to Hermes). Mirrors `isVoiceStopCommand`: exact match on the
 * normalized utterance or on the same utterance with an address prefix
 * stripped, so "hey Hermes, what's it doing" counts but "when it's done doing
 * the status update…" does not.
 */
export function isVoiceStatusQuestion(transcript: string): boolean {
  if (!transcript) {
    return false
  }

  const normalized = normalizeVoiceUtterance(transcript)

  if (!normalized) {
    return false
  }

  const candidates = new Set([normalized, stripVoiceAddress(normalized)])

  for (const candidate of candidates) {
    if (DEFAULT_PHRASES.includes(candidate)) {
      return true
    }
  }

  return false
}

/** The tool the active turn is running right now — the same read the
 *  composer's `activeToolLabel` makes — for "it's running X" detail. */
function runningToolName(messages: readonly ChatMessage[]): null | string {
  const last = messages.findLast(m => m.role === 'assistant' && !m.hidden)
  const running = last?.parts.findLast(part => part.type === 'tool-call' && part.result === undefined)

  return running && running.type === 'tool-call' ? running.toolName : null
}

/**
 * The reply for a resolved dot state — pure, so tests drive it without seeding
 * the whole session-state graph.
 */
export function composeStatusSpeech(
  copy: VoiceStatusCopy,
  dot: SessionDotState,
  todos: readonly TodoItem[],
  messages: readonly ChatMessage[]
): string {
  const counted = todos.filter(todo => todo.status !== 'cancelled')
  const active = counted.find(todo => todo.status === 'in_progress')

  const progress = counted.length
    ? ` ${copy.progress(counted.filter(todo => todo.status === 'completed').length, counted.length)}`
    : ''

  switch (dot) {
    case 'working':
    case 'background': {
      const detail = active?.content.trim() || runningToolName(messages)

      return (detail ? copy.workingOn(detail) : copy.working) + progress
    }

    case 'stalled':
      return copy.stalled + progress

    case 'needs-input':
      return copy.needsInput

    case 'unread':
      return copy.finished

    default:
      return copy.idle
  }
}

/**
 * One spoken sentence (or two short ones) describing what the session is
 * doing, composed entirely from stores — no model call, no backend round
 * trip. `sessionId` is the RUNTIME session id (the todo map keys on it; the
 * dot-state map resolves any lineage tip).
 */
export function composeSessionStatusSpeech(
  copy: VoiceStatusCopy,
  sessionId: string,
  messages: readonly ChatMessage[]
): string {
  const dot = $sessionDotStateById.get()[sessionId] ?? 'idle'

  return composeStatusSpeech(copy, dot, $todosBySession.get()[sessionId] ?? [], messages)
}
