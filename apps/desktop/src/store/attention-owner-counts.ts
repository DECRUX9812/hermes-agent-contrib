/**
 * Attention counts keyed by SESSION OWNER — the projection surfaces like the
 * Bot Mode roster badge read.
 *
 * Attribution follows the session's PROVEN owner (title stamp, resume hint,
 * tile binding, runtime scope — the `knownOwnerForSession` ladder), never the
 * ambient gateway: two connections can both expose a profile named `ops`, and
 * only the owner decides which one the count belongs to.
 *
 * The input has two legs:
 *  - attention-inbox items, counted under their session's owner;
 *  - stored ids whose status dot claims 'unread' or 'needs-input' — the
 *    quiet-attention half: a finished turn that wrote and was never opened,
 *    or a wait the inbox did not itemize. One conversation counts once even
 *    when a compression lineage publishes the claim under several ids, and a
 *    needs-input the inbox already itemized is not counted twice.
 *
 * Scope-key shapes mirror `registryBackendScopeKey`: `conn:<id>::<profile>`
 * for connection-tagged owners (an explicit `local` stays explicit so legacy
 * callers cannot collapse it into the bare name), the bare profile for
 * connection-free routes. Consumers probe both keys — the ambient local row
 * and a remote's own row both land under a key their bot can ask for.
 */

import { registryBackendScopeKey } from '@hermes/shared'
import { computed } from 'nanostores'

import { $attentionItems, type AttentionItem } from './attention-inbox'
import { normalizeProfileKey } from './profile'
import { $sessions, lineageAliases } from './session'
import { $sessionDotStateById, type SessionDotState } from './session-dot-state'
import { isSessionOwnerRoute, type SessionOwnerScope } from './session-request-router'
import { knownOwnerForSession, storedSessionIdForRuntimeId } from './session-states-routing'

export function ownerScopeKey(owner: SessionOwnerScope): null | string {
  if (owner == null) {
    return null
  }

  if (typeof owner === 'string') {
    return normalizeProfileKey(owner) || null
  }

  if (!isSessionOwnerRoute(owner)) {
    return null
  }

  const connectionId = String(owner.connectionId || '').trim()
  const profile = normalizeProfileKey(owner.targetProfile || owner.profile) || 'default'

  return connectionId ? registryBackendScopeKey(connectionId, profile) : profile
}

export interface AttentionCountSources {
  dotById: Readonly<Record<string, SessionDotState>>
  items: readonly AttentionItem[]
  resolveOwner: (sessionId: string) => SessionOwnerScope
  /** `lineageAliases` input shape — `SessionInfo[]` at runtime; the test
   *  surface keys the three fields it reads. */
  sessions: readonly { _lineage_ids?: null | string[]; _lineage_root_id?: null | string; id: string }[]
  storedIdForRuntime: (sessionId: string) => null | string | undefined
}

export function collectAttentionCounts({
  dotById,
  items,
  resolveOwner,
  sessions,
  storedIdForRuntime
}: AttentionCountSources): Record<string, number> {
  const counts: Record<string, number> = {}
  // Stored-lineage keys a needs-input dot is already itemized for — the inbox
  // row and the dot are the same wait, not two.
  const itemizedNeedsInput = new Set<string>()
  // One conversation counts once: every compression lineage alias publishes
  // the same dot claim, so count the first alias of a lineage seen.
  const seenLineages = new Set<string>()

  for (const item of items) {
    if (!item.sessionId) {
      continue
    }

    const key = ownerScopeKey(resolveOwner(item.sessionId))

    if (key) {
      counts[key] = (counts[key] || 0) + 1
    }

    const storedId = storedIdForRuntime(item.sessionId)

    if (storedId) {
      for (const alias of lineageAliases(storedId, sessions)) {
        itemizedNeedsInput.add(alias)
      }
    }
  }

  for (const [storedId, dot] of Object.entries(dotById)) {
    if (dot !== 'unread' && dot !== 'needs-input') {
      continue
    }

    const aliases = lineageAliases(storedId, sessions)

    if (dot === 'needs-input' && aliases.some(alias => itemizedNeedsInput.has(alias))) {
      continue
    }

    if (aliases.some(alias => seenLineages.has(alias))) {
      continue
    }

    for (const alias of aliases) {
      seenLineages.add(alias)
    }

    const key = ownerScopeKey(resolveOwner(storedId))

    if (key) {
      counts[key] = (counts[key] || 0) + 1
    }
  }

  return counts
}

export const $attentionCountsByOwner = computed(
  [$attentionItems, $sessionDotStateById, $sessions],
  (items, dotById, sessions) =>
    collectAttentionCounts({
      dotById,
      items,
      resolveOwner: knownOwnerForSession,
      sessions,
      storedIdForRuntime: storedSessionIdForRuntimeId
    })
)
