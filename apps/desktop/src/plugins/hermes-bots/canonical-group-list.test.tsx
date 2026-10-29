/** Sidebar canonical-group list: the fetch rides the socket's open edge, so a
 *  failed-or-never-run discovery recovers on reconnect instead of sticking a
 *  stale alert at the pane top; an empty healthy list paints no chrome at all. */
import type * as HermesSdk from '@hermes/plugin-sdk'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { atom, type WritableAtom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { translateBotsIn } from './i18n-test-helper'

const { requestProfile } = vi.hoisted(() => ({ requestProfile: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: {
      ...sdk.host,
      requestProfile,
      state: { ...sdk.host.state, connectionId: atom<null | string>('local'), gateway: atom('open'), profile: atom('default') }
    },
    usePluginI18n: () => translateBotsIn('en')
  }
})
import { host } from '@hermes/plugin-sdk'

import { CanonicalGroupList } from './canonical-group-registry'

const room = { room_id: 'room-1', name: 'Launch crew', members: [{ member_id: 'm1', profile: 'work', handle: 'work' }] }
let rooms: (typeof room)[] = []
let fail = ''

const gatewayState = () => host.state.gateway as WritableAtom<string>

beforeEach(() => {
  rooms = []
  fail = ''
  requestProfile.mockImplementation(async (_route: unknown, method: string) => {
    if (method === 'groups.list') {
      if (fail) {
        throw new Error(fail)
      }

      return { rooms, next_offset: null }
    }

    return {}
  })
  act(() => gatewayState().set('open'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  act(() => gatewayState().set('open'))
})

it('paints no chrome while the list is empty and healthy', async () => {
  const view = render(<CanonicalGroupList onOpen={() => {}} />)
  await waitFor(() => expect(requestProfile).toHaveBeenCalledWith(expect.anything(), 'groups.list', expect.anything()))
  expect(view.container.innerHTML).toBe('')
  expect(screen.queryByRole('button', { name: 'Refresh gateway groups' })).toBeNull()
})

it('re-discovers on reconnect instead of sticking a stale alert', async () => {
  fail = 'Hermes gateway is not connected'
  act(() => gatewayState().set('closed'))
  const view = render(<CanonicalGroupList onOpen={() => {}} />)
  expect(view.container.innerHTML).toBe('')

  rooms = [room]
  await act(async () => {
    fail = ''
    gatewayState().set('open')
  })
  await screen.findByRole('button', { name: 'Launch crew' })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('surfaces a discovery error as styled alert text, not raw foreground copy', async () => {
  fail = 'Hermes gateway is not connected'
  render(<CanonicalGroupList onOpen={() => {}} />)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Hermes gateway is not connected')
  expect(alert.className).toContain('text-(--ui-text-tertiary)')
})
