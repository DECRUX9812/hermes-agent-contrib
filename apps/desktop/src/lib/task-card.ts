import { isToolCallPart, summarizeToolRun } from '@/components/assistant-ui/tool/run-summary'
import type { ChatMessage } from '@/lib/chat-messages'
import { isCardTool, isFileEditTool, isSilentTool } from '@/lib/tool-render-class'

/**
 * What a home-screen task card says about one chat: the last few things the
 * agent did in its latest turn ("Browsing chase.com", "Edited wiring.tsx"),
 * worded exactly like the transcript's own run lines, and when that turn began.
 */

export interface TaskStep {
  label: string
  /** Still running — the card spins this one. */
  live: boolean
}

export const TASK_STEP_LIMIT = 3

// Same filter as the sidebar digest: narrate ephemeral activity and file
// edits, never the silent bookkeeping tools or cards that draw themselves.
const narrated = (toolName: string) => !isSilentTool(toolName) && (!isCardTool(toolName) || isFileEditTool(toolName))

/** Backend stamps are seconds, locally minted ones milliseconds. */
export const stampMs = (value: number | undefined): null | number =>
  value ? (value < 1e12 ? value * 1000 : value) : null

/** The latest turn: everything after the last message the user sent. */
function latestTurn(messages: readonly ChatMessage[]): { start: ChatMessage | null; replies: ChatMessage[] } {
  const lastUser = messages.findLastIndex(message => message.role === 'user')

  return { start: lastUser >= 0 ? messages[lastUser] : null, replies: messages.slice(lastUser + 1) }
}

export function taskSteps(messages: readonly ChatMessage[] | undefined, busy: boolean): TaskStep[] {
  const tools = latestTurn(messages ?? []).replies.flatMap(message =>
    message.role === 'assistant' ? message.parts.filter(isToolCallPart).filter(part => narrated(part.toolName)) : []
  )

  return tools.slice(-TASK_STEP_LIMIT).map(tool => {
    // A call left without a result by a turn that ended reads as done.
    const live = busy && tool.result === undefined && tool.completedAt === undefined

    return { label: summarizeToolRun([tool], live), live }
  })
}

/** When the latest turn began, in ms — the "Working for 9m" anchor. */
export function taskStartedMs(messages: readonly ChatMessage[] | undefined): null | number {
  return stampMs(latestTurn(messages ?? []).start?.timestamp)
}

/** "9m 31s", "1h 4m", "12s" — a running task's age at a glance. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours) {
    return `${hours}h ${minutes}m`
  }

  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`
}
