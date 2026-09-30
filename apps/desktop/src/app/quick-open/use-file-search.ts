import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { type QuickOpenItem, quickOpenItems } from '@/lib/quick-open'
import { $gateway } from '@/store/gateway'
import { $activeSessionId } from '@/store/session'

/** Keystroke pause before asking the backend (it walks the repo per call). */
const SEARCH_DEBOUNCE_MS = 70

interface CompletionResponse {
  items?: { text?: string }[]
}

/** Ask the backend's fuzzy path search — the composer's `@file:` search, so it
 *  answers for local, SSH and remote projects alike. Latest query wins. */
export function useFileSearch(query: string, cwd: string): { items: QuickOpenItem[]; loading: boolean } {
  const gateway = useStore($gateway)
  const sessionId = useStore($activeSessionId)

  const [state, setState] = useState<{ items: QuickOpenItem[]; loading: boolean; query: string }>({
    items: [],
    loading: false,
    query: ''
  })

  useEffect(() => {
    if (!query || !cwd || !gateway) {
      return
    }

    let live = true

    const timer = window.setTimeout(() => {
      setState(prev => ({ ...prev, loading: true }))
      gateway
        .request<CompletionResponse>('complete.path', { cwd, session_id: sessionId ?? '', word: `@file:${query}` })
        .then(response => live && setState({ items: quickOpenItems(response?.items ?? []), loading: false, query }))
        .catch(() => live && setState({ items: [], loading: false, query }))
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [cwd, gateway, query, sessionId])

  return query ? { items: state.query === query ? state.items : [], loading: state.loading || state.query !== query } : { items: [], loading: false }
}

