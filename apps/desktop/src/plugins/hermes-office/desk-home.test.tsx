/**
 * DeskHome behaviour, with the real api layer bound to a scripted `ctx.rest`
 * (the same door register() hands it):
 *
 *  - the hermes-office backend missing (REST 404) renders the honest
 *    needs-the-plugin state — never mock folders, never a crash;
 *  - a live backend paints its real folders, needs-you queue and recent
 *    workstreams; opening a workstream switches to its view.
 */

import { useValue } from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Test harness supplies the host's locale registration, as plugin loading does.
// eslint-disable-next-line no-restricted-imports
import { registerPluginLocales } from '@/i18n/plugin-i18n'

import { bindDeskApi, type DeskRest } from './api'
import { DeskHome } from './desk-home'
import { DESK_LOCALES } from './i18n'
import { $selectedWorkstream } from './state'
import { WorkstreamView } from './workstream'

// The route component contract plugin.tsx mounts at /desk: home and
// workstream view switch on the selected workstream atom.
function DeskPage() {
  const selected = useValue($selectedWorkstream)

  return selected === null ? <DeskHome /> : <WorkstreamView id={selected} key={selected} />
}

const NOT_FOUND = new Error('404: {"detail":"No such API endpoint: /api/plugins/hermes-office/desk"}')

// Neutral fixture names only (no personal data), per the repo privacy rule.
const deskPayload = {
  folders: [
    {
      counts: { files: 4, needs_you: 1, workstreams: 3 },
      id: 'f1',
      name: 'reports-folder',
      path: '/tmp/desk-fixtures/reports-folder'
    }
  ],
  needs_you: [
    {
      created_at: Date.now() / 1000,
      folder_id: 'f1',
      id: 'w1',
      note: 'Review tracked changes',
      status: 'needs_you',
      title: 'Agreement review',
      updated_at: Date.now() / 1000
    }
  ],
  recent: [
    {
      created_at: Date.now() / 1000,
      folder_id: 'f1',
      id: 'w2',
      status: 'done',
      title: 'Budget recalculation',
      updated_at: Date.now() / 1000
    }
  ]
}

const healthPayload = { engines: { docx: true, pptx: true, xlsx: true }, libreoffice: false, version: '0.1.0' }

let rest: ReturnType<typeof vi.fn>
let disposeLocales: () => void = () => undefined

beforeEach(() => {
  rest = vi.fn()
  bindDeskApi(
    rest as unknown as DeskRest,
    { openExternal: async () => false } as never
  )
  // The harness supplies the host's locale registration, as plugin loading does.
  disposeLocales = registerPluginLocales('hermes-office', DESK_LOCALES)
})

afterEach(() => {
  cleanup()
  disposeLocales()
  $selectedWorkstream.set(null)
})

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeskPage />
    </QueryClientProvider>
  )

describe('DeskHome', () => {
  it('renders the honest needs-the-plugin state when the backend 404s', async () => {
    rest.mockRejectedValue(NOT_FOUND)

    mount()

    expect(await screen.findByText('Desk needs the hermes-office plugin')).toBeTruthy()
    expect(screen.getByText(/does not have the hermes-office plugin/)).toBeTruthy()
    // No fake data alongside the honest state.
    expect(screen.queryByText('reports-folder')).toBeNull()
  })

  it('paints folders, the needs-you queue and recent workstreams from the live desk', async () => {
    rest.mockImplementation((path: string) => {
      if (path === '/desk') {
        return Promise.resolve(deskPayload)
      }

      if (path === '/health') {
        return Promise.resolve(healthPayload)
      }

      return Promise.reject(NOT_FOUND)
    })

    mount()

    expect(await screen.findAllByText('reports-folder')).toBeTruthy()
    expect(screen.getByText('Needs you')).toBeTruthy()
    expect(screen.getByText('Agreement review')).toBeTruthy()
    expect(screen.getByText('4 files')).toBeTruthy()
    expect(screen.getByText('3 requests')).toBeTruthy()
    expect(screen.getByText('Budget recalculation')).toBeTruthy()
    // Every folder/workstream row went through the real REST door.
    expect(rest.mock.calls.some(call => call[0] === '/desk')).toBe(true)
  })

  it('opens a workstream from the recent list into its detail view', async () => {
    rest.mockImplementation((path: string) => {
      if (path === '/desk') {
        return Promise.resolve(deskPayload)
      }

      if (path === '/health') {
        return Promise.resolve(healthPayload)
      }

      if (path === '/workstreams/w2') {
        return Promise.resolve({
          events: [],
          files: [{ kind: 'xlsx', path: '/tmp/desk-fixtures/reports-folder/budget.xlsx', rel: 'budget.xlsx', state: 'changed' }],
          now: null,
          receipts: [],
          workstream: deskPayload.recent[0]
        })
      }

      return Promise.reject(NOT_FOUND)
    })

    mount()

    fireEvent.click(await screen.findByRole('button', { name: /Budget recalculation/ }))

    await waitFor(() => expect($selectedWorkstream.get()).toBe('w2'))
    // Listed in the files column AND opened as the detail header.
    expect(await screen.findAllByText('budget.xlsx')).toBeTruthy()
  })
})
