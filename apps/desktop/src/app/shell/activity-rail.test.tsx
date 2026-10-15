// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type AppView, SIDEBAR_NAV_AREA, type SidebarNavContribution } from '@/app/routes'
import { registry } from '@/contrib/registry'
import { I18nProvider } from '@/i18n'
import { type InterfaceMode, setInterfaceMode } from '@/store/interface-mode'
import { $pluginInstallRequest } from '@/store/plugin-install-request'
import { SIDEBAR_NAV_PREFS_AREA } from '@/store/sidebar-nav'

import { ActivityRail } from './activity-rail'

const KANBAN_ID = 'kanban:nav'

let location = { pathname: '', search: '' }

function LocationProbe() {
  location = useLocation()

  return null
}

function renderRail(opts: { mode: InterfaceMode; currentView?: AppView; path?: string }) {
  const onNavigate = vi.fn()

  setInterfaceMode(opts.mode)

  render(
    <MemoryRouter initialEntries={[opts.path ?? '/']}>
      <I18nProvider configClient={null} initialLocale="en">
        <LocationProbe />
        <ActivityRail currentView={opts.currentView ?? 'chat'} onNavigate={onNavigate} />
      </I18nProvider>
    </MemoryRouter>
  )

  return { onNavigate }
}

const railButton = (name: string) => screen.queryByRole('button', { name })

describe('ActivityRail plugin pages', () => {
  let dispose: () => void

  beforeEach(() => {
    dispose = registry.registerMany([
      {
        area: SIDEBAR_NAV_AREA,
        data: {
          codicon: 'project',
          label: 'Kanban',
          path: '/kanban',
          tier: 'advanced'
        } satisfies SidebarNavContribution,
        id: KANBAN_ID
      },
      {
        area: SIDEBAR_NAV_AREA,
        data: { codicon: 'megaphone', label: 'Standup', path: '/standup' } satisfies SidebarNavContribution,
        id: 'standup:nav'
      }
    ])
  })

  afterEach(() => {
    dispose()
    $pluginInstallRequest.set(null)
    setInterfaceMode('advanced')
    cleanup()
  })

  it('puts every plugin page on the Advanced rail beside the built-in pages', () => {
    renderRail({ mode: 'advanced' })

    expect(railButton('Kanban')).not.toBeNull()
    expect(railButton('Standup')).not.toBeNull()
    expect(railButton('Capabilities')).not.toBeNull()
  })

  it('keeps every plugin page on the Simple rail, whatever its tier, and leaves Advanced built-ins off', () => {
    renderRail({ mode: 'simple' })

    expect(railButton('Standup')).not.toBeNull()
    expect(railButton('Kanban')).not.toBeNull()
    expect(railButton('Capabilities')).toBeNull()
  })

  it('navigates to the plugin row it was clicked on', () => {
    const { onNavigate } = renderRail({ mode: 'simple' })

    fireEvent.click(railButton('Kanban')!)

    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: KANBAN_ID, route: '/kanban' }))
  })

  it('marks the plugin row active while its route is on screen', () => {
    renderRail({ mode: 'advanced', path: '/kanban', currentView: 'extension' })

    expect(railButton('Kanban')?.getAttribute('aria-current')).toBe('page')
  })

  it('hides a plugin row the user removed through nav preferences', () => {
    const disposePrefs = registry.register({
      area: SIDEBAR_NAV_PREFS_AREA,
      data: { hide: [KANBAN_ID] },
      id: 'test-prefs'
    })

    renderRail({ mode: 'advanced' })

    expect(railButton('Kanban')).toBeNull()

    disposePrefs()
  })

  it('opens the capabilities plugins tab from the Plugins door', () => {
    renderRail({ mode: 'simple' })

    fireEvent.click(railButton('Plugins')!)

    expect(location.pathname).toBe('/capabilities')
    expect(location.search).toBe('?tab=plugins')
  })

  it('marks the Plugins door active on the capabilities plugins tab, not the Capabilities page', () => {
    renderRail({ mode: 'advanced', path: '/capabilities?tab=plugins', currentView: 'capabilities' })

    expect(railButton('Plugins')?.getAttribute('aria-current')).toBe('page')
    expect(railButton('Capabilities')?.getAttribute('aria-current')).toBeNull()
  })

  it('opens the install request from the Plugins door on right-click', () => {
    renderRail({ mode: 'simple' })

    fireEvent.contextMenu(railButton('Plugins')!)

    expect($pluginInstallRequest.get()).toEqual({ profile: null, repo: '' })
  })
})
