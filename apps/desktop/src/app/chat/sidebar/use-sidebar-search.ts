import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { searchSessions, type SessionInfo, type SessionSearchResult } from '@/hermes'
import { $sidebarSearchQuery, SESSION_SEARCH_FOCUS_EVENT, setSidebarSearchQuery } from '@/store/layout'
import { armTranscriptSearchJump } from '@/store/transcript-find'

import { mergeSearchResults } from './sidebar-search'

export interface SidebarSearchOptions {
  sortedSessions: readonly SessionInfo[]
  sessionByAnyId: ReadonlyMap<string, SessionInfo>
  onResumeSession: (sessionId: string, session?: SessionInfo) => void
}

// The sidebar search stack: the query atom + input ref, the debounced FTS
// call covering sessions beyond the loaded page, the client/server merge,
// and the resume path that arms the transcript jump to the matched snippet.
export function useSidebarSearch({ sortedSessions, sessionByAnyId, onResumeSession }: SidebarSearchOptions) {
  // Live search text rides a store atom (`$sidebarSearchQuery`) so a
  // searchable listTop contribution reads the same query.
  const searchQuery = useStore($sidebarSearchQuery)
  const setSearchQuery = setSidebarSearchQuery
  const [serverMatches, setServerMatches] = useState<SessionSearchResult[]>([])
  const [searchPending, setSearchPending] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const trimmedQuery = searchQuery.trim()

  // Hotkey (session.focusSearch) → focus the field once it's mounted.
  useEffect(() => {
    const onFocus = () => searchInputRef.current?.focus({ preventScroll: true })

    window.addEventListener(SESSION_SEARCH_FOCUS_EVENT, onFocus)

    return () => window.removeEventListener(SESSION_SEARCH_FOCUS_EVENT, onFocus)
  }, [])

  // Full-text search across *all* sessions (not just the loaded page) so 699
  // sessions stay findable. Debounced; loaded sessions are matched instantly
  // client-side and merged ahead of the server hits.
  useEffect(() => {
    if (!trimmedQuery) {
      setServerMatches([])
      setSearchPending(false)

      return
    }

    let cancelled = false

    setSearchPending(true)

    const id = window.setTimeout(() => {
      void searchSessions(trimmedQuery)
        .then(res => {
          if (!cancelled) {
            setServerMatches(res.results)
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) {
            setSearchPending(false)
          }
        })
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [trimmedQuery])

  const searchResults = useMemo(
    () => mergeSearchResults(sortedSessions, trimmedQuery, serverMatches, sessionByAnyId, searchPending),
    [sortedSessions, trimmedQuery, serverMatches, sessionByAnyId, searchPending]
  )

  // FTS hits carry the '>>>'-marked snippet that proves the match came from
  // message content (id matches synthesize a plain preview snippet instead) —
  // arm the transcript jump so the opened session scrolls to the hit row.
  const resumeSearchedSession = useCallback(
    (sessionId: string, session?: SessionInfo) => {
      const match = serverMatches.find(m => m.session_id === sessionId)

      if (match?.snippet.includes('>>>')) {
        armTranscriptSearchJump(sessionId, { query: trimmedQuery, snippet: match.snippet })
      }

      onResumeSession(sessionId, session)
    },
    [serverMatches, trimmedQuery, onResumeSession]
  )

  return {
    resumeSearchedSession,
    searchInputRef,
    searchPending,
    searchQuery,
    searchResults,
    setSearchQuery,
    trimmedQuery
  }
}
