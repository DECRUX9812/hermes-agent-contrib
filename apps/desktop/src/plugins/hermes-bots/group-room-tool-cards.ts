import {
  atom,
  type ChatMessage,
  host,
  type RpcEvent,
  type ToolCardGroup,
  toolCardsFromParts,
  upsertToolPart,
  useValue
} from '@hermes/plugin-sdk'
import { useMemo } from 'react'

type ChatPart = ChatMessage['parts'][number]
type ToolPart = Extract<ChatPart, { type: 'tool-call' }>
type ToolPayload = Parameters<typeof upsertToolPart>[1]

const PARTS_PER_SESSION = 24
const SESSIONS = 32
const APPROVAL_TOOLS = new Set(['execute_code', 'terminal'])
const NO_GROUPS: ToolCardGroup[] = []

/** Tool calls per runtime session id, newest last. */
export const $memberToolParts = atom<Record<string, ToolPart[]>>({})

const isToolCall = (part: ChatPart): part is ToolPart => part.type === 'tool-call'

// Object key order is insertion order, so re-inserting a session moves it to the newest end.
function remember(store: Record<string, ToolPart[]>, sessionId: string, parts: ToolPart[]) {
  const kept = Object.entries(store).filter(([id]) => id !== sessionId)

  kept.push([sessionId, parts])

  return Object.fromEntries(kept.slice(-SESSIONS))
}

export function recordGroupToolEvent(event: RpcEvent): void {
  const sessionId = event.session_id

  if (!sessionId) {
    return
  }

  const store = $memberToolParts.get()

  if (event.type === 'message.start') {
    if (sessionId in store) {
      $memberToolParts.set(Object.fromEntries(Object.entries(store).filter(([id]) => id !== sessionId)))
    }

    return
  }

  const phase = event.type === 'tool.start' ? 'running' : event.type === 'tool.complete' ? 'complete' : null

  if (!phase) {
    return
  }

  const parts = upsertToolPart(store[sessionId] ?? [], event.payload as ToolPayload, phase)
    .filter(isToolCall)
    .slice(-PARTS_PER_SESSION)

  $memberToolParts.set(remember(store, sessionId, parts))
}

/** Tool events land before a room opens, so the tap lives with the plugin, not
 *  the room. Older shells have no host.onEvent and get no live cards. */
export function startGroupToolTap(): () => void {
  if (typeof host.onEvent !== 'function') {
    return () => {}
  }

  const stops = [
    host.onEvent('tool.start', recordGroupToolEvent),
    host.onEvent('tool.complete', recordGroupToolEvent),
    host.onEvent('message.start', recordGroupToolEvent)
  ]

  return () => stops.forEach(stop => stop())
}

const runningApprovalCall = (parts: readonly ToolPart[]): string | undefined =>
  parts.findLast(part => APPROVAL_TOOLS.has(part.toolName) && part.completedAt === undefined)?.toolCallId

export function useMemberToolCards(runtimeId: null | string, approvalPending: boolean): ToolCardGroup[] {
  const store = useValue($memberToolParts)
  const parts = runtimeId ? store[runtimeId] : undefined

  return useMemo(() => {
    if (!parts) {
      return NO_GROUPS
    }

    return toolCardsFromParts(parts, { approvalCallId: approvalPending ? runningApprovalCall(parts) : undefined })
  }, [approvalPending, parts])
}
