import { act, fireEvent, render, renderHook } from '@testing-library/react'
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
    host: { notify: vi.fn(), notifyError: vi.fn(), onEvent: vi.fn(onGatewayEvent), requestProfile: vi.fn() }
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
      heroOpenLive: 'Open live',
      heroStale: 'Last seen',
      heroSuppressed: 'Hidden while someone has control',
      portalUnavailable: 'Update the bot',
      heroConnecting: 'Connecting',
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
      portalStopped: 'Stopped',
      portalNotInstalled: 'Not installed',
      portalUnsupported: 'Unsupported',
      takeOver: 'Take over',
      handBack: 'Hand back',
      handBackForce: 'Force hand back',
      handBackForceHint: 'Another window holds control'
    }
  })
}))
vi.mock('./screen-open', () => ({ openBotScreen: vi.fn() }))

import { host } from '@hermes/plugin-sdk'

// Exercise the real event bus in this integration test, not a copied dispatcher.
// eslint-disable-next-line no-restricted-imports
import { emitGatewayEvent } from '../../contrib/events'

import { $lastRoster } from './data'
import type { DisplayStatus } from './screen-connection'
import { openBotScreen } from './screen-open'
import { BotComputerPanel } from './screen-panel'
import { ProfileGroupScreenPortal, useScreenPortalState } from './screen-portal'
import { $screenState, setScreenStatus } from './screen-state'

const botA: RosterRow = { name: 'default', sourceScoped: true, connectionId: 'host-a', connectionKind: 'remote' }
const botB: RosterRow = { ...botA, connectionId: 'host-b' }

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

beforeEach(() => {
  $screenState.set({})
  $lastRoster.set([])
  vi.mocked(host.requestProfile).mockReset()
  vi.mocked(openBotScreen).mockClear()
  vi.spyOn(globalThis.document, 'hidden', 'get').mockReturnValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('applies lease events only from the owning host even when profile paths match', () => {
  setScreenStatus(botA, status)
  const view = renderHook(() => useScreenPortalState(botA))

  const human = {
    ...status.lease,
    holder: 'human' as const,
    viewer_hash: 'e0f9a555d558',
    epoch: status.lease.epoch + 1
  }

  const emit = (connectionId: string, profileKey = status.profile_key) =>
    act(() =>
      emitGatewayEvent({
        type: 'display.lease',
        connectionId,
        profile: 'default',
        payload: { profile_key: profileKey, lease: human }
      })
    )

  emit('host-b')
  expect(view.result.current.lease?.holder).toBe('agent')
  emit('host-a', '/another/profile')
  expect(view.result.current.lease?.holder).toBe('agent')
  emit('host-a')
  expect(view.result.current.lease).toEqual(human)
  view.unmount()
})

it('does not match a legacy profile group to a same-named remote bot', () => {
  const legacy: RosterRow = { name: 'default' }
  $lastRoster.set([botB, legacy])
  setScreenStatus(botB, status)
  setScreenStatus(legacy, status)
  const view = render(<ProfileGroupScreenPortal route={{ connectionId: null, profile: 'default' }} />)

  fireEvent.click(view.getByRole('button'))
  expect(openBotScreen).toHaveBeenCalledWith(legacy, null)
  view.rerender(<ProfileGroupScreenPortal route={{ connectionId: 'host-b', profile: 'default' }} />)
  fireEvent.click(view.getByRole('button'))
  expect(openBotScreen).toHaveBeenLastCalledWith(botB, null)
  view.unmount()
})

it.each(['pending', 'rejected'])('never displays host A pixels under host B while B is %s', async state => {
  setScreenStatus(botA, status)
  setScreenStatus(botB, status)
  vi.mocked(host.requestProfile)
    .mockResolvedValueOnce({ data_url: 'data:image/jpeg;base64,HOST_A' })
    .mockImplementationOnce(() => (state === 'pending' ? new Promise(() => {}) : Promise.reject(new Error('offline'))))
  const view = render(<BotComputerPanel bot={botA} />)
  await act(async () => {})
  expect(view.container.querySelector('img')?.getAttribute('src')).toContain('HOST_A')

  view.rerender(<BotComputerPanel bot={botB} />)
  await act(async () => {})
  expect(view.container.querySelector('img')).toBeNull()
  view.unmount()
})

it('discards a late thumbnail from the previous owner and retains a same-owner frame on refresh failure', async () => {
  vi.useFakeTimers()
  setScreenStatus(botA, status)
  setScreenStatus(botB, status)
  let finishA!: (value: unknown) => void
  vi.mocked(host.requestProfile)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishA = resolve
        })
    )
    .mockResolvedValueOnce({ data_url: 'data:image/jpeg;base64,HOST_B' })
    .mockRejectedValue(new Error('offline'))
  const view = render(<BotComputerPanel bot={botA} />)
  view.rerender(<BotComputerPanel bot={botB} />)
  await act(async () => {})
  await act(async () => {
    finishA({ data_url: 'data:image/jpeg;base64,HOST_A' })
  })
  expect(view.container.querySelector('img')?.getAttribute('src')).toContain('HOST_B')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000)
  })
  expect(view.container.querySelector('img')?.getAttribute('src')).toContain('HOST_B')
  expect(view.getByRole('button', { name: /^Screen/ }).getAttribute('aria-label')).toContain('Last seen')
  view.unmount()
})

it('captions a suppressed thumbnail as hidden-while-controlled and never ages it into stale', async () => {
  vi.useFakeTimers()
  setScreenStatus(botA, status)
  vi.mocked(host.requestProfile).mockResolvedValue({ data_url: null, suppressed: 'human_has_control' })
  const view = render(<BotComputerPanel bot={botA} />)
  await act(async () => {})
  expect(view.getByRole('button', { name: /^Screen/ }).getAttribute('aria-label')).toContain('Hidden while someone has control')

  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000)
  })
  expect(view.getByRole('button', { name: /^Screen/ }).getAttribute('aria-label')).toContain('Hidden while someone has control')
  expect(view.getByRole('button', { name: /^Screen/ }).getAttribute('aria-label')).not.toContain('Last seen')
  view.unmount()
})

it('settles on an older backend without display.*: portal tone is unavailable and the panel shows no live frame', async () => {
  vi.mocked(host.requestProfile).mockRejectedValue(
    Object.assign(new Error('Method not found: display.status'), { code: -32601 })
  )
  const hook = renderHook(() => useScreenPortalState(botA))
  await act(async () => {})
  expect(hook.result.current.tone).toBe('unavailable')
  hook.rerender()
  await act(async () => {})
  expect(vi.mocked(host.requestProfile)).toHaveBeenCalledTimes(1)
  hook.unmount()

  const view = render(<BotComputerPanel bot={botA} />)
  await act(async () => {})
  expect(view.queryByRole('button', { name: /^Screen/ })).toBeNull()
  expect(view.container.querySelector('img')).toBeNull()
  view.unmount()
})

it('a sidebar group portal keeps its lease subscription across parent re-renders (no per-paint row rebuild)', async () => {
  vi.mocked(host.requestProfile).mockResolvedValue(status)
  const view = render(<ProfileGroupScreenPortal route={{ connectionId: 'host-b', profile: 'default' }} />)
  await act(async () => {})
  const subscriptions = vi.mocked(host.onEvent).mock.calls.length

  view.rerender(<ProfileGroupScreenPortal route={{ connectionId: 'host-b', profile: 'default' }} />)
  view.rerender(<ProfileGroupScreenPortal route={{ connectionId: 'host-b', profile: 'default' }} />)
  await act(async () => {})
  expect(vi.mocked(host.onEvent).mock.calls.length).toBe(subscriptions)
  view.unmount()
})
