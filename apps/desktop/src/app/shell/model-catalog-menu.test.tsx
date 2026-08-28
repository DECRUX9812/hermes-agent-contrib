import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import {
  $modelVisibilityOpen,
  $visibleModels,
  modelVisibilityKey,
  setModelVisibilityOpen,
  setVisibleModels
} from '@/store/model-visibility'

import { ModelCatalogMenu, type ModelMenuController } from './model-catalog-menu'

// Radix calls these on open; jsdom doesn't implement them.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

const getGlobalModelOptions = vi.fn()

vi.mock('@/hermes', () => ({
  getGlobalModelOptions: (...args: unknown[]) => getGlobalModelOptions(...args),
  setApiRequestProfile: vi.fn()
}))

beforeEach(() => {
  $visibleModels.set(null)
  setModelVisibilityOpen(false)
  getGlobalModelOptions.mockResolvedValue({
    providers: [{ models: ['gemini-3.1-pro', 'gemini-2.5-flash'], name: 'Google', slug: 'google' }]
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// A minimal controller — these tests are about the CATALOG's own behaviour
// (what it lists, what it offers), not about what any host does with a pick.
function renderMenu() {
  const select = vi.fn()

  const controller: ModelMenuController = {
    applyPreset: vi.fn(),
    current: { effort: '', fast: false, model: '', provider: '' },
    presetFor: () => ({}),
    select,
    setOptions: vi.fn()
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={client}>
      <DropdownMenu open>
        <DropdownMenuContent>
          <ModelCatalogMenu controller={controller} />
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>
  )

  return select
}

// Curation is ONE global preference, so it belongs to the catalog rather than
// to whichever surface mounted it. If a host had to opt in, the composer and
// the kanban board would end up disagreeing about what "my models" means —
// which is exactly the drift extracting this component was meant to prevent.
describe('the catalog owns model curation', () => {
  it('honours the stored Edit Models shortlist', async () => {
    setVisibleModels(new Set([modelVisibilityKey('google', 'gemini-2.5-flash')]))

    renderMenu()

    await screen.findByText(/Gemini 2\.5 Flash/i)
    expect(screen.queryByText(/Gemini 3\.1 Pro/i)).toBeNull()
  })

  it('still finds a hidden model by search — curation narrows the default view, not the catalog', async () => {
    setVisibleModels(new Set([modelVisibilityKey('google', 'gemini-2.5-flash')]))

    renderMenu()
    await screen.findByText(/Gemini 2\.5 Flash/i)

    const input = screen.getByRole('textbox', { name: 'Search models' })

    fireEvent.change(input, { target: { value: 'gemini-3.1' } })

    await vi.waitFor(() => {
      expect(screen.queryByText(/Gemini 3\.1 Pro/i)).not.toBeNull()
    })
  })

  it('offers Edit Models without the host wiring it up', async () => {
    renderMenu()
    await screen.findByText(/Gemini 3\.1 Pro/i)

    fireEvent.click(screen.getByText('Edit Models…'))

    expect($modelVisibilityOpen.get()).toBe(true)
  })
})

// Pricing rides the SAME model.options payload the menu already fetches
// (`provider.pricing[model]`, live $/Mtok where the provider publishes it) —
// the composer dropdown renders it as compact right-side chrome, matching the
// ⌘M Switch-model dialog.
describe('catalog rows show live pricing when the backend sends it', () => {
  function renderMenuWithProviders(providers: unknown[]) {
    const controller: ModelMenuController = {
      applyPreset: vi.fn(),
      current: { effort: '', fast: false, model: '', provider: '' },
      presetFor: () => ({}),
      select: vi.fn(),
      setOptions: vi.fn()
    }

    getGlobalModelOptions.mockResolvedValue({ providers })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <DropdownMenu open>
          <DropdownMenuContent>
            <ModelCatalogMenu controller={controller} />
          </DropdownMenuContent>
        </DropdownMenu>
      </QueryClientProvider>
    )
  }

  it('renders $/Mtok prices, Free badges, and sale discounts', async () => {
    renderMenuWithProviders([
      {
        name: 'OpenRouter',
        slug: 'openrouter',
        models: ['lab/paid', 'lab/freebie', 'lab/sale'],
        pricing: {
          'lab/freebie': { input: 'free', output: '', cache: null, free: true },
          'lab/paid': { input: '$3.00', output: '$15.00', cache: null, free: false },
          'lab/sale': {
            cache: '$0.10',
            discount_percent: 50,
            free: false,
            input: '$1.00',
            output: '$5.00',
            was_input: '$2.00',
            was_output: '$10.00'
          }
        }
      },
      // No pricing key → clean rows, no price chrome.
      { name: 'Local Vision', slug: 'local-vision', models: ['local-8b'] }
    ])

    await screen.findByText('$3.00 / $15.00')
    expect(screen.getByText('Free')).not.toBeNull()
    expect(screen.getByText('-50%')).not.toBeNull()
    // Paid rows advertise the per-Mtok basis; sale rows add the cached-input
    // rate to the same tooltip.
    const paidTitle = screen.getByText('$3.00 / $15.00').closest('[title]')?.getAttribute('title') ?? ''
    expect(paidTitle).toContain('per million tokens')
    expect(paidTitle).not.toContain('cached input')
    const saleTag = screen.getByText('-50%').closest('[title]')
    expect(saleTag?.getAttribute('title')).toContain('cached input: $0.10')
  })

  it('keeps rows clean when pricing data is absent', async () => {
    renderMenuWithProviders([{ name: 'Local Vision', slug: 'local-vision', models: ['local-8b'] }])

    await screen.findByText(/Local 8b/i)
    expect(screen.queryByText(/\/ Mtok|Free|\$/)).toBeNull()
  })
})
