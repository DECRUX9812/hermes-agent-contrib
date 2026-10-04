// Session scope for the review pane (roadmap #28): which files the scoped
// session's file-edit tool calls touched, normalized to repo-relative paths so
// they can join the git working-tree list (the source of truth for +/-/status).
//
// Unlike the transcript's changed-files card — which prices a single turn —
// this answers "everything this conversation touched", so it deliberately
// counts a call by the path it named even when no inline diff persisted
// (failed edits, reverted edits, files whose change already committed). Git's
// list then decides which of those still differ.

import { fileEditPath, isFileEditTool, parseMaybeObject } from '@/components/assistant-ui/tool/fallback-model'
import { getAllSessionMessages } from '@/hermes'
import type { ChatMessage } from '@/lib/chat-messages'
import { toChatMessages } from '@/lib/chat-messages/hydration'
import { toolResultRecord } from '@/lib/tool-result-metadata'

import { $selectedStoredSessionId, $sessions, lineageAliases, sessionMatchesStoredId } from './session'
import { $sessionStates } from './session-states'

/** Every path a file-edit tool call named in `messages`, in first-touched
 *  order. The path is read from the call's args first (a failed or
 *  diff-less result still reports what the agent meant to touch), then the
 *  result payload, then any persisted inline diff header. */
export function collectSessionEditPaths(messages: readonly ChatMessage[]): string[] {
  const paths = new Set<string>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool-call' || typeof part.toolName !== 'string' || !isFileEditTool(part.toolName)) {
        continue
      }

      const path = fileEditPath(parseMaybeObject(part.args), toolResultRecord(part))

      if (path) {
        paths.add(path)
      }
    }
  }

  return [...paths]
}

/** Normalize a tool-reported path into repo-relative form. Returns null for
 *  anything outside `cwd` (absolute elsewhere, home-relative) — the git
 *  review bridge only diffs paths inside the repo. */
export function toRepoRelativePath(path: string, cwd: string): null | string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '').trim()
  const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '')

  if (!normalized) {
    return null
  }

  if (base && normalized.startsWith(`${base}/`)) {
    return normalized.slice(base.length + 1) || null
  }

  // Absolute (POSIX or Windows) or ~-anchored but not under the repo.
  if (/^([a-zA-Z]:|\/|~)/.test(normalized)) {
    return null
  }

  return normalized.replace(/^\.\//, '') || null
}

/** The durable session id a review pane composer target refers to: tile
 *  scopes carry their stored id, 'main' is whatever chat is selected. Shared
 *  by every session-scoped review feature (session diff, agent review,
 *  comment seeding) so they can never disagree about whose session it is. */
export function sessionIdForReviewTarget(target: string): null | string {
  const trimmed = target.trim()

  if (trimmed.startsWith('tile:')) {
    return trimmed.slice('tile:'.length).trim() || null
  }

  return $selectedStoredSessionId.get()
}

/** The mounted slice's messages when this session is live in a tile or the
 *  foreground view — cheaper and fresher than a backend re-read, and the only
 *  source that covers a running session's in-flight edits. */
function mountedMessages(storedId: string): ChatMessage[] | null {
  const aliases = new Set(lineageAliases(storedId, $sessions.get()))

  for (const state of Object.values($sessionStates.get())) {
    if (state?.storedSessionId && aliases.has(state.storedSessionId) && state.messages.length > 0) {
      return state.messages
    }
  }

  return null
}

// A persisted transcript is paged + hydrated per read — too heavy to rescan on
// every workspace edge. The derived path set is cached per stored id; an
// explicit refresh (refresh button, scope entry) passes `rescan` to re-read.
// A mounted slice always wins: it moves live while the session streams.
const persistedPathsCache = new Map<string, string[]>()

function repoRelativePaths(paths: readonly string[], cwd: string): string[] {
  const out: string[] = []

  for (const path of paths) {
    const rel = toRepoRelativePath(path, cwd)

    if (rel) {
      out.push(rel)
    }
  }

  return [...new Set(out)]
}

/** Repo-relative paths `storedId`'s session touched, in first-touched order. */
export async function sessionTouchedPaths(
  cwd: string,
  storedId: string,
  { rescan = false }: { rescan?: boolean } = {}
): Promise<string[]> {
  const live = mountedMessages(storedId)

  if (live) {
    return repoRelativePaths(collectSessionEditPaths(live), cwd)
  }

  const cached = persistedPathsCache.get(storedId)

  if (cached && !rescan) {
    return cached
  }

  const session = $sessions.get().find(row => sessionMatchesStoredId(row, storedId))

  try {
    // Route through the session's owning connection + profile — a remote or
    // secondary-profile transcript isn't reachable on the primary socket.
    const { messages } = await getAllSessionMessages(storedId, {
      connectionId: session?.connection_id,
      profile: session?.profile
    })

    const paths = repoRelativePaths(collectSessionEditPaths(toChatMessages(messages)), cwd)

    persistedPathsCache.set(storedId, paths)

    return paths
  } catch {
    // A transcript over the safe-load limit or an unreachable backend keeps the
    // last derivation (or nothing) — session scope degrades, never hard-fails.
    return cached ?? []
  }
}
