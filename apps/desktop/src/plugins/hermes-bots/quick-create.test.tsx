/**
 * The one-click New Bot flow. Two contracts:
 *
 *  - The minimal dialog creates a REAL bot: one profiles.create with the
 *    heavyweight dialog's defaults (clone the main profile, share its auth,
 *    no model pin ⇒ the launch model is inherited), then the hermes-bots
 *    ui_meta marker via saveBotMeta, then the canonical Bot Chat with its
 *    intro kickoff.
 *  - A starter pick (dialog chip or the empty roster's one-tap row) seeds the
 *    bot's persona into the generated SOUL and pins the starter's preset —
 *    model `auto` + the preset's skill curation — not just a name.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { BOT_STARTERS, QUICK_STARTERS, starterDraft } from './bot-starters'
import type * as DataModule from './data'
import { translateBots } from './i18n-test-helper'
import type { RosterRow } from './types'

const mocks = vi.hoisted(() => ({
  createCanonicalChat: vi.fn(async () => 'session-1'),
  notify: vi.fn(),
  notifyError: vi.fn(),
  request: vi.fn(),
  saveBotMeta: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const original = await importOriginal<typeof HermesSdk>()

  return {
    ...original,
    host: {
      ...original.host,
      notify: mocks.notify,
      notifyError: mocks.notifyError,
      request: mocks.request
    },
    // The plugin bundle normally lands via `ctx.i18n.register` at load.
    usePluginI18n: () => translateBots
  }
})

vi.mock('./canonical-chat', () => ({ createCanonicalChat: mocks.createCanonicalChat }))
vi.mock('./data', async importOriginal => {
  const original = await importOriginal<typeof DataModule>()

  return { ...original, saveBotMeta: mocks.saveBotMeta }
})

// Each build re-imports the dialog's whole module graph.
vi.setConfig({ testTimeout: 30_000 })

function withQueryClient(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

function createCalls() {
  return mocks.request.mock.calls.filter(([method]) => method === 'profiles.create')
}

beforeAll(async () => {
  // Radix Dialog reaches for APIs jsdom does not implement.
  Element.prototype.scrollIntoView = () => undefined
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.setPointerCapture = () => undefined
  // Warm the transform cache so the first test isn't charged for it.
  await import('./quick-create-dialog')
}, 120_000)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.request.mockImplementation(async (method: string) => {
    switch (method) {
      case 'setup.runtime_check':
        return { ok: true }

      case 'profiles.describe':
        return { skills: [{ name: 'arxiv' }, { name: 'github' }], toolsets: [], mcp_servers: [] }

      default:
        return {}
    }
  })
})

afterEach(() => {
  cleanup()
})

describe('the minimal dialog', () => {
  it('renders name, description, and the starter row', async () => {
    const { QuickCreateDialog } = await import('./quick-create-dialog')

    render(
      withQueryClient(
        <QuickCreateDialog onClose={() => undefined} onConfigureModel={() => undefined} open roster={[]} />
      )
    )

    screen.getByLabelText('Bot name')
    screen.getByText('Description')
    screen.getByText('Start from a template')
    // The general trio — every card that hires with a real preset.
    expect(QUICK_STARTERS.map(starter => starter.id)).toEqual(['scout', 'forge', 'pilot'])
  })

  it('creates the profile and its canonical chat on the heavyweight defaults', async () => {
    const { QuickCreateDialog } = await import('./quick-create-dialog')

    render(withQueryClient(<QuickCreateDialog onClose={() => undefined} open roster={[]} />))

    fireEvent.change(screen.getByLabelText('Bot name'), { target: { value: 'inbox-triage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() => expect(createCalls()).toHaveLength(1))
    expect(createCalls()[0][1]).toMatchObject({
      name: 'inbox-triage',
      clone_from: 'default',
      share_auth: true
    })
    // No model pin — mirror_credentials inherits the launch profile's model.
    expect(createCalls()[0][1]).not.toHaveProperty('model')
    expect(createCalls()[0][1]).not.toHaveProperty('provider')
    // The hermes-bots ui_meta marker — what makes the profile a roster bot.
    expect(mocks.saveBotMeta).toHaveBeenCalledWith('inbox-triage', expect.objectContaining({ imageKind: 'shape' }))
    await waitFor(() => expect(mocks.createCanonicalChat).toHaveBeenCalledWith('inbox-triage', { kickoff: true }))
  })

  it('blocks Create on a taken name', async () => {
    const { QuickCreateDialog } = await import('./quick-create-dialog')
    const roster: RosterRow[] = [{ name: 'scout' }]

    render(withQueryClient(<QuickCreateDialog onClose={() => undefined} open roster={roster} />))

    fireEvent.change(screen.getByLabelText('Bot name'), { target: { value: 'scout' } })

    expect((screen.getByRole('button', { name: 'Create Bot' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    expect(createCalls()).toHaveLength(0)
  })
})

describe('a starter pick', () => {
  it('seeds the persona into the SOUL and pins the preset model', async () => {
    const { QuickCreateDialog } = await import('./quick-create-dialog')
    const scout = BOT_STARTERS.find(starter => starter.id === 'scout')!

    render(withQueryClient(<QuickCreateDialog onClose={() => undefined} open roster={[]} />))

    fireEvent.click(screen.getByRole('button', { name: `${scout.name} — ${scout.title}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))

    await waitFor(() => expect(createCalls()).toHaveLength(1))
    const params = createCalls()[0][1]

    expect(params).toMatchObject({
      name: 'scout',
      // The researcher preset's auto-route pin.
      model: 'auto',
      provider: 'auto'
    })
    // The starter persona lands as the SOUL's Style section.
    expect(String(params.soul)).toContain('## Style')
    expect(String(params.soul)).toContain(scout.persona.split(',')[0])
    // The starter marker + first-prompt suggestions ride the bot's meta.
    expect(mocks.saveBotMeta).toHaveBeenCalledWith(
      'scout',
      expect.objectContaining({
        template: 'scout',
        title: 'Research assistant',
        starters: expect.arrayContaining([scout.starters[0]])
      })
    )
    // Preset skill curation: describe → configure the diff, best-effort.
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        'profiles.configure',
        expect.objectContaining({ name: 'scout', disabled_skills: ['github'] })
      )
    )
  })
})

describe('the one-click path', () => {
  it('runs the whole create without a dialog', async () => {
    const { createQuickBot } = await import('./quick-create')
    const pilot = BOT_STARTERS.find(starter => starter.id === 'pilot')!

    const slug = await createQuickBot(starterDraft(pilot), { roster: [] })

    expect(slug).toBe('pilot')
    expect(createCalls()).toHaveLength(1)
    expect(createCalls()[0][1]).toMatchObject({ name: 'pilot', model: 'auto', provider: 'auto' })
    expect(String(createCalls()[0][1].soul)).toContain(pilot.persona.split(',')[0])
    expect(mocks.createCanonicalChat).toHaveBeenCalledWith('pilot', { kickoff: true })
    // The toast reads the bot's title-cased role line, same as the heavyweight dialog.
    expect(mocks.notify).toHaveBeenLastCalledWith({ kind: 'success', message: 'Bot "Ops & Routines" created' })
  })

  it('creates, skips the intro, and offers model setup when no provider is ready', async () => {
    const { createQuickBot } = await import('./quick-create')
    const notReady = { error: 'No usable credentials found.', ok: false }
    const base = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation(async (method: string, params?: unknown) =>
      method === 'setup.runtime_check' ? notReady : base(method, params)
    )
    const onConfigureModel = vi.fn()

    const slug = await createQuickBot(
      { name: 'Loner', title: '', description: '', persona: '', starters: [], shape: 'blobatar', preset: 'custom' },
      { roster: [], onConfigureModel }
    )

    expect(slug).toBe('loner')
    expect(mocks.createCanonicalChat).toHaveBeenCalledWith('loner', { kickoff: false })

    const toast = mocks.notify.mock.calls.at(-1)![0]

    expect(toast).toMatchObject({ kind: 'warning', detail: notReady.error })
    toast.action.onClick()
    expect(onConfigureModel).toHaveBeenCalledWith(expect.objectContaining({ name: 'loner' }))
  })
})
