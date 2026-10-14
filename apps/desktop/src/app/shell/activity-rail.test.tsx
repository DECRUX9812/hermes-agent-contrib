// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'
import { I18nProvider } from '@/i18n'
import { $interfaceMode } from '@/store/interface-mode'

import { SIDEBAR_NAV_AREA, type SidebarNavContribution } from '../routes'

import { ActivityRail } from './activity-rail'

function renderRail() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <I18nProvider configClient={null} initialLocale="en">
        <ActivityRail currentView="chat" onNavigate={() => {}} />
      </I18nProvider>
    </MemoryRouter>
  )
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
        id: 'kanban:nav'
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
    cleanup()
    $interfaceMode.set('advanced')
  })

  it('puts every plugin page on the Advanced rail beside the built-in pages', () => {
    $interfaceMode.set('advanced')
    renderRail()

    expect(railButton('Kanban')).not.toBeNull()
    expect(railButton('Standup')).not.toBeNull()
    expect(railButton('Capabilities')).not.toBeNull()
  })

  it('keeps an untiered plugin page on the Simple rail and leaves Advanced-tier pages off', () => {
    $interfaceMode.set('simple')
    renderRail()

    expect(railButton('Standup')).not.toBeNull()
    expect(railButton('Kanban')).toBeNull()
    expect(railButton('Capabilities')).toBeNull()
  })
})
