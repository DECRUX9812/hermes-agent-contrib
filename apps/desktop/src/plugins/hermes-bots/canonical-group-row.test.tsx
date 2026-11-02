/**
 * A gateway room row: the name a screen reader hears must be everything the
 * row shows — room, member count, and the state the pulsing dot only decorates.
 */
import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { atom: nanoAtom } = await import('nanostores')

  return {
    ...sdk,
    host: {
      ...sdk.host,
      notify: vi.fn(),
      notifyError: vi.fn(),
      state: { ...sdk.host.state, focusedSessionOwner: nanoAtom(null) }
    },
    usePluginI18n: () => translateBots
  }
})

const { CanonicalGroupRow } = await import('./canonical-group-row')

afterEach(cleanup)

const renderRow = (props: Partial<Parameters<typeof CanonicalGroupRow>[0]> = {}) =>
  render(<CanonicalGroupRow memberCount={3} name="Design Room" onDelete={vi.fn(async () => undefined)} onOpen={vi.fn()} {...props} />)

it('names the room and its member count, not just the room', () => {
  renderRow()

  // A row-level aria-label used to replace the content, so AT heard only
  // "Design Room" and never "3 members".
  const row = screen.getByRole('button', { name: /Design Room/ })
  expect(row.textContent).toContain('3')
  expect(row.getAttribute('aria-label')).toBeNull()
})

it('speaks the running state the dot only decorates', () => {
  renderRow({ running: true })

  expect(screen.getByRole('button', { name: /Design Room/ }).textContent).toContain('Working')
  // Honours reduced motion: the pulse is decoration, not information.
  expect(screen.getByRole('button', { name: /Design Room/ }).querySelector('[data-slot="row-running-dot"]')?.className).toContain('motion-reduce:animate-none')
})

it('speaks a pending prompt in words', () => {
  renderRow({ needsYou: true })

  expect(screen.getByRole('button', { name: /Design Room/ }).textContent).toMatch(/needs your input/i)
})
