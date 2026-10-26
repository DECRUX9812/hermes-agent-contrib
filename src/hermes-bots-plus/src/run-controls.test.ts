/**
 * E1 — the row's run stop. Invariants under test:
 *   1. session.interrupt may only ever carry the canonical chat's LIVE
 *      runtime id — resolved through the runtime→stored bridge, never a
 *      stored id passed where a live one belongs, and never a session-list
 *      lookup minting one (src/AGENTS.md canonical identity).
 *   2. No mounted runtime means the stop is an honest no-op — 'idle', and
 *      the gateway is not dialed for a turn nothing is running.
 *   3. The interrupt is routed to the bot's OWN connection/profile — the
 *      same door every other bot-scoped RPC takes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'hermes-bots' }))

import { stopBotTurn } from './run-controls'
import type { RosterRow } from './types'

function setRuntimes(map: Record<string, string>) {
  host.state = {
    ...(host.state as Record<string, unknown>),
    storedSessionByRuntimeId: { get: () => map }
  }
}

const BOT: RosterRow = {
  canonical_session: { id: 'stored-1', resolved_id: 'stored-1' },
  name: 'radar'
} as RosterRow

beforeEach(() => {
  for (const key of Object.keys(host)) {
    delete host[key]
  }

  host.state = { connectionId: { get: () => 'local' } }
})

describe('stopBotTurn', () => {
  it('interrupts the canonical chat via its live runtime id on the bot’s own route', async () => {
    const requestProfile = vi.fn(async () => ({ status: 'interrupted' }))

    host.requestProfile = requestProfile
    setRuntimes({ 'rt-9': 'stored-1', 'rt-other': 'stored-2' })

    const bot = {
      ...BOT,
      connectionId: 'conn-b',
      remoteSource: { connectionId: 'conn-b' },
      sourceScoped: true
    } as unknown as RosterRow

    const result = await stopBotTurn(bot)

    expect(result).toBe('stopped')
    expect(requestProfile).toHaveBeenCalledTimes(1)

    const call = requestProfile.mock.calls[0] as unknown[]

    expect(call[1]).toBe('session.interrupt')
    // The live runtime id — the stored id must never cross into a
    // session-scoped RPC.
    expect(call[2]).toEqual({ session_id: 'rt-9' })
    expect((call[0] as { connectionId: string }).connectionId).toBe('conn-b')
  })

  it('is an honest no-op when the canonical chat has no live runtime', async () => {
    const request = vi.fn(async () => ({ status: 'interrupted' }))

    host.request = request
    setRuntimes({ 'rt-9': 'stored-OTHER' })

    expect(await stopBotTurn(BOT)).toBe('idle')
    expect(request).not.toHaveBeenCalled()
  })

  it('reports failed rather than throwing when the interrupt rejects', async () => {
    host.request = vi.fn(async () => {
      throw new Error('session not found')
    })
    setRuntimes({ 'rt-9': 'stored-1' })

    expect(await stopBotTurn(BOT)).toBe('failed')
  })

  it('maps a not_interrupted answer to idle — nothing was running gateway-side', async () => {
    host.request = vi.fn(async () => ({ status: 'not_interrupted' }))
    setRuntimes({ 'rt-9': 'stored-1' })

    expect(await stopBotTurn(BOT)).toBe('idle')
  })
})
