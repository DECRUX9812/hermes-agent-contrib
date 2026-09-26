/**
 * Attention inbox — one aggregate of every request currently waiting on the
 * user, across every session on this connection: tool approvals, clarifies,
 * sudo/secret/vault prompts, plus the error notices the agent raised
 * (`$notificationHistory` kind 'error', the recorded spine `agent-notices.ts`
 * feeds).
 *
 * `collectAttentionItems` is pure — it takes the raw store snapshots so the
 * whole mapping is vitest-covered. `$attentionItems` is the live computed
 * view; the inbox overlay and the statusbar count read it.
 *
 * Deep links hand the transcript a one-shot reveal marker
 * (`$pendingAttentionReveal`, keyed by RUNTIME session id — the same id the
 * request maps are keyed under and the id `ThreadMessageList` receives). The
 * list consumes it on mount/update and snaps to the tail, where the waiting
 * card renders.
 */
import { atom, computed } from 'nanostores'

import type { NotificationHistoryEntry } from '@/store/notifications'

import type { ClarifyRequest } from './clarify'
import { $clarifyRequests } from './clarify'
import { $notificationHistory } from './notifications'
import {
  $approvalQueues,
  $secretRequests,
  $sudoRequests,
  $vaultCodeRequests,
  $vaultSaveLoginRequests,
  $vaultUnlockRequests,
  type ApprovalRequest,
  type SecretRequest,
  type SudoRequest,
  type VaultCodeRequest,
  type VaultSaveLoginRequest,
  type VaultUnlockRequest
} from './prompts'

export type AttentionItemKind =
  | 'approval'
  | 'clarify'
  | 'error'
  | 'secret'
  | 'sudo'
  | 'vaultCode'
  | 'vaultSave'
  | 'vaultUnlock'

export interface AttentionItem {
  /** Stable row id: `${kind}:${sessionKey}:${requestId-or-index}`. */
  id: string
  kind: AttentionItemKind
  /** Runtime session id the request is parked under; null when the prompt is
   *  app-level (e.g. a vault unlock raised outside any turn). */
  sessionId: string | null
  /** Primary line — the command, question, or site asking for attention. */
  title: string
  /** Secondary line (description, env var, error detail) when present. */
  detail?: string
}

export interface AttentionSources {
  approvals: Record<string, readonly ApprovalRequest[]>
  clarify: Record<string, ClarifyRequest>
  errors: readonly NotificationHistoryEntry[]
  secrets: Record<string, SecretRequest>
  sudo: Record<string, SudoRequest>
  vaultCode: Record<string, VaultCodeRequest>
  vaultSave: Record<string, VaultSaveLoginRequest>
  vaultUnlock: Record<string, VaultUnlockRequest>
}

const sessionKeyOf = (sessionId: string | null | undefined): string => sessionId ?? ''

/** One row per distinct (session, title, message) error — the history is
 *  already newest-first, so the first sighting wins; a session looping the
 *  same failure should not flood the inbox with identical rows. */
function errorItems(errors: readonly NotificationHistoryEntry[]): AttentionItem[] {
  const seen = new Set<string>()
  const items: AttentionItem[] = []

  for (const entry of errors) {
    if (entry.kind !== 'error' || !entry.sessionId) {
      continue
    }

    const dedupe = `${entry.sessionId}${entry.title ?? ''}${entry.message}`

    if (seen.has(dedupe)) {
      continue
    }

    seen.add(dedupe)

    items.push({
      id: `error:${sessionKeyOf(entry.sessionId)}:${entry.id}`,
      kind: 'error',
      sessionId: entry.sessionId,
      title: entry.title ?? entry.message,
      ...(entry.title ? { detail: entry.message } : {})
    })
  }

  return items
}

/** Flatten every pending request into inbox rows. Pending first, errors last
 *  (an error is a report, not something to answer). */
export function collectAttentionItems(src: AttentionSources): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const [key, queue] of Object.entries(src.approvals)) {
    queue.forEach((request, index) => {
      items.push({
        id: `approval:${key}:${request.requestId ?? index}`,
        kind: 'approval',
        sessionId: request.sessionId,
        title: request.command || request.description,
        ...(request.command && request.description ? { detail: request.description } : {})
      })
    })
  }

  for (const [key, request] of Object.entries(src.clarify)) {
    items.push({
      id: `clarify:${key}:${request.requestId}`,
      kind: 'clarify',
      sessionId: request.sessionId,
      title: request.question,
      ...(request.questions?.length ? { detail: `${request.questions.length} questions` } : {})
    })
  }

  for (const [key, request] of Object.entries(src.sudo)) {
    items.push({
      id: `sudo:${key}:${request.requestId}`,
      kind: 'sudo',
      sessionId: request.sessionId,
      title: request.command || request.description || '',
      ...(request.command && request.description ? { detail: request.description } : {})
    })
  }

  for (const [key, request] of Object.entries(src.secrets)) {
    items.push({
      id: `secret:${key}:${request.requestId}`,
      kind: 'secret',
      sessionId: request.sessionId,
      title: request.prompt || request.envVar,
      ...(request.prompt && request.envVar ? { detail: request.envVar } : {})
    })
  }

  for (const [key, request] of Object.entries(src.vaultUnlock)) {
    items.push({
      id: `vault-unlock:${key}:${request.requestId}`,
      kind: 'vaultUnlock',
      sessionId: request.sessionId,
      title: request.displayName || request.backend
    })
  }

  for (const [key, request] of Object.entries(src.vaultSave)) {
    items.push({
      id: `vault-save:${key}:${request.requestId}`,
      kind: 'vaultSave',
      sessionId: request.sessionId,
      title: request.site || request.origin
    })
  }

  for (const [key, request] of Object.entries(src.vaultCode)) {
    items.push({
      id: `vault-code:${key}:${request.requestId}`,
      kind: 'vaultCode',
      sessionId: request.sessionId,
      title: request.site,
      ...(request.hint ? { detail: request.hint } : {})
    })
  }

  return [...items, ...errorItems(src.errors)]
}

export const $attentionItems = computed(
  [
    $approvalQueues,
    $clarifyRequests,
    $notificationHistory,
    $secretRequests,
    $sudoRequests,
    $vaultCodeRequests,
    $vaultSaveLoginRequests,
    $vaultUnlockRequests
  ],
  (approvals, clarify, errors, secrets, sudo, vaultCode, vaultSave, vaultUnlock) =>
    collectAttentionItems({ approvals, clarify, errors, secrets, sudo, vaultCode, vaultSave, vaultUnlock })
)

/** The statusbar badge count — every row is something waiting on the user. */
export const $attentionItemCount = computed($attentionItems, items => items.length)

// ---------------------------------------------------------------------------
// Deep-link reveal: "open the session scrolled to its card". One-shot — the
// transcript list consumes the marker once it can actually scroll.
// ---------------------------------------------------------------------------

interface PendingReveal {
  at: number
  /** Runtime session id — what request maps and the list's `sessionId` use. */
  sessionId: string
}

export const $pendingAttentionReveal = atom<PendingReveal | null>(null)

export function requestAttentionReveal(sessionId: string): void {
  $pendingAttentionReveal.set({ at: Date.now(), sessionId })
}

/** Consume the marker for `sessionId` — true when a reveal was waiting. */
export function takeAttentionReveal(sessionId: string | null | undefined): boolean {
  const pending = $pendingAttentionReveal.get()

  if (!pending || !sessionId || pending.sessionId !== sessionId) {
    return false
  }

  $pendingAttentionReveal.set(null)

  return true
}
