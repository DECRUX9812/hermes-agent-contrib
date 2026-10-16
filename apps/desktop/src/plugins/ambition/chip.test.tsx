/**
 * The composer chip's contract, with the real api layer bound to a scripted
 * `ctx.rest` (the door register() hands it):
 *
 *  - the chip mirrors the backend mode for the session it is mounted in;
 *  - a toggle paints optimistically and ROLLS BACK when the PUT fails;
 *  - a backend without the ambition plugin (REST 404) hides the chip.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Test harness supplies the host's locale registration, as plugin loading does.
// eslint-disable-next-line no-restricted-imports
import { registerPluginLocales } from '@/i18n/plugin-i18n'
// eslint-disable-next-line no-restricted-imports
import { $selectedStoredSessionId } from '@/store/session'

import { type AmbitionRest, bindAmbitionApi } from './api'
import { AmbitionChip } from './chip'
import { AMBITION_LOCALES } from './i18n'

const SESSION = '20260101_090000_abc123'

const summary = (enabled: boolean) => ({ cards: [], enabled })

let rest: ReturnType<typeof vi.fn>
let disposeLocales: () => void = () => undefined
let queryClient: QueryClient

beforeEach(() => {
  rest = vi.fn()
  bindAmbitionApi(rest as unknown as AmbitionRest)
  disposeLocales = registerPluginLocales('ambition', AMBITION_LOCALES)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  $selectedStoredSessionId.set(SESSION)
})

afterEach(() => {
  cleanup()
  disposeLocales()
  $selectedStoredSessionId.set(null)
  queryClient.clear()
})

const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <AmbitionChip />
    </QueryClientProvider>
  )

const chip = () => screen.getByRole('button', { name: 'Ambition' })

describe('AmbitionChip', () => {
  it('reflects the backend mode: off paints off, on paints on', async () => {
    rest.mockResolvedValue(summary(false))

    mount()

    await waitFor(() => expect(chip().getAttribute('data-state')).toBe('off'))
    cleanup()
    queryClient.clear()

    rest.mockResolvedValue(summary(true))
    mount()

    await waitFor(() => expect(chip().getAttribute('data-state')).toBe('on'))
    // The read went through the plugin REST door with the session id.
    expect(rest.mock.calls.some(call => call[0] === `/sessions/${SESSION}`)).toBe(true)
  })

  it('toggles optimistically and rolls back visibly when the PUT fails', async () => {
    const putFailure: { reject: null | ((error: Error) => void) } = { reject: null }

    rest.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === `/sessions/${SESSION}/mode` && opts?.method === 'PUT') {
        return new Promise<void>((_, reject) => {
          putFailure.reject = (error: Error) => reject(error)
        })
      }

      return Promise.resolve(summary(false))
    })

    mount()

    await waitFor(() => expect(chip().getAttribute('data-state')).toBe('off'))

    fireEvent.click(chip())

    // Optimistic: ON paints while the write is in flight.
    await waitFor(() => expect(chip().getAttribute('data-state')).toBe('on'))

    // The failed write refetches the backend truth — the visible rollback.
    putFailure.reject?.(new Error('500: backend exploded'))

    await waitFor(() => expect(chip().getAttribute('data-state')).toBe('off'))
    expect(rest.mock.calls.some(call => call[0] === `/sessions/${SESSION}/mode`)).toBe(true)
  })

  it('PUTs the real mode on success', async () => {
    let enabled = false

    rest.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === `/sessions/${SESSION}/mode` && opts?.method === 'PUT') {
        enabled = true

        return Promise.resolve({ enabled: true, session_id: SESSION })
      }

      return Promise.resolve(summary(enabled))
    })

    mount()

    await waitFor(() => expect(chip().getAttribute('data-state')).toBe('off'))
    fireEvent.click(chip())

    await waitFor(() => expect(chip().getAttribute('data-state')).toBe('on'))
    expect(rest.mock.calls.some(call => call[0] === `/sessions/${SESSION}/mode`)).toBe(true)
  })

  it('hides when the backend has no ambition plugin (404)', async () => {
    rest.mockRejectedValue(new Error('404: {"detail":"No such API endpoint: /api/plugins/ambition/sessions/x"}'))

    mount()

    await waitFor(() => expect(rest.mock.calls.length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ambition' })).toBeNull())
  })

  it('hides on a fresh draft with no stored session to scope to', () => {
    $selectedStoredSessionId.set(null)

    mount()

    expect(screen.queryByRole('button', { name: 'Ambition' })).toBeNull()
    expect(rest.mock.calls.length).toBe(0)
  })
})
