import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GithubStatus, TunnelStatus } from '@/api/setup-connect'

import { ConnectStep, SetupStepper, setupView } from './connect-step'

const api = vi.hoisted(() => ({
  cancelGithubLogin: vi.fn(),
  getGithubStatus: vi.fn(),
  getTunnelStatus: vi.fn(),
  native: true,
  startGithubLogin: vi.fn(),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn()
}))

vi.mock('@/api/setup-connect', () => ({
  cancelGithubLogin: api.cancelGithubLogin,
  getGithubStatus: api.getGithubStatus,
  getTunnelStatus: api.getTunnelStatus,
  startGithubLogin: api.startGithubLogin,
  startTunnel: api.startTunnel,
  stopTunnel: api.stopTunnel
}))

vi.mock('@/app/settings/web-access-settings', () => ({ useWebAccessAvailable: () => api.native }))

const signedOut: GithubStatus = { account: null, authenticated: false, available: true, login: null }
const tunnelOff: TunnelStatus = { cloudflared: true, port: null, running: false, stale: false, url: null }

beforeEach(() => {
  api.native = true
  api.getGithubStatus.mockResolvedValue(signedOut)
  api.getTunnelStatus.mockResolvedValue(tunnelOff)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('ConnectStep', () => {
  it('shows the GitHub device code, then the account once gh reports it', async () => {
    const login = { state: 'pending' as const, user_code: 'ABCD-1234', verification_url: 'https://github.com/login/device' }
    api.startGithubLogin.mockResolvedValue(login)
    render(<ConnectStep onDone={() => undefined} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }))
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()

    vi.useFakeTimers()
    api.getGithubStatus.mockResolvedValue({ ...signedOut, account: 'octocat', authenticated: true, login: { ...login, state: 'succeeded' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    vi.useRealTimers()

    expect(await screen.findByText('Signed in as octocat')).toBeTruthy()
  })

  it('starts a quick tunnel and shows its address', async () => {
    api.startTunnel.mockResolvedValue({ access: {}, tunnel: { running: true, url: 'https://abc.trycloudflare.com' } })
    render(<ConnectStep onDone={() => undefined} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Start tunnel' }))

    expect(await screen.findByText('https://abc.trycloudflare.com')).toBeTruthy()
    expect(api.startTunnel).toHaveBeenCalledTimes(1)
  })

  it('surfaces a refused tunnel start instead of claiming it is live', async () => {
    api.startTunnel.mockRejectedValue(new Error('Sign in to Nous first'))
    render(<ConnectStep onDone={() => undefined} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Start tunnel' }))

    expect(await screen.findByText("Couldn't start the tunnel: Sign in to Nous first")).toBeTruthy()
    expect(screen.queryByText('Live at')).toBeNull()
  })

  it('never asks a browser-hosted app for tunnel state', async () => {
    api.native = false
    render(<ConnectStep onDone={() => undefined} />)

    expect(await screen.findByText(/set up from Hermes Desktop/)).toBeTruthy()
    expect(api.getTunnelStatus).not.toHaveBeenCalled()
  })

  it('lets the user skip straight to the chat', async () => {
    const onDone = vi.fn()
    render(<ConnectStep onDone={onDone} />)

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })
})

describe('SetupStepper', () => {
  it('marks the current step and the ones before it', () => {
    render(<SetupStepper current="model" />)

    const current = screen.getByText('Model').closest('li')
    expect(current?.getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('Connect').closest('li')?.getAttribute('aria-current')).toBeNull()
  })
})

describe('setupView', () => {
  const firstRun = { confirming: false, connectStep: false, freeTierIntro: false, manual: false, ready: true, showPicker: true }

  it('walks identity, then model, then the Connect step on first run', () => {
    expect(setupView(firstRun)).toMatchObject({ connectNext: true, header: true, inConnect: false, step: 'identity' })
    expect(setupView({ ...firstRun, confirming: true, showPicker: false })).toMatchObject({ bare: true, step: 'model' })
    expect(setupView({ ...firstRun, confirming: true, connectStep: true, showPicker: false })).toMatchObject({
      bare: false,
      connectNext: false,
      header: false,
      inConnect: true,
      step: 'connect'
    })
  })

  it('skips the Connect step and the stepper when the user reopened setup manually', () => {
    expect(setupView({ ...firstRun, confirming: true, manual: true, showPicker: false })).toMatchObject({
      connectNext: false,
      inConnect: false,
      step: null
    })
  })
})
