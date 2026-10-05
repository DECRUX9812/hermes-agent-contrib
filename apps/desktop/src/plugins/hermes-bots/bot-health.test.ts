/**
 * E2 — the row's health chip. Invariants under test on the pure derivation:
 *   1. An unreachable source outranks every in-band signal — a bot whose
 *      gateway is gone cannot report a failure itself.
 *   2. The recorded failure flag (classified relay-delivery / turn reasons)
 *      reads 'attention' and carries its reason through for the tooltip.
 *   3. A failed work item on the canonical chat's runtime is 'attention'
 *      even without a flag — the cheapest "last run failed" signal we have.
 *   4. A clean bot reports 'ok' — no chip is ever a false positive.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock({})
})

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'hermes-bots' }))

import { botHealth } from './live-status'

describe('botHealth', () => {
  it('reports unreachable ahead of every other signal', () => {
    expect(botHealth({ lastRunFailed: true, reachable: false, reason: 'provider_quota_limit' }).kind).toBe(
      'unreachable'
    )
  })

  it('carries the classified flag reason through as the chip detail', () => {
    const health = botHealth({ reachable: true, reason: 'provider_auth_or_access' })

    expect(health.kind).toBe('attention')
    expect(health.detail).toBe('provider_auth_or_access')
  })

  it('flags a failed work item on the canonical runtime without a flag', () => {
    const health = botHealth({ lastRunFailed: true, reachable: true })

    expect(health.kind).toBe('attention')
    expect(health.detail).toBe('last_run_failed')
  })

  it('is ok when no signal fires', () => {
    expect(botHealth({ reachable: true })).toEqual({ kind: 'ok' })
  })
})
