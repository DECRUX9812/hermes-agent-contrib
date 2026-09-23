// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WebhookRoute } from '@/types/hermes'

const getWebhooks = vi.fn()
const createWebhook = vi.fn()
const deleteWebhook = vi.fn()
const enableWebhooks = vi.fn()
const setWebhookEnabled = vi.fn()

vi.mock('@/hermes', () => ({
  createWebhook: (body: unknown) => createWebhook(body),
  deleteWebhook: (name: string) => deleteWebhook(name),
  enableWebhooks: () => enableWebhooks(),
  getProfiles: vi.fn(async () => ({ profiles: [] })),
  getWebhooks: () => getWebhooks(),
  hermesApi: vi.fn(async () => ({ active: 'default', current: 'default' })),
  setApiRequestProfile: vi.fn(),
  setWebhookEnabled: (name: string, enabled: boolean) => setWebhookEnabled(name, enabled),
  STARTUP_REQUEST_TIMEOUT_MS: 1000
}))

// Keep store/profile's side-effecting imports inert — same seam as
// settings/profile-scope.test.tsx.
vi.mock('@/store/gateway', () => ({
  $gateway: { get: () => null, subscribe: () => () => {} },
  activeGatewayConnectionId: () => null,
  activeGatewayProfileKey: () => 'default',
  ensureGatewayForAgent: vi.fn(async () => undefined),
  ensureGatewayForProfile: vi.fn(async () => undefined),
  openGatewayForAgent: vi.fn(async () => undefined),
  openGatewayForProfile: vi.fn(async () => undefined),
  openSecondaryCount: { get: () => 0, subscribe: () => () => {} }
}))
vi.mock('@/lib/query-client', () => ({ invalidateProfileScopedQueries: vi.fn() }))
vi.mock('@/store/starmap', () => ({ resetStarmapGraph: vi.fn() }))
vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))
vi.mock('@/store/system-actions', async () => {
  const { atom } = await import('nanostores')

  return {
    $gatewayRestarting: atom(false),
    runGatewayRestart: vi.fn(async () => true)
  }
})

const { $activeGatewayProfile, $showAllProfiles } = await import('@/store/profile')
const { WebhooksView } = await import('./index')

function sub(name: string): WebhookRoute {
  return {
    created_at: null,
    deliver: 'log',
    deliver_only: false,
    description: '',
    enabled: true,
    events: [],
    name,
    prompt: '',
    secret_set: true,
    skills: [],
    url: `https://example.invalid/hooks/${name}`
  }
}

const render = (ui: ReactElement) =>
  rtlRender(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  )

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.setPointerCapture ??= () => undefined
  HTMLElement.prototype.scrollIntoView ??= () => undefined
})

beforeEach(() => {
  $showAllProfiles.set(false)
  $activeGatewayProfile.set('alpha')
  getWebhooks.mockResolvedValue({ base_url: '', enabled: true, subscriptions: [sub('x')] })
  deleteWebhook.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  $activeGatewayProfile.set('default')
})

describe('WebhooksView profile scope', () => {
  it('dismisses the pending delete when the profile scope switches, instead of firing it at the new profile', async () => {
    // The REST helpers resolve the CURRENT profile at call time
    // (api/messaging.ts -> profileScoped()), so a delete confirm that survives
    // a scope switch fires against the NEW profile's backend — a same-named
    // webhook there is deleted (#71352). The pending mutation must be dropped
    // with the scope it was armed under.
    await act(async () => {
      render(<WebhooksView onClose={() => {}} />)
    })

    // Arm the delete confirm for webhook 'x' under profile alpha.
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Actions' }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse'
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(await screen.findByText('Delete webhook')).toBeTruthy()

    // Switch the active profile; the view re-homes onto profile beta.
    await act(async () => {
      $activeGatewayProfile.set('beta')
    })
    await waitFor(() => expect(getWebhooks).toHaveBeenCalledTimes(2))

    // The dialog armed under alpha must be gone — nothing may fire the
    // pending delete against beta's backend.
    expect(screen.queryByText('Delete webhook')).toBeNull()
    expect(deleteWebhook).not.toHaveBeenCalled()
  })
})
