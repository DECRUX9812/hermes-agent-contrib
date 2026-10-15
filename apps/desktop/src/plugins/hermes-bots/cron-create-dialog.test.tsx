/** The routine editor writes through the profile-scoped fork.routines RPCs. */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

const { notify, request } = vi.hoisted(() => ({
  notify: vi.fn(),
  request: vi.fn(async (_method: string, _params: Record<string, unknown>) => ({ routines: [] }))
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, notify, request },
    usePluginI18n: () => translateBots
  }
})

const { $botMeta } = await import('./data')
const { CreateRoutineDialog } = await import('./cron')

function fillScheduleFields() {
  fireEvent.change(screen.getByPlaceholderText('Morning briefing'), { target: { value: 'Morning digest' } })
  fireEvent.change(screen.getByPlaceholderText(/Summarize my unread Slack threads/), {
    target: { value: 'Summarize yesterday.' }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  $botMeta.set({})
})

afterEach(() => cleanup())

describe('routine form', () => {
  it('uses the bot display name when given an owner row or profile name', () => {
    $botMeta.set({ ops: { title: 'Ops Bot' } })
    const view = render(<CreateRoutineDialog bot={{ name: 'ops' }} onClose={() => undefined} open />)
    expect(view.getByRole('dialog').textContent).toContain('Ops Bot')
    view.rerender(<CreateRoutineDialog bot="ops" onClose={() => undefined} open />)
    expect(view.getByRole('dialog').textContent).not.toContain('[object Object]')
  })

  it('creates a schedule routine on the bot profile', async () => {
    render(<CreateRoutineDialog bot={{ name: 'ops' }} onClose={() => undefined} open />)
    fillScheduleFields()
    fireEvent.click(screen.getByRole('button', { name: 'Create cron' }))

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'fork.routines.create',
        expect.objectContaining({
          kind: 'schedule',
          name: 'Morning digest',
          profile: 'ops',
          prompt: 'Summarize yesterday.',
          schedule: '0 9 * * *'
        })
      )
    )
  })

  it('creates a watch routine with a condition and no prompt', async () => {
    render(<CreateRoutineDialog bot={{ name: 'ops' }} onClose={() => undefined} open />)
    fireEvent.change(screen.getByPlaceholderText('Morning briefing'), { target: { value: 'Watch releases' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when' }))
    fireEvent.change(screen.getByPlaceholderText('Tell the bot what change or event to watch for…'), {
      target: { value: 'A new release is published.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create cron' }))

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'fork.routines.create',
        expect.objectContaining({
          condition: 'A new release is published.',
          kind: 'watch',
          name: 'Watch releases',
          profile: 'ops',
          schedule: '0 9 * * *'
        })
      )
    )
    expect(request.mock.calls[0]?.[1]).not.toHaveProperty('prompt')
  })

  it('prefills an autopilot schedule and persists the selected prompt', async () => {
    const preset = {
      deliverToChat: true,
      instruction: 'Brief me for the day.',
      schedule: { freq: 'weekdays' as const, time: '8:0' },
      title: 'Morning brief'
    }

    render(<CreateRoutineDialog bot={{ name: 'ops' }} onClose={() => undefined} open preset={preset} />)
    expect(screen.getByDisplayValue('Morning brief')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^create/i }))

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'fork.routines.create',
        expect.objectContaining({
          kind: 'schedule',
          name: 'Morning brief',
          profile: 'ops',
          prompt: 'Brief me for the day.',
          schedule: '0 8 * * 1-5'
        })
      )
    )
  })
})
