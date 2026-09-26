/**
 * Store-level coverage for transcript-scoped ("all history") find mode:
 * matches come from the session's STORED messages (mocked REST page), and
 * stepping materializes out-of-window rows through the timeline reveal event —
 * never a direct scrollIntoView.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TIMELINE_REVEAL_EVENT, type TimelineRevealRequest } from '@/components/assistant-ui/thread/timeline-data'
import { $selectedStoredSessionId } from '@/store/session'

import {
  $findInPage,
  closeFindBar,
  findNext,
  openFindBar,
  setFindHistoryMode,
  setFindQuery
} from './find-in-page'
import { resetTranscriptFindForTest } from './transcript-find'

const getSessionMessages = vi.fn()

vi.mock('@/api/sessions', async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>()

  return {
    ...original,
    getSessionMessages: (...args: unknown[]) => getSessionMessages(...args)
  }
})

function plantChatSurface(): { root: HTMLElement; viewport: HTMLElement } {
  const root = document.createElement('div')

  root.setAttribute('data-chat-surface', '')
  root.setAttribute('data-session-anchor', 'workspace')
  root.innerHTML = `
    <div data-slot="aui_thread-viewport">
      <div data-message-id="msg-1"><p>needle near the tail</p></div>
    </div>`

  const viewport = root.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!

  // The fake reveal machinery: a listener like use-timeline-reveal's that
  // "materializes" the requested row into the DOM and resolves its id.
  viewport.addEventListener(TIMELINE_REVEAL_EVENT, event => {
    const request = (event as CustomEvent<TimelineRevealRequest>).detail
    const id = `stored-${request.rowId}`

    viewport.insertAdjacentHTML('beforeend', `<div data-message-id="${id}"><p>needle deep needle</p></div>`)
    request.complete(id)
  })

  document.body.appendChild(root)

  return { root, viewport }
}

const MESSAGES_PAGE = {
  session_id: 's1',
  profile: 'default',
  messages: [
    { role: 'user', content: 'needle near the tail', row_id: 1, timestamp: 1 },
    { role: 'assistant', content: 'needle deep needle', row_id: 2, timestamp: 2 }
  ],
  pagination: { limit: 500, offset: 0, order: 'latest' as const, returned: 2 }
}

beforeEach(() => {
  document.body.innerHTML = ''
  $selectedStoredSessionId.set('s1')
  getSessionMessages.mockReset()
  getSessionMessages.mockResolvedValue(MESSAGES_PAGE)
  resetTranscriptFindForTest()
})

afterEach(() => {
  closeFindBar()
})

describe('transcript find mode', () => {
  it('counts stored-history matches, including rows outside the render window', async () => {
    plantChatSurface()
    openFindBar()
    setFindHistoryMode(true)
    await setFindQuery('needle')

    // Three stored matches: one in the rendered tail, two in the stored row
    // that is not yet in the DOM.
    expect($findInPage.get().matchCount).toBe(3)
    expect($findInPage.get().matchOrdinal).toBe(1)
  })

  it('materializes an out-of-window match through the reveal event and marks it', async () => {
    const { root } = plantChatSurface()
    openFindBar()
    setFindHistoryMode(true)
    await setFindQuery('needle')
    await Promise.resolve()

    // Ordinal 1 lands on the in-window row. Stepping reaches the stored row —
    // the fake reveal listener materializes it, then the mark inside it
    // becomes the active hit.
    findNext()
    await vi.waitFor(() => {
      expect(root.querySelector('[data-message-id="stored-2"] mark[data-find-active]')).not.toBeNull()
    })
    expect($findInPage.get().matchOrdinal).toBe(2)
  })

  it('clears history state when the bar closes', async () => {
    plantChatSurface()
    openFindBar()
    setFindHistoryMode(true)
    await setFindQuery('needle')
    closeFindBar()

    expect($findInPage.get().history).toBe(false)
    expect($findInPage.get().matchCount).toBe(0)
  })

  it('falls back to DOM find when the surface has no stored session', async () => {
    $selectedStoredSessionId.set(null)
    const { root } = plantChatSurface()
    openFindBar()
    setFindHistoryMode(true)
    await setFindQuery('needle')

    // The rendered row still counts — the DOM walker is the fallback.
    expect($findInPage.get().matchCount).toBe(1)
    expect(root.querySelector('mark.find-hit')).not.toBeNull()
  })
})
