/**
 * Bot Mode's error containment: a throw inside one surface must not blank the
 * window, and the user must get a Retry rather than an empty pane.
 */
import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { BotModeBoundary } from './bot-mode-boundary'
import { translateBotsIn } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    useI18n: () => ({ t: { common: { retry: 'Retry' } } }),
    usePluginI18n: () => translateBotsIn('en')
  }
})

afterEach(cleanup)

function Boom(): never {
  throw new Error('kaboom')
}

it('keeps the rest of the window alive and offers a retry', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

  render(
    <div>
      <span>sibling rail</span>
      <BotModeBoundary surface="test-surface">
        <Boom />
      </BotModeBoundary>
    </div>
  )

  expect(screen.getByText('Bot Mode hit an error')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  // The failure stayed inside the surface that caused it.
  expect(screen.getByText('sibling rail')).toBeTruthy()
  // And it is attributable in the trace a user's report would carry.
  expect(spy.mock.calls.some(call => String(call[0]).includes('test-surface'))).toBe(true)

  spy.mockRestore()
})
