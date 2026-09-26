/**
 * Backend capabilities — what the backend this window is dialed into can do.
 * One resolver owns the verdict; every caller reads the atom.
 *
 * Today's `hermes serve` backends are POOLED (one process per
 * connection+profile): no canonical session authority, no gap-free replay, no
 * shared controls — a server→client request can only be answered from the
 * surface holding the transport. Upstream's one-gateway cutover
 * (NousResearch/hermes-agent#106742) advertises the canonical answers on
 * `gateway.capabilities`; a backend that doesn't answer those keys IS the
 * pooled verdict — the absence is the answer, so a probe failure and a pooled
 * backend resolve identically and there is no hidden-canonical case.
 */

import { atom } from 'nanostores'

import type { HermesGateway } from '@/hermes'

import { $gateway } from './gateway'

export interface BackendCapabilities {
  /** One gateway owns every local session through the canonical admission
   *  ledger (#106742). false = pooled per-(connection, profile) serves, each
   *  holding its own session registry. */
  canonicalAuthority: boolean
  /** A reconnect can replay a session's event log gap-free from the authority. */
  sessionReplay: boolean
  /** An open server→client request may be answered from any surface watching
   *  the session, not just the transport that raised it. */
  sharedControls: boolean
}

export const POOLED_BACKEND_CAPABILITIES: BackendCapabilities = {
  canonicalAuthority: false,
  sessionReplay: false,
  sharedControls: false
}

export const $backendCapabilities = atom<BackendCapabilities>({ ...POOLED_BACKEND_CAPABILITIES })

type CapabilityRequester = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

/** Resolve against one backend and publish the verdict. The requester is the
 *  only seam a test (or a non-active gateway probe) needs; everything else is
 *  pure decode. */
export async function resolveBackendCapabilities(
  request: CapabilityRequester
): Promise<BackendCapabilities> {
  try {
    const advertised = await request<Record<string, unknown>>('gateway.capabilities', {})

    const resolved: BackendCapabilities = {
      canonicalAuthority: advertised?.canonical_authority === true,
      sessionReplay: advertised?.session_replay === true,
      sharedControls: advertised?.shared_controls === true
    }

    $backendCapabilities.set(resolved)

    return resolved
  } catch {
    // Method missing (older/pooled serve), transport down, or a 4xxx — all
    // mean the pooled verdict; pooled is the safe lower rung either way.
    $backendCapabilities.set({ ...POOLED_BACKEND_CAPABILITIES })

    return POOLED_BACKEND_CAPABILITIES
  }
}

// The active gateway object changing hands is the one refresh trigger: boot,
// reconnect, and every connection/mode/profile re-home all settle through
// $gateway, so a switch can never leave a stale verdict behind.
$gateway.subscribe((gateway: Readonly<HermesGateway> | null) => {
  if (!gateway || gateway.connectionState !== 'open') {
    $backendCapabilities.set({ ...POOLED_BACKEND_CAPABILITIES })

    return
  }

  void resolveBackendCapabilities((method, params) => gateway.request(method, params))
})
