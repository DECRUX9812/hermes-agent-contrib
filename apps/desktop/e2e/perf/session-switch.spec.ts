/**
 * Perf baseline: session switch latency — click a rail row to the moment its
 * transcript is interactive, over a home seeded with 60 closed sessions.
 *
 * Numbers: `PERF[session_switch.p50]` etc. quoted in docs/revamp/baseline.md.
 */

import { expect, type Page } from '@playwright/test'

import { test } from '../test'

import { bootstrapDbForSeeds, insertSessions } from './fixture-generator'
import { reportMetric, reportStats, summarize } from './metrics'
import { launchPerfApp } from './perf-harness'

const SESSION_A = 'perf switch target alpha'
const SESSION_B = 'perf switch target beta'
const SWITCHES = 6

function sessionRow(page: Page, title: string) {
  return page.locator('[data-slot="sidebar"] button').filter({ hasText: title }).first()
}

test('session switch latency over a 60-session home', // eslint-disable-next-line no-empty-pattern
  async ({}, testInfo) => {
  const fixture = await launchPerfApp({
    seed: async (hermesHome) => {
      const db = bootstrapDbForSeeds(hermesHome)
      insertSessions(db, { count: 29, idPrefix: 'filler-a', titlePrefix: 'perf filler a' })
      insertSessions(db, {
        count: 1,
        idPrefix: 'target-a',
        titlePrefix: SESSION_A,
        pairs: 3,
      })
      insertSessions(db, {
        count: 1,
        idPrefix: 'target-b',
        titlePrefix: SESSION_B,
        pairs: 3,
      })
      insertSessions(db, { count: 29, idPrefix: 'filler-b', titlePrefix: 'perf filler b' })
    },
  })

  const { page } = fixture

  try {
    const viewport = page.locator('[data-slot="aui_thread-viewport"]')

    // First click pays transcript mount; measure that separately from the
    // steady-state alternating switches.
    const tOpen = Date.now()
    await sessionRow(page, SESSION_A).click()
    await expect(viewport).toContainText(`${SESSION_A} 0 reply`)
    const openMs = Date.now() - tOpen

    const deltas: number[] = []

    for (let i = 0; i < SWITCHES; i += 1) {
      const fromA = i % 2 === 0
      const title = fromA ? SESSION_B : SESSION_A
      // Sidebar rows remount on every list refresh; a click can land on a
      // detached node and do nothing. A swallowed click isn't latency — retry
      // it and measure from the click that actually took.
      let t0 = Date.now()
      let took = false

      for (let attempt = 0; attempt < 3 && !took; attempt += 1) {
        await sessionRow(page, title).click()
        took = await viewport
          .getByText(`${title} 0 reply`, { exact: false })
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then(() => true)
          .catch(() => false)

        if (!took) {t0 = Date.now()}
      }

      if (!took) {
        throw new Error(`session switch to ${JSON.stringify(title)} never took after 3 clicks`)
      }

      deltas.push(Date.now() - t0)
    }

    const stats = summarize(deltas)
    await reportStats(testInfo, 'session_switch', stats)
    await reportMetric(testInfo, 'session_switch.first_open', openMs)
  } finally {
    await fixture.cleanup()
  }
})
