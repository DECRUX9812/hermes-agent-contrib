/**
 * Model quick-swap (C3): the roster row's "Model" submenu writes the pick
 * through `profiles.configure` on the BOT's own backend, honours the
 * expensive-model confirm handshake, and unsets via `cli.exec` for the
 * inherit path — the same write path the editor uses, minus the dialog.
 *
 * Invariants under test:
 *  - a pick sends `{name, model, provider}` — name is ALWAYS the bot's own
 *    profile name, never a session or route field.
 *  - `confirm_required` is not an error: it routes through
 *    `surfaceModelSwitchConfirm`, whose `requestConfirmed` resends with
 *    `confirm_expensive_model: true`.
 *  - "inherit launch" issues `config unset model`, not a configure with
 *    empty strings (which the backend would read as a pin to '').
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyBotModelPick, clearBotModelPick } from './model-swap'
import type { RosterRow } from './types'

const { confirmSpy, hostMock, storageMock } = vi.hoisted(() => ({
  confirmSpy: vi.fn(),
  hostMock: {
    request: vi.fn(),
    requestProfile: vi.fn(),
    state: { connectionId: { get: () => 'local' }, profile: { get: () => 'default' } }
  },
  storageMock: { get: vi.fn(), set: vi.fn() }
}))

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return {
    atom,
    host: hostMock,
    queryClient: { invalidateQueries: vi.fn() },
    surfaceModelSwitchConfirm: confirmSpy,
    useQuery: vi.fn(),
    useValue: vi.fn()
  }
})

vi.mock('./shared', () => ({ getPluginCtx: () => ({ storage: storageMock }), ID: 'hermes-bots' }))

const bot = { name: 'researcher' } as RosterRow

beforeEach(() => {
  vi.clearAllMocks()
  confirmSpy.mockResolvedValue(true)
  hostMock.request.mockResolvedValue({ ok: true })
})

describe('applyBotModelPick', () => {
  it('sends profiles.configure with the bot profile name and the pick', async () => {
    await applyBotModelPick(bot, { model: 'claude-opus-4.6', provider: 'anthropic' })

    expect(hostMock.request).toHaveBeenCalledWith('profiles.configure', {
      model: 'claude-opus-4.6',
      name: 'researcher',
      provider: 'anthropic'
    })
  })

  it('hands a confirm_required answer to the shared confirm applier', async () => {
    hostMock.request.mockResolvedValueOnce({
      confirm_message: 'this model meters per token',
      confirm_required: true
    })

    await applyBotModelPick(bot, { model: 'gpt-5.6', provider: 'openai' })

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const options = confirmSpy.mock.calls[0][0]

    expect(options.model).toBe('gpt-5.6')
    hostMock.request.mockResolvedValueOnce({ applied: { model: true } })
    await options.requestConfirmed()

    expect(hostMock.request).toHaveBeenLastCalledWith('profiles.configure', {
      confirm_expensive_model: true,
      model: 'gpt-5.6',
      name: 'researcher',
      provider: 'openai'
    })
  })

  it('does not call the confirm applier on a plain success', async () => {
    await applyBotModelPick(bot, { model: 'm', provider: 'p' })

    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

describe('clearBotModelPick', () => {
  it('unsets the profile model through cli.exec, never an empty pin', async () => {
    await clearBotModelPick(bot)

    expect(hostMock.request).toHaveBeenCalledWith('cli.exec', {
      argv: ['--profile', 'researcher', 'config', 'unset', 'model']
    })
    const configure = hostMock.request.mock.calls.find(([method]) => method === 'profiles.configure')

    expect(configure).toBeUndefined()
  })
})
