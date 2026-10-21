import { expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn(async () => ({ text: '**TL;DR**\n- Header shipped' })))

vi.mock('@hermes/plugin-sdk', async () => {
  const base = await (await import('./group-test-utils')).pluginSdkMock({})

  return { ...base, host: { ...(base.host as object), request } }
})

it('recaps through the auxiliary one-shot model, never a member session, in the user’s and teammates’ names', async () => {
  const { recapEntries } = await import('./group-room-catchup')

  const text = await recapEntries(
    [
      { at: 1, from: { kind: 'user', name: 'You' }, text: 'ship the header', thread: 'a' },
      { at: 2, from: { kind: 'member', name: 'coder' }, text: 'shipped,   commit abc1234', thread: 'a' }
    ],
    name => (name === 'coder' ? 'Coder' : name)
  )

  expect(text).toBe('**TL;DR**\n- Header shipped')
  const [method, params] = request.mock.calls[0] as unknown as [string, Record<string, unknown>]
  expect(method).toBe('llm.oneshot')
  expect(params).not.toHaveProperty('session_id')
  expect(params.task).toBe('session_ask')
  expect(params.input).toBe('User (CEO): ship the header\nCoder: shipped, commit abc1234')
})
