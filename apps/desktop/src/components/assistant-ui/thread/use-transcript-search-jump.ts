/**
 * Search-result jumps — a sidebar FTS hit opens the session AND scrolls to
 * the matched stored row. The sidebar arms a pending jump keyed by stored id
 * (store/transcript-find.ts); whichever transcript surface binds that session
 * consumes it here, pages the hit's window in through the reveal machinery
 * (TIMELINE_REVEAL_EVENT → history.revealRow), and scrolls to the
 * materialized element — the same seam the find-in-page history walker uses,
 * so the render budget and use-stick-to-bottom keep sole ownership of the
 * transcript.
 */
import { useStore } from '@nanostores/react'
import { type RefObject, useEffect, useRef } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import {
  $transcriptSearchJumps,
  loadTranscriptFindCorpus,
  locateTranscriptSearchHit,
  takeTranscriptSearchJump,
  transcriptFindTarget,
  type TranscriptFindTarget,
  type TranscriptSearchJump
} from '@/store/transcript-find'

import { TIMELINE_REVEAL_EVENT, type TimelineRevealRequest } from './timeline-data'
import { previousPromptRowId } from './timeline-index'
import { useTranscriptWindow } from './transcript-window'

/** A jump arms at click time and the session may take a beat to open; past
 *  this age the entry is stale context — the user has moved on, drop it. */
const SEARCH_JUMP_TTL_MS = 60_000

interface TranscriptSearchJumpOptions {
  viewport: RefObject<HTMLElement | null>
  sessionKey?: string | null
}

interface JumpState {
  history: ReturnType<typeof useTranscriptWindow>
  view: ReturnType<typeof useSessionView>
}

export function useTranscriptSearchJump(options: TranscriptSearchJumpOptions) {
  const view = useSessionView()
  const history = useTranscriptWindow()
  const jumps = useStore($transcriptSearchJumps)
  const latest = useRef<JumpState>({ history, view })
  latest.current = { history, view }

  useEffect(() => {
    const viewport = options.viewport.current
    const root = viewport?.closest('[data-session-anchor]')
    const target = root ? transcriptFindTarget(root) : null

    if (!viewport || !target) {
      return
    }

    const jump = jumps[target.storedId]

    if (!jump) {
      return
    }

    takeTranscriptSearchJump(target.storedId)

    if (Date.now() - jump.issuedAt > SEARCH_JUMP_TTL_MS) {
      return
    }

    const controller = new AbortController()

    void runTranscriptSearchJump(viewport, target, jump, controller.signal, latest)

    return () => controller.abort()
    // The armed map re-fires this effect for a jump on the session this list
    // shows; sessionKey re-arms it after an open remounts the transcript.
  }, [jumps, options.sessionKey, options.viewport])
}

async function runTranscriptSearchJump(
  viewport: HTMLElement,
  target: TranscriptFindTarget,
  jump: TranscriptSearchJump,
  signal: AbortSignal,
  latest: RefObject<JumpState>
): Promise<void> {
  const corpus = await loadTranscriptFindCorpus(target, signal)

  if (!corpus || signal.aborted) {
    return
  }

  const hit = locateTranscriptSearchHit(corpus.rows, jump)

  if (!hit) {
    return
  }

  const reveal = (rowId: number) =>
    new Promise<false | string>(resolve => {
      const request: TimelineRevealRequest = {
        complete: resolve,
        id: `history:${rowId}`,
        rowId,
        signal
      }

      viewport.dispatchEvent(new CustomEvent(TIMELINE_REVEAL_EVENT, { detail: request }))
    })

  let revealed = await reveal(hit.rowId)

  if (revealed === false && hit.role !== 'user' && !signal.aborted) {
    // /messages/around anchors on user prompts only, so an assistant/tool hit
    // that isn't already materialized pages in its enclosing turn first; the
    // hit's DOM id then resolves from the freshly-revealed window.
    const anchor = await previousPromptRowId(target.storedId, target.scope, hit.rowId)

    if (anchor === null || signal.aborted) {
      return
    }

    if ((await reveal(anchor)) === false) {
      return
    }

    revealed =
      [...(latest.current.history.currentMessages ?? []), ...latest.current.view.$messages.get()].find(
        message => message.rowId === hit.rowId
      )?.id ?? false
  }

  if (!revealed || signal.aborted) {
    return
  }

  const row = viewport.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(revealed)}"]`)

  if (!row) {
    return
  }

  // Manual scrollTop, never scrollIntoView — the same rule the reveal hook
  // follows (interfering layout side-effects on sticky/bottom-pinned rows).
  viewport.scrollTop = row.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - 8
}
