import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n', () => ({
  translateNow: (key: string, ...args: unknown[]) => (args.length ? `${key}:${args.join(',')}` : key)
}))

import { buildMenuBarStatus, MENU_BAR_RECENT_SESSIONS } from './menu-bar-status'
import type { SessionDotState } from './session-dot-state'

const session = (id: string, overrides: { archived?: boolean; preview?: null | string; title?: null | string } = {}) => ({
  archived: false,
  id,
  preview: '',
  title: `Session ${id}`,
  ...overrides
})

describe('buildMenuBarStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports a quiet idle state when nothing is running or waiting', () => {
    const result = buildMenuBarStatus(
      { a: 'idle' as SessionDotState },
      [session('a')]
    )

    expect(result.activeRuns).toBe(0)
    expect(result.needsYou).toBe(0)
    expect(result.strings.statusLine).toBe('menuBar.statusIdle')
  })

  it('counts live turns and background work as active runs', () => {
    const result = buildMenuBarStatus(
      { a: 'working', b: 'stalled', c: 'background', d: 'idle' } as Record<string, SessionDotState>,
      [session('a'), session('b'), session('c'), session('d')]
    )

    expect(result.activeRuns).toBe(3)
    expect(result.strings.statusLine).toBe('menuBar.statusActive:3,0')
  })

  it('counts blocking prompts and unread finishes as needs-you', () => {
    const result = buildMenuBarStatus(
      { a: 'needs-input', b: 'unread', c: 'working' } as Record<string, SessionDotState>,
      [session('a'), session('b'), session('c')]
    )

    expect(result.needsYou).toBe(2)
    expect(result.activeRuns).toBe(1)
    // "needs you" is the badge's whole point — the status line carries it.
    expect(result.strings.statusLine).toBe('menuBar.statusActive:1,2')
  })

  it('excludes archived sessions from counts and the recent list', () => {
    const result = buildMenuBarStatus(
      { a: 'needs-input', b: 'unread' } as Record<string, SessionDotState>,
      [session('a', { archived: true }), session('b')]
    )

    expect(result.needsYou).toBe(1)
    expect(result.sessions.map(row => row.id)).toEqual(['b'])
  })

  it('marks attention states in the recent list and keeps list order', () => {
    const result = buildMenuBarStatus(
      { a: 'needs-input', b: 'idle', c: 'stalled' } as Record<string, SessionDotState>,
      [session('a'), session('b'), session('c')]
    )

    expect(result.sessions.map(row => [row.id, row.attention])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true]
    ])
  })

  it('caps the recent list at the tray-menu limit', () => {
    const sessions = Array.from({ length: MENU_BAR_RECENT_SESSIONS + 3 }, (_, i) => session(`s${i}`))
    const result = buildMenuBarStatus({}, sessions)

    expect(result.sessions).toHaveLength(MENU_BAR_RECENT_SESSIONS)
    expect(result.sessions.map(row => row.id)).toContain('s4')
    expect(result.sessions.map(row => row.id)).not.toContain('s7')
  })

  it('ellipsizes long titles and falls back to preview then id', () => {
    const result = buildMenuBarStatus(
      {},
      [
        session('long', { title: 'x'.repeat(80) }),
        session('prev', { preview: 'the preview text', title: '   ' }),
        session('bare', { preview: '', title: '  ' })
      ]
    )

    expect(result.sessions[0].title.endsWith('…')).toBe(true)
    expect(result.sessions[1].title).toBe('the preview text')
    expect(result.sessions[2].title).toBe('bare')
  })

  it('pushes fully-formed menu strings for the main process', () => {
    const { strings } = buildMenuBarStatus({}, [])

    expect(strings).toEqual({
      newSession: 'menuBar.newSession',
      quickEntry: 'menuBar.quickEntry',
      quit: 'menuBar.quit',
      recentSessions: 'menuBar.recentSessions',
      show: 'menuBar.show',
      statusLine: 'menuBar.statusIdle'
    })
  })
})
