import type * as HermesSdk from '@hermes/plugin-sdk'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'
import type { RosterRow } from './types'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, request },
    usePluginI18n: () => translateBots
  }
})

const { queryClient } = await import('@hermes/plugin-sdk')
const { BotIdentitySection, BotMemorySection } = await import('./bot-identity-sections')

const bot = (name: string): RosterRow => ({ name })

const firstIdentity = {
  display_name: 'Profile name',
  instructions: 'First instruction\nSecond instruction\nThird instruction\nFourth instruction',
  model: { default: 'model-a', provider: 'provider-a' },
  profile: 'agent-a',
  revision: 4,
  role: 'Profile role'
}

const memoryList = {
  enabled: { memory: true, user: true },
  entries: [
    { id: 'memory-1', target: 'memory', text: 'Remember this fact' },
    { id: 'user-1', target: 'user', text: 'The user prefers concise replies' }
  ],
  usage: {
    memory: { limit: 2000, used: 41 },
    user: { limit: 2000, used: 33 }
  }
}

function renderSection(section: React.ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{section}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  queryClient.clear()
})

afterEach(() => {
  cleanup()
})

function requestFor(method: string, params: Record<string, unknown>) {
  if (method === 'model.options') {
    return Promise.resolve({ providers: [] })
  }

  if (method === 'fork.bot.identity.get') {
    return Promise.resolve({ ...firstIdentity, profile: String(params.profile) })
  }

  if (method === 'fork.memory.list') {
    return Promise.resolve(structuredClone(memoryList))
  }

  if (method === 'fork.bot.identity.set') {
    return Promise.resolve({
      ...firstIdentity,
      ...params,
      display_name: params.display_name ? 'Server canonical name' : firstIdentity.display_name,
      role: params.role ?? firstIdentity.role,
      applied: { display_name: true, instructions: true, role: true }
    })
  }

  return Promise.reject(new Error(`Unexpected RPC: ${method}`))
}

describe('bot profile identity', () => {
  it('saves inline through the identity RPC and displays the server response', async () => {
    request.mockImplementation(requestFor)
    renderSection(<BotIdentitySection bot={bot('agent-a')} />)

    const currentName = await screen.findByRole('button', { name: 'Name: Profile name' })
    fireEvent.click(currentName)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Draft name' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' })

    await screen.findByRole('button', { name: 'Name: Server canonical name' })
    expect(request).toHaveBeenCalledWith(
      'fork.bot.identity.set',
      expect.objectContaining({
        display_name: 'Draft name',
        expected_revision: 4,
        profile: 'agent-a'
      })
    )
  })

  it('refetches after a stale revision and shows the server value', async () => {
    let reads = 0
    request.mockImplementation((method: string, params: Record<string, unknown>) => {
      if (method === 'fork.bot.identity.get') {
        reads++

        return Promise.resolve({
          ...firstIdentity,
          display_name: reads === 1 ? 'Profile name' : 'Changed on server',
          profile: String(params.profile)
        })
      }

      if (method === 'fork.bot.identity.set') {
        return Promise.reject({ code: 4091, message: 'stale revision' })
      }

      return requestFor(method, params)
    })
    renderSection(<BotIdentitySection bot={bot('agent-a')} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Name: Profile name' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Local edit' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' })

    await screen.findByRole('button', { name: 'Name: Changed on server' })
    expect(await screen.findByText('Changed elsewhere, reloaded')).toBeTruthy()
    expect(reads).toBeGreaterThanOrEqual(2)
  })
})

describe('bot memory', () => {
  it('renders both memory groups, then edits and removes through the matching RPCs', async () => {
    request.mockImplementation((method: string, params: Record<string, unknown>) => {
      if (method === 'fork.memory.update') {
        return Promise.resolve({
          ...memoryList,
          entries: memoryList.entries.map(entry =>
            entry.id === params.id ? { ...entry, text: String(params.text) } : entry
          )
        })
      }

      if (method === 'fork.memory.remove') {
        return Promise.resolve({
          ...memoryList,
          entries: memoryList.entries.filter(entry => entry.id !== params.id)
        })
      }

      return requestFor(method, params)
    })
    renderSection(<BotMemorySection bot={bot('agent-a')} />)

    const memoryHeading = await screen.findByRole('heading', { name: 'What it remembers' })
    const memoryGroup = memoryHeading.closest('section')
    expect(memoryGroup).not.toBeNull()
    expect(within(memoryGroup!).getByText('Remember this fact')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'About you' })).toBeTruthy()
    expect(screen.getByText('41 / 2000')).toBeTruthy()
    expect(screen.getByText('33 / 2000')).toBeTruthy()

    fireEvent.click(within(memoryGroup!).getByRole('button', { name: 'Edit What it remembers' }))
    fireEvent.change(within(memoryGroup!).getByRole('textbox', { name: 'What it remembers' }), {
      target: { value: 'Updated memory' }
    })
    fireEvent.click(within(memoryGroup!).getByRole('button', { name: 'Save' }))

    await screen.findByText('Updated memory')
    expect(request).toHaveBeenCalledWith(
      'fork.memory.update',
      expect.objectContaining({ id: 'memory-1', profile: 'agent-a', text: 'Updated memory' })
    )

    fireEvent.click(within(memoryGroup!).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(memoryGroup!).getByRole('button', { name: 'Yes, remove' }))

    await waitFor(() => expect(within(memoryGroup!).queryByText('Updated memory')).toBeNull())
    expect(request).toHaveBeenCalledWith(
      'fork.memory.remove',
      expect.objectContaining({ id: 'memory-1', profile: 'agent-a' })
    )
  })

  it('does not flash a previous profile while the next profile loads', async () => {
    let finishSecond!: (value: typeof firstIdentity) => void
    request.mockImplementation((method: string, params: Record<string, unknown>) => {
      if (method === 'fork.bot.identity.get' && params.profile === 'agent-b') {
        return new Promise(resolve => {
          finishSecond = resolve
        })
      }

      return requestFor(method, params)
    })
    const view = renderSection(<BotIdentitySection bot={bot('agent-a')} />)
    await screen.findByRole('button', { name: 'Name: Profile name' })

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <BotIdentitySection bot={bot('agent-b')} />
      </QueryClientProvider>
    )

    expect(screen.queryByRole('button', { name: 'Name: Profile name' })).toBeNull()
    expect(screen.getByLabelText('Loading…')).toBeTruthy()

    await act(async () => {
      finishSecond({ ...firstIdentity, display_name: 'Second profile', profile: 'agent-b' })
    })

    expect(await screen.findByRole('button', { name: 'Name: Second profile' })).toBeTruthy()
  })
})
