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

const KANBAN_ID = 'test-plugin:kanban'

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

describe('ActivityRail plugin section', () => {
  let disposers: (() => void)[] = []

  beforeEach(() => {
    disposers = [
      registry.register({
        area: SIDEBAR_NAV_AREA,
        data: {
          codicon: 'project',
          label: 'Kanban',
          path: '/kanban',
          tier: 'advanced'
        } satisfies SidebarNavContribution,
        id: KANBAN_ID
      })
    ]
  })

  afterEach(() => {
    disposers.forEach(dispose => dispose())
    disposers = []
    $pluginInstallRequest.set(null)
    setInterfaceMode('advanced')
    cleanup()
  })

  it.each<InterfaceMode>(['simple', 'advanced'])('shows a contributed plugin row in %s mode', mode => {
    renderRail({ mode })

    expect(railButton('Kanban')).not.toBeNull()
  })

  it('navigates to the plugin row it was clicked on', () => {
    const { onNavigate } = renderRail({ mode: 'simple' })

    fireEvent.click(railButton('Kanban')!)

    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: KANBAN_ID, route: '/kanban' }))
  })

  it('marks the plugin row active while its route is on screen', () => {
    renderRail({ mode: 'simple', path: '/kanban', currentView: 'extension' })

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

  it('marks the Plugins door active on the capabilities plugins tab', () => {
    renderRail({ mode: 'simple', path: '/capabilities?tab=plugins', currentView: 'capabilities' })

    expect(railButton('Plugins')?.getAttribute('aria-current')).toBe('page')
  })

  it('opens the install request from the Plugins door on right-click', () => {
    renderRail({ mode: 'simple' })

    fireEvent.contextMenu(railButton('Plugins')!)

    expect($pluginInstallRequest.get()).toEqual({ profile: null, repo: '' })
  })
})
