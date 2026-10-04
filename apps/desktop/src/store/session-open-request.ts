import { atom } from 'nanostores'

import type { DesktopRegistryConnection } from '@/global'

/**
 * Inbound `hermes://session/open?…` deep link awaiting user intent (#50).
 * Set when the link's home backend resolves to a connection other than the
 * active one (a whole-window switch needs an explicit yes) or to nothing at
 * all (the device must register the connection first). An already-current
 * target opens directly and never lands here.
 */
export interface SessionOpenRequest {
  /** Stored session id to open. */
  sessionId: string
  /** Profile the session belongs to on its home backend. */
  profile?: string
  /** Display-only session title carried by the link. */
  title?: string
  /** Registered connection that reaches the home backend; absent when none matches. */
  connection?: DesktopRegistryConnection
  /** The endpoint the link claimed, for the "add this connection" hint. */
  endpoint?: string
}

export const $sessionOpenRequest = atom<SessionOpenRequest | null>(null)

export function requestSessionOpen(request: SessionOpenRequest): void {
  $sessionOpenRequest.set(request)
}

export function closeSessionOpenRequest(): void {
  $sessionOpenRequest.set(null)
}
