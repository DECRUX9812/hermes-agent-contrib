import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { StatusbarControls, type StatusbarItem } from '@/app/shell/statusbar-controls'
import { CHROME_PLUGIN_ROWS } from '@/contrib/chrome'
import { $statusbarHiddenIds, $statusbarVisible, STATUSBAR_HIDDEN_BY_DEFAULT } from '@/store/statusbar-prefs'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

beforeAll(() => {
  stubResizeObserver()
  stubMenuDomApis()
})

afterEach(() => {
  cleanup()
  $statusbarHiddenIds.set([...STATUSBAR_HIDDEN_BY_DEFAULT])
  $statusbarVisible.set(true)
})

const core = (id: string, label: string): StatusbarItem => ({ id, label, toggleLabel: label, variant: 'action' })

const pluginChip = (plugin: string, n: number): StatusbarItem => ({
  id: `${plugin}:chip-${n}`,
  label: `${plugin} ${n}`,
  plugin,
  variant: 'action'
})

function bar(items: StatusbarItem[]) {
  render(
    <MemoryRouter>
      <StatusbarControls items={items} />
    </MemoryRouter>
  )

  return screen.getByRole('contentinfo')
}

describe('statusbar plugin budget', () => {
  it('keeps every core chip inline and overflows plugin chips past the budget', () => {
    const items = [core('model', 'Model'), core('version-client', 'Version'), ...Array.from({ length: 5 }, (_, i) => pluginChip('ext', i))]
    const statusbar = bar(items)

    // Core never counts against the plugin budget.
    expect(screen.getByText('Model')).toBeTruthy()
    expect(screen.getByText('Version')).toBeTruthy()

    const inlinePlugins = statusbar.querySelectorAll('[data-plugin-id]')
    expect(inlinePlugins).toHaveLength(CHROME_PLUGIN_ROWS)

    // The remainder is reachable, not silently clipped.
    const overflow = statusbar.querySelector('[data-slot="statusbar-overflow"]')
    expect(overflow?.getAttribute('aria-label')).toBe(`${5 - CHROME_PLUGIN_ROWS} more status items`)
  })

  it('attributes plugin chips so the DOM can name the owner', () => {
    const statusbar = bar([pluginChip('hermes-teams', 0), core('model', 'Model')])
    const attributed = statusbar.querySelector('[data-plugin-id="hermes-teams"]')

    expect(attributed).not.toBeNull()
    expect(attributed?.textContent).toContain('hermes-teams 0')
    // A core chip carries no attribution.
    expect(statusbar.querySelector('[data-plugin-id]')?.textContent).not.toContain('Model')
  })

  it('offers "Disable ⟨plugin⟩" from the bar menu, naming the plugin', async () => {
    const statusbar = bar([pluginChip('hermes-teams', 0), pluginChip('hermes-teams', 1)])

    fireEvent.pointerDown(statusbar, { button: 2, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.contextMenu(statusbar, { button: 2 })

    // One row per plugin, with the item count, spelled the way a user reads it.
    expect(await screen.findByRole('menuitem', { name: /Disable Hermes Teams \(2 items\)/ })).toBeTruthy()
  })

  it('does not render an overflow affordance when nothing is over budget', () => {
    const statusbar = bar([pluginChip('ext', 0), core('model', 'Model')])

    expect(statusbar.querySelector('[data-slot="statusbar-overflow"]')).toBeNull()
  })
})
