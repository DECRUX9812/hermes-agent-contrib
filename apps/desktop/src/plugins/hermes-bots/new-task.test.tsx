/**
 * "New task" (bot-mode F3): the affordance rides the side-chat machinery —
 * `host.newChat` with the bots workspace scope opens a second session tile —
 * and by construction can never mint, rename, or target the canonical
 * "Bot Chat" (it issues no `session.*` RPC at all).
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { RosterRow } from './types'

const { newChat, notify, requestProfile, setWorkspaceScope } = vi.hoisted(() => ({
  newChat: vi.fn(),
  notify: vi.fn(),
  requestProfile: vi.fn(),
  setWorkspaceScope: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, newChat, notify, requestProfile, setWorkspaceScope }
  }
})
vi.mock('./i18n', () => ({
  useBots: () => ({ bot: { newTask: 'New task' } }),
  botsText: () => null
}))

import { NewTaskButton } from './new-task'

const botLocal: RosterRow = { name: 'default', sourceScoped: true, connectionId: 'local', connectionKind: 'local' }

beforeEach(() => {
  vi.clearAllMocks()
})

it('opens a side-chat tile scoped to the bot workspace — never the canonical Bot Chat', () => {
  const view = render(<NewTaskButton bot={botLocal} />)
  fireEvent.click(view.getByRole('button', { name: 'New task' }))

  expect(newChat).toHaveBeenCalledWith(
    { connectionId: 'local', mode: 'local', profile: 'default', targetProfile: 'default' },
    { workspaceMode: 'bots', workspaceOwnerKey: 'bot:local::default' }
  )
  expect(setWorkspaceScope).toHaveBeenCalledWith('bots', 'bot:local::default', {
    kind: 'route',
    route: { connectionId: 'local', mode: 'local', profile: 'default', targetProfile: 'default' }
  })
  // No session.* dispatch — the canonical registry pair is never written from here.
  expect(requestProfile).not.toHaveBeenCalled()
  view.unmount()
})

it('an unroutable bot surfaces the unsupported notice instead of minting a chat', () => {
  const view = render(<NewTaskButton bot={{ name: 'legacy' }} />)
  fireEvent.click(view.getByRole('button', { name: 'New task' }))

  expect(newChat).not.toHaveBeenCalled()
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
  view.unmount()
})
