/**
 * A plugin page path whose route has not registered yet (async disk plugins:
 * cold boot on `/team`, a hot reload, a click in the reload window) must not
 * parse as a session id. It used to: `/team` became the session "team", the
 * workspace flashed an empty "New session" with a resume spinner, then fell
 * back to a fresh chat.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'

import { appViewForPath, resetKnownPagePathsForTest, routeSessionId } from '../routes'

import { ChatRoutesSurface } from './surfaces'
import type { WiringActions } from './types'

vi.mock('@/store/connections', () => ({ $activeConnectionId: atom('local') }))
vi.mock('@/store/gateway', () => ({ $gateway: atom<unknown>(null) }))
vi.mock('@/store/profile', () => ({ $activeGatewayProfile: atom('default') }))
vi.mock('@/store/session', () => ({
  $freshDraftReady: atom(false),
  $gatewayState: atom('open')
}))
vi.mock('../chat', () => ({ ChatView: () => <div data-testid="chat-view" /> }))
vi.mock('../chat/sidebar', () => ({ ChatSidebar: () => null }))
vi.mock('../right-sidebar/terminal/chrome', () => ({ TerminalPaneChrome: () => null }))
vi.mock('../shell/hooks/use-status-snapshot', () => ({ useStatusSnapshot: () => ({}) }))
vi.mock('../shell/hooks/use-statusbar-items', () => ({
  useStatusbarItems: () => ({ leftStatusbarItems: [], statusbarItems: [] })
}))
vi.mock('../shell/statusbar-controls', () => ({ StatusbarControls: () => null }))
vi.mock('./latest-actions', () => ({ latestChatActions: () => ({}), latestSidebarActions: () => ({}) }))
vi.mock('./panes', () => ({ setStatusbarItemGroup: vi.fn(), useStatusbarContributions: () => [] }))
vi.mock('../shell/model-menu-panel', () => ({ ModelMenuPanel: () => null }))
vi.mock('../shell/reasoning-menu-panel', () => ({ ReasoningMenuPanel: () => null }))

const KEY = 'hermes.desktop.knownPagePaths'
const disposers: Array<() => void> = []

beforeEach(() => {
  localStorage.removeItem(KEY)
  resetKnownPagePathsForTest()
})

afterEach(() => {
  act(() => disposers.splice(0).forEach(dispose => dispose()))
  cleanup()
  vi.useRealTimers()
})

const actions = {} as unknown as WiringActions

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChatRoutesSurface actions={actions} />
    </MemoryRouter>
  )
}

function registerNav(path: string) {
  disposers.push(registry.register({ area: 'sidebar.nav', id: `nav${path}`, data: { codicon: 'organization', label: 'Team', path } }))
}

function registerPage(path: string) {
  disposers.push(
    registry.register({ area: 'routes', id: `page${path}`, data: { path }, render: () => <div data-testid="team-page" /> })
  )
}

describe('pending plugin pages', () => {
  it('holds a nav-contributed path as a page placeholder until its route lands', () => {
    act(() => registerNav('/team'))
    const { container } = at('/team')

    expect(screen.queryByTestId('chat-view')).toBeNull()
    expect(container.querySelector('[data-slot=pending-page]')).toBeTruthy()
    expect(routeSessionId('/team')).toBeNull()
    expect(appViewForPath('/team')).toBe('extension')

    act(() => registerPage('/team'))

    expect(screen.getByTestId('team-page')).toBeTruthy()
    expect(container.querySelector('[data-slot=pending-page]')).toBeNull()
  })

  it('remembers contributed paths across loads so a cold boot on the page never opens a chat', () => {
    act(() => registerPage('/team'))
    at('/team').unmount()
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toContain('/team')

    act(() => disposers.splice(0).forEach(dispose => dispose()))
    resetKnownPagePathsForTest()
    const { container } = at('/team')

    expect(screen.queryByTestId('chat-view')).toBeNull()
    expect(container.querySelector('[data-slot=pending-page]')).toBeTruthy()
  })

  it('forgets a remembered path that never re-registers and falls back to a new chat', () => {
    vi.useFakeTimers()
    localStorage.setItem(KEY, JSON.stringify(['/gone']))
    resetKnownPagePathsForTest()
    at('/gone')

    expect(screen.queryByTestId('chat-view')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(12_500)
    })

    expect(screen.getByTestId('chat-view')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).not.toContain('/gone')
  })

  it('leaves real session ids alone', () => {
    act(() => registerNav('/team'))
    at('/20261026_120000_abcdef')

    expect(screen.getByTestId('chat-view')).toBeTruthy()
    expect(routeSessionId('/20261026_120000_abcdef')).toBe('20261026_120000_abcdef')
  })
})
