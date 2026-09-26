import type {
  DesktopConnectionKind,
  DesktopConnectionsRegistry,
  DesktopRegistryConnection
} from '@/global'

import { connectionEndpoint } from './connection-display'

/**
 * Cross-device session handoff (#50): a `hermes://session/open?…` deep link
 * (or its QR form) that re-homes a session VIEW to another Hermes device.
 *
 * The session's home never moves — it lives in its home backend's state.db.
 * The link carries just enough for a receiving device to find ITS OWN
 * registered connection to the same backend (`install`, the /api/status
 * install_id, is the strongest fingerprint: it matches the same physical
 * backend even when the two devices reach it through different addresses)
 * and the stored session id + profile to open. Credentials never ride the
 * link — a device without a matching connection gets a pointer to add one.
 */

export interface SessionOpenLink {
  /** Stored (durable) session id — the only id a fresh device can resolve. */
  sessionId: string
  /** Desktop profile the session belongs to (empty = the link carries none). */
  profile?: string
  /** Display hint only — never trusted for routing or identity. */
  title?: string
  /** /api/status install_id of the session's home backend, when known. */
  install?: string
  kind?: DesktopConnectionKind
  /** `connectionEndpoint()` of the session's home connection, when it has one. */
  addr?: string
}

/** Params that survived `resolveDeepLinkAction` (all strings, untrusted). */
export interface SessionOpenLinkParams {
  id: string
  profile?: string
  title?: string
  install?: string
  kind?: string
  addr?: string
}

export const SESSION_OPEN_LINK_NAME = 'open'

/** Build the shareable `hermes://session/open?…` URL for a stored session. */
export function buildSessionOpenLink(
  session: { id: string; profile?: string; title?: string },
  connection: DesktopRegistryConnection | undefined
): string {
  const params = new URLSearchParams()

  params.set('id', session.id)

  if (session.profile?.trim()) {
    params.set('profile', session.profile.trim())
  }

  if (session.title?.trim()) {
    params.set('title', session.title.trim())
  }

  if (connection) {
    if (connection.installId?.trim()) {
      params.set('install', connection.installId.trim())
    }

    params.set('kind', connection.kind)
    const addr = connectionEndpoint(connection)

    if (addr) {
      params.set('addr', addr)
    }
  }

  return `hermes://session/${SESSION_OPEN_LINK_NAME}?${params.toString()}`
}

/** Case/scheme-insensitive endpoint compare; remote URLs drop a trailing slash. */
export function normalizeLinkAddress(addr: string): string {
  const value = addr.trim().toLowerCase()

  return value.endsWith('/') && value.includes('://') ? value.slice(0, -1) : value
}

/**
 * Resolve which registered connection on THIS device reaches the session's
 * home backend. Ladder: install_id (same physical backend, any address) →
 * same-kind endpoint match → a `local` link matches the local connection
 * outright (one local backend per machine). Returns undefined when nothing
 * matches — the caller offers the connection-add path.
 */
export function resolveSessionOpenLinkConnection(
  registry: DesktopConnectionsRegistry | null | undefined,
  link: SessionOpenLinkParams
): DesktopRegistryConnection | undefined {
  const connections = registry?.connections ?? []

  if (connections.length === 0) {
    return undefined
  }

  const install = (link.install ?? '').trim()

  if (install) {
    const byInstall = connections.find(connection => connection.installId?.trim() === install)

    if (byInstall) {
      return byInstall
    }
  }

  const kind = (link.kind ?? '').trim() as DesktopConnectionKind
  const addr = normalizeLinkAddress(link.addr ?? '')

  if (addr) {
    const byAddress = connections.find(
      connection =>
        connection.kind === kind &&
        Boolean(connectionEndpoint(connection)) &&
        normalizeLinkAddress(connectionEndpoint(connection) ?? '') === addr
    )

    if (byAddress) {
      return byAddress
    }
  }

  // No address on the link (a local session): only a local connection can host it.
  if (kind === 'local') {
    return connections.find(connection => connection.kind === 'local')
  }

  return undefined
}
