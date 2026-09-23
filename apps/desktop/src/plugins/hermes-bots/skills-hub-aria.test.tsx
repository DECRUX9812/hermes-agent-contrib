/**
 * The "✓ added" marker on an installed hub-skill row renders its checkmark
 * as bare text, so a screen reader announces the glyph instead of just
 * "added". The glyph is decorative — it must live in an aria-hidden subtree
 * and leave "added" as the accessible text.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  notifyError: vi.fn(),
  request: vi.fn(async (_method: string, params: Record<string, unknown>) =>
    params.action === 'search' ? { results: [{ description: 'Search the web', name: 'web-research' }] } : {}
  )
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
    }
  }
})

const { HubSkillsSection } = await import('./skills-hub')

afterEach(cleanup)

describe('HubSkillsSection decorative glyphs', () => {
  it('keeps the checkmark out of the accessibility tree on the "added" row', async () => {
    const { container } = render(<HubSkillsSection />)

    fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value: 'web' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: /Install "web-research"/ }))

    // The row reads "added" — the ✓ is decorative and aria-hidden.
    const marker = await screen.findByText('added')
    expect(marker.closest('[aria-hidden="true"]')).toBeNull()
    expect(screen.getByText('✓').closest('[aria-hidden="true"]')).not.toBeNull()
  })
})
