import type { PluginRestOptions } from '@hermes/plugin-sdk'

/**
 * The Ambition plugin's backend namespace (`/api/plugins/ambition`), reached
 * only through the `ctx.rest` door handed to register(). Every value the UI
 * paints comes from these calls — the session mode, the cards and the judge
 * results all live in the plugin's own store on the backend, and the desktop
 * holds only a cache of that truth. There is no local fallback.
 */

export const AMBITION_KEY = 'ambition'

/** The session summary's query key — the one cache entry the chip, the cards
 *  and the judge rows all read and invalidate. */
export const summaryKey = (storedSessionId: string) => [AMBITION_KEY, storedSessionId] as const

/** The card a plugin tool result points at: `ambition_card` and
 *  `ambition_judge` both answer with `card_id`. Null when the result carries
 *  none — a rejected call, or a result this surface cannot read. */
export function cardIdFrom(result: unknown): null | string {
  if (result && typeof result === 'object' && 'card_id' in result) {
    const id = (result as { card_id?: unknown }).card_id

    if (typeof id === 'string' && id !== '') {
      return id
    }
  }

  return null
}

/** The narrow slice of the plugin REST door the Ambition UI uses. */
export interface AmbitionRest {
  <T>(path: string, opts?: PluginRestOptions): Promise<T>
}

interface Bound {
  rest: AmbitionRest | null
}

const bound: Bound = { rest: null }

/** Bind the plugin REST door at register time; the returned disposer unbinds
 *  it on unload/disable so nothing outlives the plugin. */
export function bindAmbitionApi(rest: AmbitionRest): () => void {
  bound.rest = rest

  return () => {
    bound.rest = null
  }
}

function rest<T>(path: string, opts?: PluginRestOptions): Promise<T> {
  if (!bound.rest) {
    return Promise.reject(new Error('Ambition is not loaded'))
  }

  return bound.rest<T>(path, opts)
}

// The host rejects a failed REST call with `Error("<status>: <body>")`; FastAPI
// bodies carry `{"detail": ...}`, which is the text worth showing inline.
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const body = raw.replace(/^\d{3}:\s*/, '')

  try {
    const parsed: unknown = JSON.parse(body)

    if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
      const detail = (parsed as { detail: unknown }).detail

      if (typeof detail === 'string') {
        return detail
      }

      return JSON.stringify(detail)
    }
  } catch {
    // Not JSON: the message itself is the best text available.
  }

  return body || 'Request failed'
}

// ─── Backend shapes (dashboard/plugin_api.py + store.py of the plugin) ────

export type AmbitionField = 'access' | 'altitude' | 'depth' | 'judge' | 'range' | 'target'

/** The five fields every card carries; `access` is optional sixth. */
export const CARD_FIELDS: readonly AmbitionField[] = ['altitude', 'depth', 'range', 'target', 'judge', 'access']

export type AmbitionVerdict = 'fail' | 'inconclusive' | 'pass'

export type AmbitionStatus = 'accepted' | 'declined' | 'edited' | 'proposed'

export interface AmbitionJudgeResult {
  card_id: string
  created_at: string
  evidence: string
  judge: string
  measured: string
  verdict: AmbitionVerdict
}

export interface AmbitionCard {
  created_at: string
  decided_at: null | string
  edited_fields: Record<string, string> | null
  fields: Partial<Record<AmbitionField, string>>
  id: string
  judge: AmbitionJudgeResult | null
  session_id: string
  status: AmbitionStatus
  updated_at: string
  widens_scope: boolean
}

export interface AmbitionSummary {
  cards: AmbitionCard[]
  enabled: boolean
}

// ─── Calls ───

export function fetchSessionSummary(sessionId: string): Promise<AmbitionSummary> {
  return rest<AmbitionSummary>(`/sessions/${encodeURIComponent(sessionId)}`)
}

export function putMode(sessionId: string, enabled: boolean): Promise<{ enabled: boolean; session_id: string }> {
  return rest<{ enabled: boolean; session_id: string }>(`/sessions/${encodeURIComponent(sessionId)}/mode`, {
    body: { enabled },
    method: 'PUT'
  })
}

export function patchCard(cardId: string, fields: Partial<Record<AmbitionField, string>>): Promise<AmbitionCard> {
  return rest<AmbitionCard>(`/cards/${encodeURIComponent(cardId)}`, { body: fields, method: 'PATCH' })
}

export function acceptCard(cardId: string): Promise<AmbitionCard> {
  return rest<AmbitionCard>(`/cards/${encodeURIComponent(cardId)}/accept`, { method: 'POST' })
}

export function declineCard(cardId: string): Promise<AmbitionCard> {
  return rest<AmbitionCard>(`/cards/${encodeURIComponent(cardId)}/decline`, { method: 'POST' })
}
