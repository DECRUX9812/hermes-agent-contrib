/**
 * MULTI-PROFILE GATEWAY REGISTRY — facade over the domain siblings:
 *
 *   gateway-registry   the shared registry state (globalThis-parked for HMR),
 *                      the window PRIMARY socket's identity, and the active-route
 *                      selection machinery (applyActive / atoms / reporting).
 *   gateway-secondary  one SECONDARY socket entry's mechanics: dial, reconnect
 *                      backoff, liveness probe, turn-lease primitives, retention
 *                      predicates, park/touch/count, and entry disposal.
 *   gateway-routing    request routing onto primary vs secondary sockets, the
 *                      request/relay/turn leases and retain calls that hold a
 *                      socket open, activation (the ensure/open entry points),
 *                      and the eviction admin (prune/close/retire/dispose-for-
 *                      connection).
 *
 * The facade keeps every public name; siblings own one topic each.
 */

export * from './gateway-registry'
export * from './gateway-routing'
export * from './gateway-secondary'

// Self-accept so an edit inside this family stays an in-place hot update.
// Dev-only: production strips import.meta.hot.
if (import.meta.hot) {
  import.meta.hot.accept()
}
