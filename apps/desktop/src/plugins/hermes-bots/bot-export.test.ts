/**
 * Bot export/import (C5) — the flow contracts.
 *
 *  - **Export routes to the bot's OWN backend.** A remote-scoped row exports
 *    through that connection's REST export endpoint (the archive lands on the
 *    backend's filesystem), never the local one — so the flow resolves the
 *    row's route and forwards `connectionId`.
 *  - **The bundle is meta-carrying, session-free.** The bot pack manifest
 *    (`bots.json` inside the archive) carries name/title/description and must
 *    NEVER embed session ids, tokens, or env — the backend already excludes
 *    .env/auth/session DBs, the manifest is purely descriptive.
 *  - **Cancel = silence.** Dismissing the save dialog must not toast, not
 *    write, not touch the roster.
 *  - **Import makes a roster row.** A successful import refreshes the roster
 *    so the new bot appears; it does NOT steal the active profile (that is
 *    the core import flow's job — bots must not switch it).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { hostMock } = vi.hoisted(() => ({
  hostMock: {
    exportProfileBundle: vi.fn(async (profile: string, opts?: { output?: string }) => opts?.output),
    importProfileBundle: vi.fn(async () => ({ name: 'pasted-bot' })),
    notify: vi.fn(),
    notifyError: vi.fn(),
    pickOpenPaths: vi.fn(async () => ['/tmp/pasted-bot.tar.gz']),
    pickSavePath: vi.fn(async () => '/tmp/alpha-bot.tar.gz')
  } as Record<string, unknown>
}))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(hostMock)
})

import { botBundleManifest, exportBot, importBot } from './bot-export'
import type { RosterRow } from './types'

const bot: RosterRow = { name: 'alpha' } as RosterRow

const exportProfileBundle = hostMock.exportProfileBundle as ReturnType<typeof vi.fn>
const importProfileBundle = hostMock.importProfileBundle as ReturnType<typeof vi.fn>
const pickOpenPaths = hostMock.pickOpenPaths as ReturnType<typeof vi.fn>
const pickSavePath = hostMock.pickSavePath as ReturnType<typeof vi.fn>

describe('botBundleManifest', () => {
  it('carries name/title/description and the hermes-bot marker — no session ids, no secrets', () => {
    const manifest = botBundleManifest(bot, { description: 'ops sidecar', title: 'Alpha Bot' } as never)

    expect(manifest).toMatchObject({
      description: 'ops sidecar',
      kind: 'hermes-bot',
      name: 'alpha',
      title: 'Alpha Bot'
    })
    expect(JSON.stringify(manifest)).not.toMatch(/session|token|secret|password|api_?key/i)
  })
})

describe('exportBot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes the archive to the picked path and ships a bots.json manifest', async () => {
    const archive = await exportBot(bot, { title: 'Alpha Bot' } as never)

    expect(pickSavePath).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'alpha.tar.gz' }))
    expect(exportProfileBundle).toHaveBeenCalledTimes(1)
    const [route, opts] = exportProfileBundle.mock.calls[0]
    expect(route).toBeNull()
    expect(opts).toMatchObject({ output: '/tmp/alpha-bot.tar.gz', profile: 'alpha' })
    expect(JSON.parse(opts.extraFiles['bots.json'])).toMatchObject({ kind: 'hermes-bot', name: 'alpha' })
    expect(archive).toBe('/tmp/alpha-bot.tar.gz')
  })

  it('routes remote bots to their connection', async () => {
    const remote = { connectionKind: 'remote', connectionId: 'home', name: 'alpha', sourceScoped: true } as RosterRow

    await exportBot(remote, null)

    const [route, opts] = exportProfileBundle.mock.calls[0]
    expect(route).toMatchObject({ connectionId: 'home' })
    expect(opts).toMatchObject({ profile: 'alpha' })
  })

  it('a dismissed save dialog exports nothing and stays silent', async () => {
    pickSavePath.mockResolvedValueOnce(null)
    const notify = hostMock.notify as ReturnType<typeof vi.fn>

    const archive = await exportBot(bot, null)

    expect(archive).toBeNull()
    expect(exportProfileBundle).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('importBot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('imports the picked archive and returns the new profile name', async () => {
    const name = await importBot()

    expect(importProfileBundle).toHaveBeenCalledWith(null, { archive: '/tmp/pasted-bot.tar.gz' })
    expect(name).toBe('pasted-bot')
  })

  it('a dismissed picker imports nothing', async () => {
    pickOpenPaths.mockResolvedValueOnce([])

    const name = await importBot()

    expect(name).toBeNull()
    expect(importProfileBundle).not.toHaveBeenCalled()
  })
})
