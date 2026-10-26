/**
 * Computer panel invariants (bot-mode F2/F4):
 *  - Take over mints this window's viewer via `display.observe` and only then
 *    acquires — never an empty `viewer_id` — and lands the user in the full
 *    pane (control without the RFB stream is blind).
 *  - Hand back releases with the minted viewer id.
 *  - Restart is a real bounce: `display.stop` before `display.start`.
 *  - The workdir affordance is local-only and prefers the existing
 *    open-in-terminal bridge on the canonical chat.
 *  - Copy screenshot never writes an empty clipboard entry.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { RosterRow } from './types'

vi.mock('@hermes/plugin-sdk', async () => {
  const { useStore } = await import('@nanostores/react')
  const { atom } = await import('nanostores')
  const { onGatewayEvent } = await import('../../contrib/events')

  return {
    atom,
    coarseElapsed: () => ({ unit: 'm' as const, value: 0 }),
    Button: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
      <button {...props}>{children}</button>
    ),
    Codicon: () => null,
    GlyphSpinner: () => null,
    Tip: ({ children }: { children?: ReactNode }) => children,
    useValue: useStore,
    resolveSiblingWsUrl: vi.fn(),
    host: {
      notify: vi.fn(),
      notifyError: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
      requestProfile: vi.fn()
    }
  }
})
vi.mock('./data', async () => {
  const { atom } = await import('nanostores')

  return {
    $lastRoster: atom<RosterRow[]>([]),
    botSelectionKey: (bot: RosterRow) =>
      bot.sourceScoped || bot.remoteSource ? `${bot.connectionId}::${bot.name}` : bot.name
  }
})
vi.mock('./i18n', () => ({
  useBots: () => ({
    screen: {
      portalTitle: 'Screen',
      portalWatching: 'Live',
      portalYouControl: 'You control',
      portalOtherControls: 'Other viewer',
      portalStopped: 'Stopped',
      portalNotInstalled: 'Not installed',
      portalUnsupported: 'Unsupported',
      portalUnavailable: 'Update the bot',
      heroConnecting: 'Connecting',
      heroStale: 'Last seen',
      heroSuppressed: 'Hidden while someone has control',
      panelTitle: 'Computer',
      openFullPane: 'Open full pane',
      copyScreenshot: 'Copy screenshot',
      screenshotCopied: 'Copied',
      screenshotFailed: 'Copy failed',
      restartScreen: 'Restart',
      restartFailed: 'Restart failed',
      openWorkdir: 'Workdir',
      workdirUnavailable: 'No workdir',
      workdirFailed: 'Workdir failed',
      resizePanel: 'Resize',
      takeOver: 'Take over',
      handBack: 'Hand back',
      handBackForce: 'Force hand back',
      handBackForceHint: 'Another window holds control'
    }
  })
}))
vi.mock('./screen-open', () => ({ openBotScreen: vi.fn() }))

import { host } from '@hermes/plugin-sdk'

import { type DisplayStatus, viewerHash } from './screen-connection'
import { openBotScreen } from './screen-open'
import { BotComputerPanel } from './screen-panel'
import { $screenState, setScreenLease, setScreenStatus, setScreenViewer } from './screen-state'

const botRemote: RosterRow = { name: 'default', sourceScoped: true, connectionId: 'host-a', connectionKind: 'remote' }

const botLocal: RosterRow = {
  name: 'default',
  sourceScoped: true,
  connectionId: 'local',
  connectionKind: 'local',
  canonical_session: { resolved_id: 'sess-canonical' } as RosterRow['canonical_session']
}

const status: DisplayStatus = {
  profile: 'default',
  profile_key: '/home/hermes/.hermes',
  supported: true,
  installed: true,
  missing: [],
  running: true,
  pid: 42,
  display: ':20',
  socket: '/tmp/rfb.sock',
  geometry: '1440x900',
  install_command: null,
  lease: { holder: 'agent', viewer_id: null, viewer_hash: null, since: 1, reason: '', epoch: 0 }
}

/** requestProfile calls as [method, params], thumbnails excluded — the poller interleaves them. */
function rpcCalls() {
  return vi
    .mocked(host.requestProfile)
    .mock.calls.map(([, method, params]) => [method, params] as const)
    .filter(([method]) => method !== 'display.thumbnail')
}

beforeEach(() => {
  $screenState.set({})
  vi.mocked(host.requestProfile).mockReset()
  vi.mocked(openBotScreen).mockClear()
  vi.spyOn(globalThis.document, 'hidden', 'get').mockReturnValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete (globalThis.window as { hermesDesktop?: unknown }).hermesDesktop
})

it('take over mints a viewer through display.observe before acquiring, then opens the full pane', async () => {
  setScreenStatus(botRemote, status)
  vi.mocked(host.requestProfile).mockImplementation(((_route: unknown, method: string) => {
    if (method === 'display.observe') {
      return Promise.resolve({ ...status, viewer_id: 'v-minted', ticket: 'ticket-1', path: '/ws' })
    }

    if (method === 'display.lease.acquire') {
      return Promise.resolve({
        lease: { holder: 'human', viewer_id: null, viewer_hash: 'hash', since: 2, reason: '', epoch: 1 }
      })
    }

    return Promise.resolve({ data_url: null })
  }) as never)

  const view = render(<BotComputerPanel bot={botRemote} />)
  await act(async () => {})
  fireEvent.click(view.getByRole('button', { name: 'Take over' }))

  // The chain is observe → acquire → open: several awaited hops, so a single
  // act() flush can drain before the acquire lands. waitFor settles it.
  await waitFor(() => {
    expect(rpcCalls().map(([method]) => method)).toEqual(['display.observe', 'display.lease.acquire'])
    expect(rpcCalls()[1]?.[1]).toMatchObject({ viewer_id: 'v-minted' })
    expect(vi.mocked(openBotScreen)).toHaveBeenCalledWith(botRemote, null)
  })
  view.unmount()
})

it('hand back releases the lease with this window\u2019s minted viewer id', async () => {
  const hash = await viewerHash('v-ours')
  setScreenStatus(botRemote, status)
  setScreenViewer(botRemote, { id: 'v-ours', hash })
  setScreenLease(botRemote, { holder: 'human', viewer_id: null, viewer_hash: hash, since: 1, reason: '', epoch: 3 })
  vi.mocked(host.requestProfile).mockImplementation(((_route: unknown, method: string) => {
    if (method === 'display.lease.release') {
      return Promise.resolve({
        lease: { holder: 'agent', viewer_id: null, viewer_hash: null, since: 2, reason: '', epoch: 4 }
      })
    }

    return Promise.resolve({ data_url: null })
  }) as never)

  const view = render(<BotComputerPanel bot={botRemote} />)
  await act(async () => {})
  fireEvent.click(view.getByRole('button', { name: 'Hand back' }))

  await waitFor(() => {
    // Every Bot Screen RPC is scoped to the route's profile (#120966).
    expect(rpcCalls()).toEqual([['display.lease.release', { viewer_id: 'v-ours', profile: botRemote.name }]])
  })
  view.unmount()
})

it('restart bounces the screen: display.stop (forced) before display.start', async () => {
  setScreenStatus(botRemote, status)
  vi.mocked(host.requestProfile).mockImplementation(((_route: unknown, method: string) => {
    if (method === 'display.stop' || method === 'display.start') {
      return Promise.resolve(status)
    }

    return Promise.resolve({ data_url: null })
  }) as never)

  const view = render(<BotComputerPanel bot={botRemote} />)
  await act(async () => {})
  fireEvent.click(view.getByRole('button', { name: 'Restart' }))

  await waitFor(() => {
    expect(rpcCalls()).toEqual([
      ['display.stop', { force: true, profile: botRemote.name }],
      ['display.start', { profile: botRemote.name }]
    ])
  })
  view.unmount()
})

it('opens the bot workdir in a user terminal on the canonical chat; hidden for remote bots', async () => {
  const openSessionInTerminal = vi.fn(() => Promise.resolve({ ok: true }))

  ;(globalThis.window as { hermesDesktop?: unknown }).hermesDesktop = { openSessionInTerminal }

  setScreenStatus(botLocal, status)
  vi.mocked(host.requestProfile).mockImplementation(((_route: unknown, method: string) => {
    if (method === 'config.get') {
      return Promise.resolve({ cwd: '/work/proj' })
    }

    return Promise.resolve({ data_url: null })
  }) as never)

  const view = render(<BotComputerPanel bot={botLocal} />)
  await act(async () => {})
  fireEvent.click(view.getByRole('button', { name: 'Workdir' }))

  await waitFor(() => {
    expect(openSessionInTerminal).toHaveBeenCalledWith('sess-canonical', { cwd: '/work/proj', profile: 'default' })
  })
  view.unmount()

  const remote = render(<BotComputerPanel bot={botRemote} />)
  await act(async () => {})
  expect(remote.queryByRole('button', { name: 'Workdir' })).toBeNull()
  remote.unmount()
})

it('copy screenshot never writes an empty frame to the clipboard', async () => {
  setScreenStatus(botRemote, status)
  vi.mocked(host.requestProfile).mockImplementation(((_route: unknown, method: string) => {
    if (method === 'display.thumbnail') {
      return Promise.resolve({ data_url: null, suppressed: 'human_has_control' })
    }

    return Promise.resolve({})
  }) as never)

  const view = render(<BotComputerPanel bot={botRemote} />)
  await act(async () => {})
  fireEvent.click(view.getByRole('button', { name: 'Copy screenshot' }))

  await waitFor(() => {
    expect(vi.mocked(host.notifyError)).toHaveBeenCalled()
  })
  view.unmount()
})
