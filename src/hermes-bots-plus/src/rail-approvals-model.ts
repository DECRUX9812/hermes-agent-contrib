/** The bot's approval log, read from the hermes-approvals plugin's journal
 *  (`fork.approvals.*`). Core only draws the inline card; the list of what is
 *  waiting and what was decided lives here. */

export type JournalChoice = 'always' | 'deny' | 'once' | 'session'
export type JournalStatus = 'allowed' | 'denied' | 'expired' | 'pending' | 'withdrawn'

export interface JournalRow {
  choice?: JournalChoice | null
  command?: null | string
  created_at?: null | number
  decided_at?: null | number
  description?: null | string
  ran_at?: null | number
  reason?: null | string
  request_id: string
  status: JournalStatus | string
  tool_name?: null | string
}

export interface JournalDecision {
  approval?: JournalRow
  choice: JournalChoice | null
  resolved: boolean
}

type Request = <T>(method: string, params: Record<string, unknown>) => Promise<T>

/** A gateway built before the journal plugin, or with it switched off. */
export function isMissingMethod(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  const message = String((error as { message?: unknown } | null)?.message || '').toLowerCase()

  return code === -32601 || message.includes('method not found') || message.includes('unknown method')
}

/** Rows for one stored session; `null` when this gateway keeps no journal. */
export async function listJournal(request: Request, storedSessionId: string): Promise<JournalRow[] | null> {
  try {
    const res = await request<{ approvals?: JournalRow[] }>('fork.approvals.list', { session_id: storedSessionId })

    return Array.isArray(res?.approvals) ? res.approvals.filter(row => row && row.request_id) : []
  } catch (error) {
    if (isMissingMethod(error)) {
      return null
    }

    throw error
  }
}

/** Answers through the journal, which resolves the live prompt when it still
 *  waits. Without the journal the stock queue RPC takes the same answer. */
export async function decideJournal(
  request: Request,
  ids: { requestId: string; runtimeSessionId: null | string; storedSessionId: string },
  choice: JournalChoice
): Promise<JournalDecision> {
  try {
    const res = await request<{ approval?: JournalRow; resolved?: boolean }>('fork.approvals.decide', {
      choice,
      request_id: ids.requestId,
      session_id: ids.storedSessionId
    })

    return { approval: res?.approval, choice: res?.approval?.choice ?? choice, resolved: Boolean(res?.resolved) }
  } catch (error) {
    if (!isMissingMethod(error) || !ids.runtimeSessionId) {
      throw error
    }

    await request('approval.respond', {
      all: false,
      choice,
      request_id: ids.requestId,
      session_id: ids.runtimeSessionId
    })

    return { choice, resolved: true }
  }
}

export interface JournalView {
  pending: JournalRow[]
  recent: JournalRow[]
}

const RECENT_LIMIT = 5

/** Waiting rows oldest first (answer in the order asked); settled rows newest
 *  first, capped. A row the user just answered may still read pending until
 *  the next list, so `answered` hides it in the meantime. */
export function journalView(rows: readonly JournalRow[], answered: ReadonlySet<string> = new Set()): JournalView {
  const pending = rows.filter(row => row.status === 'pending' && !answered.has(row.request_id))

  const recent = rows
    .filter(row => row.status !== 'pending')
    .sort((a, b) => (b.decided_at ?? b.created_at ?? 0) - (a.decided_at ?? a.created_at ?? 0))
    .slice(0, RECENT_LIMIT)

  return { pending, recent }
}

/** Attention items the journal already covers are not listed twice. */
export function withoutJournalled<T extends { id: string; kind: string }>(
  items: readonly T[],
  rows: readonly JournalRow[] | null
): T[] {
  if (!rows?.length) {
    return [...items]
  }

  const ids = new Set(rows.map(row => row.request_id))

  return items.filter(item => item.kind !== 'approval' || !ids.has(item.id.replace(/^approval:/, '')))
}

export type OutcomeTone = 'bad' | 'muted' | 'ok'

export function outcomeTone(row: JournalRow): OutcomeTone {
  if (row.status === 'allowed') {
    return 'ok'
  }

  return row.status === 'denied' ? 'bad' : 'muted'
}
