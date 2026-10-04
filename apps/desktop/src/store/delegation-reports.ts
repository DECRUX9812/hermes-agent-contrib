import type { DelegationReport, DelegationReportsResult } from '@hermes/shared'
import { atom } from 'nanostores'

import { Codecs, persistentAtom } from '@/lib/persisted'
import { normalizeProfileKey } from '@/store/profile'
import { ambientRequestFor } from '@/store/session-gone-latch'
import { requestForOwnedSession } from '@/store/session-states'

import { $agentReviewReportsBySession, forgetAgentReviewReports } from './agent-review'
import { $gateway } from './gateway'

/**
 * DELEGATION REPORT-BACK CARDS — the durable feed behind the attention fold's
 * report cards (see `app/chat/sidebar/delegation-reports.tsx`). When a
 * background/delegated run settles, `async_delegations` keeps the row; the
 * `delegation.reports` RPC returns it shaped as a card for the session that
 * spawned it.
 *
 * PROFILE SCOPING rides the owner route, not the ambient socket: the RPC is
 * dispatched through `requestForOwnedSession` so a cross-profile session's
 * report lands on the backend that actually ran the delegation. Dismissals
 * are persisted bucketed BY PROFILE (same rule as `session-unread.ts` — the
 * lists routinely mix profiles and identical delegation ids in two homes must
 * not cross-paint).
 *
 * Nothing here opens a window or raises a toast — the card is content inside
 * the existing fold, and dismissing it is the only state it owns.
 */

/** stored session id → settled delegations reported back for it (latest fetch). */
export const $delegationReportsBySession = atom<Record<string, DelegationReport[]>>({})

/** profile key → delegation ids the user has dismissed. */
type Dismissed = Record<string, string[]>

// Dismissals only matter while their card is still relevant; cap per profile
// and evict oldest-first, same as the unread markers.
const DISMISSED_CAP = 200

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function sanitizeDismissed(value: unknown): Dismissed {
  if (!isPlainRecord(value)) {
    return {}
  }

  const next: Dismissed = {}

  for (const [profile, bucket] of Object.entries(value)) {
    if (!Array.isArray(bucket)) {
      continue
    }

    const ids = bucket.filter((id): id is string => typeof id === 'string' && id.length > 0)

    if (ids.length) {
      next[profile] = ids
    }
  }

  return next
}

export const $dismissedDelegationReports = persistentAtom<Dismissed>(
  'hermes.desktop.dismissedDelegationReports',
  {},
  Codecs.json(sanitizeDismissed)
)

/** Reports still worth a card for `sessionId` under `profile` — the row's own
 *  profile, never the live gateway's. */
export function visibleDelegationReports(
  sessionId: string,
  profile: null | string | undefined,
  reports = $delegationReportsBySession.get(),
  dismissed = $dismissedDelegationReports.get()
): DelegationReport[] {
  const hidden = dismissed[normalizeProfileKey(profile)] ?? []

  // Synthesized cards (agent-review.ts) ride the same dismissal buckets — a
  // dismissed review stays dismissed next to its server-reported siblings.
  const all = [...(reports[sessionId] ?? []), ...($agentReviewReportsBySession.get()[sessionId] ?? [])]

  return all.filter(report => !hidden.includes(report.delegation_id))
}

/** Pull the settled-delegation feed for one origin session through its OWN
 *  backend. Best-effort by design: a missing method on an older backend, a
 *  gone session, or an unknown owner all read as "no cards" — never a toast. */
export async function refreshDelegationReports(sessionId: string): Promise<void> {
  const gateway = $gateway.get()

  if (!sessionId || !gateway) {
    return
  }

  try {
    const result = await requestForOwnedSession<DelegationReportsResult>(
      sessionId,
      ambientRequestFor(gateway),
      'delegation.reports',
      { session_id: sessionId }
    )

    $delegationReportsBySession.set({
      ...$delegationReportsBySession.get(),
      [sessionId]: result.reports ?? []
    })
  } catch {
    // Offer-don't-hijack: a backend that predates this RPC (or lost the
    // session) just shows no cards. The next attention-fold refresh retries.
  }
}

/** Dismiss a card permanently for `profile` — survives restarts; same-id
 *  delegations in other profiles keep their cards. */
export function dismissDelegationReport(profile: null | string | undefined, delegationId: string): void {
  if (!delegationId) {
    return
  }

  const key = normalizeProfileKey(profile)
  const dismissed = $dismissedDelegationReports.get()
  const bucket = dismissed[key] ?? []

  if (bucket.includes(delegationId)) {
    return
  }

  const next = [...bucket, delegationId]

  $dismissedDelegationReports.set({
    ...dismissed,
    [key]: next.length > DISMISSED_CAP ? next.slice(next.length - DISMISSED_CAP) : next
  })
}

/** The session id of one delegated worker — the card's "open" target. Picks
 *  the lowest task index so batch cards open their first worker. */
export function reportChildSessionId(report: DelegationReport): null | string {
  const ids = report.child_session_ids

  if (!ids) {
    return null
  }

  const keys = Object.keys(ids).sort((a, b) => Number(a) - Number(b))

  return ids[keys[0] ?? ''] ?? null
}

/** Drop a session's cached feed (session deleted/archived). Dismissals stay —
 *  a same-id delegation can legitimately reappear. */
export function forgetDelegationReports(sessionId: string): void {
  const map = $delegationReportsBySession.get()

  if (!Object.hasOwn(map, sessionId)) {
    return
  }

  const { [sessionId]: _drop, ...rest } = map
  $delegationReportsBySession.set(rest)

  forgetAgentReviewReports(sessionId)
}
