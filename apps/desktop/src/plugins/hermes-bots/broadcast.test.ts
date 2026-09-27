/**
 * D1 — fleet broadcast identity invariants.
 *
 *   1. Dispatch bridges STORED canonical id → LIVE runtime id via
 *      session.resume (the group-turn door), then prompt.submit carries the
 *      RUNTIME id — never the stored one — and the registry row comes from
 *      canonical_session / session.list {title:'Bot Chat', include_hidden:true},
 *      never a minted pointer or recency.
 *   2. A failed registry lookup fails closed: the entry lands as an error and
 *      NOTHING is minted or submitted (the forever-chat fork guard).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterRow } from './types'

const { hostMock, requestForBotMock } = vi.hoisted(() => ({
  hostMock: { notify: vi.fn() },
  requestForBotMock: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return {
    atom,
    BOT_CHAT_SESSION_HYDRATION_TIMEOUT_MS: 15_000,
    host: hostMock
  }
})

vi.mock('./routing', () => ({
  backendTargetProfile: (route: { targetProfile?: string } | null, name: string) => route?.targetProfile ?? name,
  botConnectionRoute: () => null,
  botRosterMeta: () => ({}),
  botWorkspaceOwnerKey: (bot: { connectionId?: string; name?: string } | null) =>
    `bot:${bot?.connectionId ? `${bot.connectionId}::` : ''}${bot?.name || 'default'}`,
  requestForBot: requestForBotMock
}))

vi.mock('./data', () => ({
  $botMeta: { get: () => ({}), set: vi.fn() },
  botMetaKey: (bot: { name?: string }) => bot?.name ?? '',
  botOwner: (owner: RosterRow | string) =>
    typeof owner === 'string'
      ? { bot: { name: owner }, key: owner, name: owner, route: null }
      : { bot: owner, key: owner?.name, name: owner?.name, route: null },
  botRosterKey: (bot: Partial<RosterRow> | null | undefined) =>
    `${bot?.connectionId || 'legacy'}::${bot?.name || 'default'}`,
  persistBotMetaSnapshot: vi.fn(),
  saveBotMeta: vi.fn()
}))

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'hermes-bots' }))

import { $broadcastRun, broadcastPrompt, resetBroadcastForTest } from './broadcast'

interface RpcCall {
  method: string
  params: Record<string, unknown>
}

function respondWith(handler: (call: RpcCall) => unknown) {
  const calls: RpcCall[] = []

  requestForBotMock.mockImplementation(async (_bot: unknown, method: string, params: Record<string, unknown>) => {
    const call = { method, params: structuredClone(params ?? {}) }

    calls.push(call)

    return handler(call)
  })

  return calls
}

const withChat = (name: string): RosterRow =>
  ({ canonical_session: { id: `stored-${name}` }, name }) as unknown as RosterRow

const noChat = (name: string): RosterRow => ({ name }) as RosterRow

/** A single `await` only reaches the microtasks already queued when our
 *  continuation was enqueued — a promise CHAIN keeps enqueueing behind it.
 *  Rounds of `Promise.resolve()` walk the FIFO until the dispatch chain
 *  (resolve → resume → submit) has fully settled. */
async function flushChain() {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve()
  }
}

/** Let the dispatch chain settle, then advance one poll tick so collectReply
 *  can read the turn, then flush its patch. */
async function settleOnePoll() {
  await flushChain()
  await vi.advanceTimersByTimeAsync(4_000)
  await flushChain()
}

beforeEach(() => {
  vi.useFakeTimers()
  requestForBotMock.mockReset()
  hostMock.notify.mockReset()
  resetBroadcastForTest()
})

describe('broadcastPrompt', () => {
  it('submits the prompt to each bot’s canonical chat via the stored→runtime bridge', async () => {
    const calls = respondWith(call => {
      if (call.method === 'session.list') {
        return { sessions: [{ id: 'stored-beta', title: 'Bot Chat' }] }
      }

      if (call.method === 'session.resume') {
        const stored = String(call.params.session_id)

        if (call.params.omit_messages) {
          return { message_count: 2, session_id: `rt-${stored}` }
        }

        return {
          running: false,
          messages: [
            { content: 'earlier user', role: 'user' },
            { content: 'earlier reply', role: 'assistant' },
            { content: [{ text: `reply from ${stored}` }], role: 'assistant' }
          ]
        }
      }

      if (call.method === 'prompt.submit') {
        return {}
      }

      throw new Error(`unexpected ${call.method}`)
    })

    broadcastPrompt([withChat('alpha'), noChat('beta')], 'status report?')
    await settleOnePoll()

    const submits = calls.filter(call => call.method === 'prompt.submit')

    expect(submits).toHaveLength(2)
    expect(submits.map(call => call.params.session_id).sort()).toEqual(['rt-stored-alpha', 'rt-stored-beta'])
    expect(submits.every(call => call.params.text === 'status report?')).toBe(true)

    // The registry door: beta resolved through session.list with the exact
    //  title + include_hidden contract; alpha used the gateway-reported
    //  canonical_session without a second lookup.
    const lists = calls.filter(call => call.method === 'session.list')

    expect(lists).toHaveLength(1)
    expect(lists[0].params).toMatchObject({ include_hidden: true, title: 'Bot Chat' })
    expect(calls.some(call => call.method === 'session.create')).toBe(false)

    // prompt.submit carries the LIVE runtime id, resumed from the stored one.
    const resumes = calls.filter(call => call.method === 'session.resume' && call.params.omit_messages)

    expect(resumes.map(call => call.params.session_id).sort()).toEqual(['stored-alpha', 'stored-beta'])

    const entries = $broadcastRun.get()?.entries || []

    expect(entries.map(entry => entry.status)).toEqual(['done', 'done'])
    expect(entries.map(entry => entry.reply).sort()).toEqual(['reply from stored-alpha', 'reply from stored-beta'])
  })

  it('fails closed on a registry lookup error — nothing minted, nothing submitted', async () => {
    const calls = respondWith(call => {
      if (call.method === 'session.list') {
        throw new Error('gateway warming up')
      }

      if (call.method === 'session.resume') {
        const stored = String(call.params.session_id)

        if (call.params.omit_messages) {
          return { message_count: 0, session_id: `rt-${stored}` }
        }

        return { messages: [{ content: 'ok', role: 'assistant' }], running: false }
      }

      if (call.method === 'prompt.submit') {
        return {}
      }

      throw new Error(`unexpected ${call.method}`)
    })

    broadcastPrompt([noChat('beta')], 'ping')
    await settleOnePoll()

    const entry = $broadcastRun.get()?.entries[0]

    expect(entry?.status).toBe('error')
    expect(entry?.error).toContain('Bot Chat registry')
    expect(calls.some(call => call.method === 'session.create')).toBe(false)
    expect(calls.some(call => call.method === 'prompt.submit')).toBe(false)
  })
})
