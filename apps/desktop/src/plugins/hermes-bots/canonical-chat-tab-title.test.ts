/**
 * Two bots side by side must not read identically in the tab strip.
 *
 * Every canonical chat's STORED title is exactly "Bot Chat" — that pair
 * (profile, title) is the registry identity and never changes. But the tab
 * label (`workspaceTabTitle`, the strip's fallback caption for these
 * unlisted hidden rows) was the same constant for every bot, so two open bot
 * chats both read "Bot Chat". The tab label carries the bot's display name;
 * the session title stays canonical.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterRow } from './types'

const { hostMock, persistMock, requestForBotMock, saveBotMetaMock } = vi.hoisted(() => ({
  hostMock: { openSession: vi.fn(), request: vi.fn() },
  persistMock: vi.fn(),
  requestForBotMock: vi.fn(),
  saveBotMetaMock: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', () => ({
  BOT_CHAT_SESSION_HYDRATION_TIMEOUT_MS: 15_000,
  host: hostMock
}))

vi.mock('./routing', () => ({
  aliasIdentityFor: () => null,
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
  persistBotMetaSnapshot: persistMock,
  saveBotMeta: saveBotMetaMock
}))

vi.mock('./shared', () => ({ getPluginCtx: () => null }))

function respondWith(handler: (method: string, params: Record<string, unknown>) => unknown) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []

  requestForBotMock.mockImplementation(async (_bot: unknown, method: string, params: Record<string, unknown>) => {
    calls.push({ method, params: structuredClone(params ?? {}) })

    return handler(method, params)
  })

  return calls
}

async function loadModule() {
  vi.resetModules()

  return import('./canonical-chat')
}

beforeEach(() => {
  vi.clearAllMocks()
  hostMock.openSession.mockResolvedValue(undefined)
})

describe('the tab label names the bot, the session title stays "Bot Chat"', () => {
  it('labels a registry-row open with the bot\u2019s display name', async () => {
    respondWith(method =>
      method === 'session.list'
        ? { sessions: [{ id: 'forever-chat', message_count: 12, title: 'Bot Chat' }] }
        : {}
    )

    const { openBotCanonicalChat } = await loadModule()
    await openBotCanonicalChat({ name: 'alpha', title: 'Moxie' } as RosterRow)

    const [, options] = hostMock.openSession.mock.calls[0]

    expect(options.tabTitle).toContain('Moxie')
  })

  it('labels a fresh-create open with the bot\u2019s display name', async () => {
    const calls = respondWith(method => {
      if (method === 'session.list') {
        return { sessions: [] }
      }

      if (method === 'session.create') {
        return { session_id: 'rt-1', stored_session_id: 'fresh-1' }
      }

      return {}
    })

    const { openBotCanonicalChat } = await loadModule()
    await openBotCanonicalChat({ name: 'beta', title: 'Zoe' } as RosterRow)

    const [, options] = hostMock.openSession.mock.calls[0]

    expect(options.tabTitle).toContain('Zoe')
    // The durable title is still the canonical registry name.
    expect(calls.find(call => call.method === 'session.create')?.params.title).toBe('Bot Chat')
  })

  it('two open bots get distinct tab labels', async () => {
    respondWith(method => {
      if (method === 'session.list') {
        return { sessions: [{ id: 'chat-row', message_count: 3, title: 'Bot Chat' }] }
      }

      return {}
    })

    const { openBotCanonicalChat } = await loadModule()
    await openBotCanonicalChat({ name: 'alpha', title: 'Moxie' } as RosterRow)
    await openBotCanonicalChat({ name: 'beta', title: 'Zoe' } as RosterRow)

    const labels = hostMock.openSession.mock.calls.map(([, options]) => options.tabTitle)

    expect(labels[0]).toContain('Moxie')
    expect(labels[1]).toContain('Zoe')
    expect(new Set(labels).size).toBe(2)
  })
})
