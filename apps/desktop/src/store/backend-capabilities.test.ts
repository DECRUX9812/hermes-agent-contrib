import { beforeEach, describe, expect, it } from 'vitest'

import {
  $backendCapabilities,
  POOLED_BACKEND_CAPABILITIES,
  resolveBackendCapabilities
} from './backend-capabilities'

describe('backend-capabilities', () => {
  beforeEach(() => {
    $backendCapabilities.set({ ...POOLED_BACKEND_CAPABILITIES })
  })

  it("today's pooled backend (no canonical keys advertised) resolves to the pooled verdict", async () => {
    // The real `gateway.capabilities` answer on a pooled `hermes serve`:
    // upstream only declares per_session_exclusive_submit — no authority keys.
    const request = async <T>(_method: string, _params?: Record<string, unknown>): Promise<T> =>
      ({ per_session_exclusive_submit: true }) as T

    const resolved = await resolveBackendCapabilities(request)

    expect(resolved).toEqual(POOLED_BACKEND_CAPABILITIES)
    expect($backendCapabilities.get()).toEqual(POOLED_BACKEND_CAPABILITIES)
  })

  it('a backend advertising canonical authority resolves canonical, and a probe failure stays pooled', async () => {
    const canonical = await resolveBackendCapabilities(async <T>(): Promise<T> =>
      ({ canonical_authority: true, session_replay: true, shared_controls: true }) as T
    )

    expect(canonical).toEqual({ canonicalAuthority: true, sessionReplay: true, sharedControls: true })
    expect($backendCapabilities.get().canonicalAuthority).toBe(true)

    // A backend that cannot answer (older serve, transport down) is the
    // pooled verdict, not an error — pooled is the safe lower rung.
    const after = await resolveBackendCapabilities(async (): Promise<never> => {
      throw new Error('method not found')
    })

    expect(after).toEqual(POOLED_BACKEND_CAPABILITIES)
    expect($backendCapabilities.get()).toEqual(POOLED_BACKEND_CAPABILITIES)
  })
})
