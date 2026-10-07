import type * as HermesSdk from '@hermes/plugin-sdk'
import type { RailArtifactItem } from '@hermes/plugin-sdk'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

const { list, openSession } = vi.hoisted(() => ({ list: vi.fn(), openSession: vi.fn() }))
vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, listProfileArtifacts: list, openSession },
    usePluginI18n: () => translateBots
  }
})
const { BotDeliverablesSection } = await import('./bot-deliverables')

const item = {
  id: 'report',
  kind: 'file',
  label: 'Report.md',
  timestamp: Date.now(),
  transcript: { sessionId: 'session-a', sessionTitle: 'Research' }
} as RailArtifactItem

const result = { items: [item], sessions: [] }

beforeEach(() => {
  vi.clearAllMocks()
  openSession.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('deliverables recovery and ownership', () => {
  it('distinguishes a failed read from empty work and retries through a real button', async () => {
    list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(result)
    render(<BotDeliverablesSection owner={{ name: 'alpha' }} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(translateBots('deliverables.empty'))).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Report.md' })).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('preserves the last successful results when a refresh fails', async () => {
    list.mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('offline'))
    render(<BotDeliverablesSection owner={{ name: 'alpha' }} />)
    await screen.findByRole('button', { name: 'Report.md' })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Report.md' })).toBeTruthy()
  })

  it('hides the previous owner immediately and ignores its late response', async () => {
    let finish!: (value: typeof result) => void
    list
      .mockReturnValueOnce(
        new Promise(resolve => {
          finish = resolve
        })
      )
      .mockResolvedValueOnce({ items: [], sessions: [] })
    const view = render(<BotDeliverablesSection owner={{ name: 'alpha' }} />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    view.rerender(<BotDeliverablesSection owner={{ name: 'beta' }} />)
    await screen.findByText(translateBots('deliverables.empty'))
    await act(async () => finish(result))
    expect(screen.queryByRole('button', { name: 'Report.md' })).toBeNull()
  })

  it('never lists a remote owner’s artifacts through the active connection when its route is gone', async () => {
    render(<BotDeliverablesSection owner={{ name: 'alpha', remoteSource: true }} />)
    await screen.findByRole('alert')
    expect(list).not.toHaveBeenCalled()
  })

  it('opens a result on its proven profile and transcript', async () => {
    list.mockResolvedValue(result)
    render(<BotDeliverablesSection owner={{ name: 'alpha', remoteSource: true, connectionId: 'remote' }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Report.md' }))
    expect(openSession).toHaveBeenCalledWith(
      'session-a',
      expect.objectContaining({
        profile: 'alpha',
        route: expect.objectContaining({ connectionId: 'remote' })
      })
    )
  })
})
