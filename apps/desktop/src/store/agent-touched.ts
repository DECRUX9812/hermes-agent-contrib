import { computed } from 'nanostores'

import { agentTouchedPaths } from '@/lib/agent-touched'

import { $currentCwd } from './session'
import { $focusedSessionState } from './session-states'

const EMPTY = new Set<string>()
let cache: { cwd: string; count: number; lastId: unknown; paths: Set<string> } | null = null

/**
 * Files the focused chat's agent edited. Session state republishes on every
 * streamed token, so this recomputes only when a message is added or the
 * last one changes identity — and hands back the same Set otherwise, so the
 * tree does not re-render per token.
 */
export const $agentTouchedPaths = computed([$focusedSessionState, $currentCwd], (state, cwd) => {
  const messages = state?.messages ?? []

  if (messages.length === 0) {
    cache = null

    return EMPTY
  }

  const settled = messages.filter(message => !message.pending)
  const lastId = settled.at(-1)?.id

  if (cache && cache.cwd === cwd && cache.count === settled.length && cache.lastId === lastId) {
    return cache.paths
  }

  const paths = agentTouchedPaths(settled, cwd)
  cache = { count: settled.length, cwd, lastId, paths }

  return paths
})
