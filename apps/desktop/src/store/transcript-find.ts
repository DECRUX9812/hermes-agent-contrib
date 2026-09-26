/**
 * Transcript-scoped search — the "Search all history" mode of the find bar.
 *
 * The DOM walker in lib/find-in-page-scope.ts can only see what the render
 * window materialized; a long conversation keeps most of its history outside
 * the DOM. This module adds a read-only search over the session's STORED
 * messages: page the REST transcript once per session, substring-match the
 * flattened text locally, and hand each match's `rowId` back to the caller —
 * materialization and scrolling stay with the reveal machinery
 * (TIMELINE_REVEAL_EVENT → history.revealRow) so the render budget and
 * use-stick-to-bottom keep sole ownership of the transcript.
 *
 * It also owns the sidebar FTS jump: a search-result click arms a pending
 * jump keyed by the session's stored id; whichever transcript surface opens
 * that session consumes it (see use-transcript-search-jump.ts).
 */

import { atom } from 'nanostores'

import type { ProfileScope } from '@/api/client'
import { getSessionMessages } from '@/api/sessions'
import { messageContentText } from '@/components/assistant-ui/thread/content'
import { toChatMessages } from '@/lib/chat-messages'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection, $selectedStoredSessionId, getSessionOwnerHint } from '@/store/session'
import { transcriptTailState } from '@/store/transcript-tail'

/** One stored message reduced to what a find needs: jump address + text. */
export interface TranscriptFindRow {
  rowId: number
  text: string
  /** Message role — the reveal endpoint anchors only on user prompts, so a
   *  hit on any other role resolves the enclosing prompt first. */
  role?: string
}

export interface TranscriptFindTarget {
  storedId: string
  scope: ProfileScope
}

/** One occurrence of the query: the row it lives in and which hit inside it. */
export interface TranscriptFindMatch {
  rowId: number
  occurrence: number
}

/** Matches past the cap are not walked — the counter renders "500+". */
export const TRANSCRIPT_FIND_MATCH_LIMIT = 500

/** History pages are 500 rows; a corpus tops out after this many rows. */
const TRANSCRIPT_FIND_PAGE_SIZE = 500
const TRANSCRIPT_FIND_MAX_MESSAGES = 20_000

interface Corpus {
  key: string
  rows: TranscriptFindRow[]
  /** False when the transcript outgrew the row cap — tail pages won. */
  complete: boolean
  expires: number
}

const CORPUS_TTL = 60_000
const CORPUS_CACHE_MAX = 8

const corpusCache = new Map<string, Corpus>()
const corpusRequests = new Map<string, Promise<Corpus | null>>()

const corpusKey = (storedId: string, scope: ProfileScope) => JSON.stringify([storedId, scope])

/**
 * Resolve the session a captured chat surface is bound to, plus the profile
 * route that owns its state.db. Mirrors `useTimelineHistory`'s owner lookup
 * without a hook: the surface carries `data-session-anchor` (`workspace` for
 * the primary view → the selected stored id; `session-tile:<id>` for tiles).
 */
export function transcriptFindTarget(root: Element): TranscriptFindTarget | null {
  const anchor = root.getAttribute('data-session-anchor')

  let storedId: string | null = null

  if (anchor === 'workspace') {
    storedId = $selectedStoredSessionId.get()
  } else if (anchor?.startsWith('session-tile:')) {
    storedId = anchor.slice('session-tile:'.length) || null
  }

  if (!storedId) {
    return null
  }

  const connection = $connection.get()
  const connectionId = connection?.connectionId || (connection?.mode === 'local' ? 'local' : '')
  const profile = $activeGatewayProfile.get()
  const owner = getSessionOwnerHint(storedId, connectionId ? { connectionId, profile } : undefined)

  const scope: ProfileScope = owner
    ? { connectionId: owner.connectionId, profile: owner.targetProfile || owner.profile }
    : (transcriptTailState(storedId)?.profile ?? { connectionId, profile })

  return { storedId, scope }
}

/**
 * Load the session's stored messages for searching. Pages arrive newest-first
 * (the REST offset counts back from the newest durable row — see
 * app/chat/transcript-backfill.ts), so a capped corpus always covers the tail
 * the user most likely means. Cached per (session, owner) for the TTL so a
 * typing burst never re-reads the transcript.
 */
export function loadTranscriptFindCorpus(
  target: TranscriptFindTarget,
  signal: AbortSignal
): Promise<Corpus | null> {
  const key = corpusKey(target.storedId, target.scope)
  const cached = corpusCache.get(key)

  if (cached && cached.expires > Date.now()) {
    return Promise.resolve(cached)
  }

  const inflight = corpusRequests.get(key)

  if (inflight) {
    return inflight
  }

  const request = (async (): Promise<Corpus | null> => {
    const rows: TranscriptFindRow[] = []
    let offset = 0
    let complete = false

    while (rows.length < TRANSCRIPT_FIND_MAX_MESSAGES) {
      if (signal.aborted) {
        return null
      }

      const page = await getSessionMessages(
        target.storedId,
        target.scope,
        { limit: TRANSCRIPT_FIND_PAGE_SIZE, offset, order: 'latest' },
        { passive: true }
      )

      if (signal.aborted) {
        return null
      }

      const messages = toChatMessages(page.messages)

      for (const message of messages) {
        if (message.rowId === undefined) {
          continue
        }

        const text = messageContentText(message.parts)

        if (text) {
          rows.push({ rowId: message.rowId, role: message.role, text })
        }
      }

      const returned = page.pagination?.returned ?? page.messages.length

      if (returned < TRANSCRIPT_FIND_PAGE_SIZE || messages.length === 0) {
        complete = true

        break
      }

      offset += returned
    }

    // Pages arrive newest-first; navigation counts chronologically.
    rows.sort((a, b) => a.rowId - b.rowId)

    const corpus: Corpus = { key, rows, complete, expires: Date.now() + CORPUS_TTL }

    corpusCache.delete(key)
    corpusCache.set(key, corpus)

    while (corpusCache.size > CORPUS_CACHE_MAX) {
      corpusCache.delete(corpusCache.keys().next().value!)
    }

    return corpus
  })().finally(() => corpusRequests.delete(key))

  corpusRequests.set(key, request)

  return request
}

/**
 * Substring search over a stored transcript corpus — same case-insensitive
 * semantics as the DOM walker. Every match remembers its row and which
 * occurrence within that row it is, so stepping through several hits in one
 * message never re-jumps. Stops at TRANSCRIPT_FIND_MATCH_LIMIT.
 */
export function searchTranscriptRows(
  rows: readonly TranscriptFindRow[],
  query: string
): { capped: boolean; matches: TranscriptFindMatch[] } {
  const needle = query.trim().toLowerCase()

  if (!needle) {
    return { capped: false, matches: [] }
  }

  const matches: TranscriptFindMatch[] = []

  for (const row of rows) {
    const haystack = row.text.toLowerCase()
    let at = haystack.indexOf(needle)
    let occurrence = 0

    while (at !== -1) {
      matches.push({ rowId: row.rowId, occurrence })

      if (matches.length >= TRANSCRIPT_FIND_MATCH_LIMIT) {
        return { capped: true, matches }
      }

      occurrence += 1
      at = haystack.indexOf(needle, at + needle.length)
    }
  }

  return { capped: false, matches }
}

/**
 * A sidebar FTS-result click arms a jump: the transcript surface that opens
 * (or already shows) that session consumes the entry and scrolls to the hit
 * row. Keyed by the stored id the resume targets so the click and whichever
 * surface renders the transcript agree on the session.
 */
export interface TranscriptSearchJump {
  query: string
  snippet: string
  issuedAt: number
}

export const $transcriptSearchJumps = atom<Record<string, TranscriptSearchJump>>({})

export function armTranscriptSearchJump(storedId: string, jump: { query: string; snippet: string }): void {
  $transcriptSearchJumps.set({
    ...$transcriptSearchJumps.get(),
    [storedId]: { ...jump, issuedAt: Date.now() }
  })
}

export function takeTranscriptSearchJump(storedId: string): TranscriptSearchJump | null {
  const jump = $transcriptSearchJumps.get()[storedId]

  if (!jump) {
    return null
  }

  const next = { ...$transcriptSearchJumps.get() }
  delete next[storedId]
  $transcriptSearchJumps.set(next)

  return jump
}

/**
 * Locate the stored row a server FTS hit came from. Backend snippets wrap
 * matched terms in literal '>>>'/'<<<' markers (sqlite snippet() delimiters —
 * see hermes_state_search.py), so the row the snippet describes is the one
 * holding the most marked terms; first row wins a tie since corpus order is
 * chronological and the backend ranks its best hit per session. Falls back to
 * a plain query substring when the snippet carries no markers.
 */
export function locateTranscriptSearchHit(
  rows: readonly TranscriptFindRow[],
  jump: { query: string; snippet: string }
): TranscriptFindRow | null {
  const terms = new Set<string>()

  for (const match of jump.snippet.matchAll(/>>>(.*?)<<</gs)) {
    if (match[1]) {
      terms.add(match[1].toLowerCase())
    }
  }

  if (terms.size) {
    let best: TranscriptFindRow | null = null
    let bestScore = 0

    for (const row of rows) {
      const text = row.text.toLowerCase()
      let score = 0

      for (const term of terms) {
        if (term && text.includes(term)) {
          score += 1
        }
      }

      if (score > bestScore) {
        bestScore = score
        best = row
      }
    }

    if (best) {
      return best
    }
  }

  const needle = jump.query.trim().toLowerCase()

  if (needle) {
    for (const row of rows) {
      if (row.text.toLowerCase().includes(needle)) {
        return row
      }
    }
  }

  return null
}

/** Test seam: drop every cached corpus so one case's read can't bleed over. */
export function resetTranscriptFindForTest(): void {
  corpusCache.clear()
  $transcriptSearchJumps.set({})
}
