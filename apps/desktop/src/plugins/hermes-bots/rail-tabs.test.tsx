import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as BotsI18n from './i18n'
import { translateBots } from './i18n-test-helper'
import type { RailTabId } from './rail-state'
import { RailTabs } from './rail-tabs'

vi.mock('./i18n', async importOriginal => {
  const actual = await importOriginal<typeof BotsI18n>()

  return { ...actual, useBots: () => actual.BOTS_LOCALES.en }
})

function Tabs() {
  const [tab, setTab] = useState<RailTabId>('activity')

  return <RailTabs badges={{ approvals: 3 }} onChange={setTab} value={tab} />
}

afterEach(cleanup)

describe('rail navigation', () => {
  it('names every destination and keeps one tab in the document tab order', () => {
    render(<Tabs />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Activity', 'Approvals3', 'Scheduled', 'Bot'])
    expect(tabs.filter(tab => tab.tabIndex === 0)).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Approvals (3)' }).getAttribute('aria-controls')).toBe(
      'rail-panel-approvals'
    )
  })

  it('moves focus and selection together with arrows, Home and End', () => {
    render(<Tabs />)
    const activity = screen.getByRole('tab', { name: translateBots('activity.tabs.activity') })
    activity.focus()
    fireEvent.keyDown(activity, { key: 'ArrowDown' })
    const scheduled = screen.getByRole('tab', { name: 'Scheduled' })
    expect(window.document.activeElement).toBe(scheduled)
    expect(scheduled.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(scheduled, { key: 'End' })
    const bot = screen.getByRole('tab', { name: 'Bot' })
    expect(window.document.activeElement).toBe(bot)
    fireEvent.keyDown(bot, { key: 'ArrowRight' })
    expect(window.document.activeElement).toBe(activity)
    fireEvent.keyDown(activity, { key: 'End' })
    fireEvent.keyDown(bot, { key: 'Home' })
    expect(window.document.activeElement).toBe(activity)
  })
})
