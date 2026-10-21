import { describe, expect, it, vi } from 'vitest'

import {
  buildTrayMenuTemplate,
  DEFAULT_TRAY_STATUS_STRINGS,
  sanitizeTrayStatusPush,
  type TrayMenuActions,
  trayStatusBadge,
  type TrayStatusPush
} from './tray-status'

// MenuItemConstructorOptions.click wants the native (item, window, event) triple;
// our handlers ignore it, so tests invoke through this cast instead.
function clickItem(item: { click?: unknown } | undefined) {
  ;(item?.click as (() => void) | undefined)?.()
}

function push(overrides: Partial<TrayStatusPush> = {}): TrayStatusPush {
  return {
    activeRuns: 0,
    needsYou: 0,
    sessions: [],
    strings: { ...DEFAULT_TRAY_STATUS_STRINGS },
    ...overrides
  }
}

function actions(overrides: Partial<TrayMenuActions> = {}): TrayMenuActions {
  return {
    focusSession: vi.fn(),
    newSession: vi.fn(),
    quit: vi.fn(),
    show: vi.fn(),
    summonQuickEntry: vi.fn(),
    ...overrides
  }
}

describe('sanitizeTrayStatusPush', () => {
  it('rejects anything that is not an object', () => {
    expect(sanitizeTrayStatusPush(null)).toBeNull()
    expect(sanitizeTrayStatusPush('x')).toBeNull()
    expect(sanitizeTrayStatusPush(undefined)).toBeNull()
  })

  it('falls back per-key when the strings block is missing or malformed', () => {
    const result = sanitizeTrayStatusPush(push({ strings: undefined }) as never)

    expect(result?.strings).toEqual(DEFAULT_TRAY_STATUS_STRINGS)
    expect(sanitizeTrayStatusPush({ ...push(), strings: { quit: 5 } })?.strings.quit).toBe(
      DEFAULT_TRAY_STATUS_STRINGS.quit
    )
  })

  it('clamps counts to sane non-negative integers', () => {
    const result = sanitizeTrayStatusPush(push({ activeRuns: -4, needsYou: 99.9 }))

    expect(result?.activeRuns).toBe(0)
    expect(result?.needsYou).toBe(99)
  })

  it('caps the recent-session list and truncates long titles', () => {
    const sessions = Array.from({ length: 12 }, (_, i) => ({
      attention: i % 2 === 0,
      id: `s${i}`,
      title: i === 0 ? 'x'.repeat(120) : `Session ${i}`
    }))

    const result = sanitizeTrayStatusPush(push({ sessions }))

    expect(result?.sessions).toHaveLength(8)
    expect(result?.sessions[0].title).toHaveLength(60)
    expect(result?.sessions[1].attention).toBe(false)
    expect(result?.sessions[2].attention).toBe(true)
  })

  it('drops rows that are not shaped like sessions', () => {
    const result = sanitizeTrayStatusPush(
      push({ sessions: [{ id: 'ok', title: 'Fine' }, 5, { id: 1, title: 'x' }] as never })
    )

    expect(result?.sessions).toEqual([{ attention: false, id: 'ok', title: 'Fine' }])
  })

  it('falls back to the session id when the title is blank', () => {
    const result = sanitizeTrayStatusPush(push({ sessions: [{ attention: false, id: 'id-1', title: '  ' }] }))

    expect(result?.sessions[0].title).toBe('id-1')
  })
})

describe('trayStatusBadge', () => {
  it('is empty when nothing is happening', () => {
    expect(trayStatusBadge(push())).toBe('')
    expect(trayStatusBadge(null)).toBe('')
  })

  it('shows the run count alone', () => {
    expect(trayStatusBadge(push({ activeRuns: 2 }))).toBe('2')
  })

  it('shows the needs-you marker with or without runs', () => {
    expect(trayStatusBadge(push({ needsYou: 3 }))).toBe('!3')
    expect(trayStatusBadge(push({ activeRuns: 1, needsYou: 3 }))).toBe('1 !3')
  })
})

describe('buildTrayMenuTemplate', () => {
  it('lays out status line, recent sessions, and quick actions', () => {
    const template = buildTrayMenuTemplate(
      push({
        sessions: [
          { attention: true, id: 'a', title: 'Work' },
          { attention: false, id: 'b', title: 'Chore' }
        ],
        strings: { ...DEFAULT_TRAY_STATUS_STRINGS, statusLine: '1 running · 1 needs you' }
      }),
      actions()
    )

    const labels = template.map(item => item.label ?? item.type)

    expect(labels[0]).toBe('1 running · 1 needs you')
    expect(labels).toContain('Recent Sessions')
    expect(labels).toContain('● Work')
    expect(labels).toContain('Chore')
    expect(labels).toContain('New Session')
    expect(labels).toContain('Quick Entry')
    expect(labels).toContain('Show Hermes')
    expect(labels).toContain('Quit Hermes')
    // The status line and section header are display-only rows.
    expect(template[0].enabled).toBe(false)
  })

  it('routes a session row click to focusSession with the row id', () => {
    const acts = actions()

    const template = buildTrayMenuTemplate(
      push({ sessions: [{ attention: true, id: 's1', title: 'Blocked job' }] }),
      acts
    )

    const row = template.find(item => item.label === '● Blocked job')

    clickItem(row)
    expect(acts.focusSession).toHaveBeenCalledWith('s1')
  })

  it('routes the quick actions to their handlers', () => {
    const acts = actions()
    const template = buildTrayMenuTemplate(push(), acts)
    const byLabel = (label: string) => template.find(item => item.label === label)

    clickItem(byLabel('New Session'))
    clickItem(byLabel('Quick Entry'))
    clickItem(byLabel('Show Hermes'))
    clickItem(byLabel('Quit Hermes'))

    expect(acts.newSession).toHaveBeenCalledOnce()
    expect(acts.summonQuickEntry).toHaveBeenCalledOnce()
    expect(acts.show).toHaveBeenCalledOnce()
    expect(acts.quit).toHaveBeenCalledOnce()
  })

  it('falls back to the default strings when no push has landed', () => {
    const template = buildTrayMenuTemplate(null, actions())
    const labels = template.map(item => item.label ?? item.type)

    expect(labels).toContain('Hermes')
    expect(labels).toContain('Show Hermes')
    expect(labels).not.toContain('Recent Sessions')
  })

  it('omits the quick-entry item when the feature is off', () => {
    const template = buildTrayMenuTemplate(push(), actions({ summonQuickEntry: null }))

    expect(template.some(item => item.label === 'Quick Entry')).toBe(false)
  })
})
