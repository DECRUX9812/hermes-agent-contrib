/**
 * Perf baseline: a 500-session rail across three profiles.
 *
 * Seeds profiles alpha/beta/gamma (167 + 167 + 166 closed sessions), boots
 * the app, switches the rail to "Show all profiles", and measures how long
 * the grouped rail takes to materialize plus frame pacing while scrolling
 * the virtualized list to the bottom.
 */

import { expect } from '@playwright/test'

import { test } from '../test'

import { seedSessionRail } from './fixture-generator'
import {
  reportMetric,
  reportStats,
  startFrameSampler,
  stopFrameSampler,
  summarize,
} from './metrics'
import { launchPerfApp } from './perf-harness'

const PROFILES = ['alpha', 'beta', 'gamma']

test('500-session rail across 3 profiles', // eslint-disable-next-line no-empty-pattern
  async ({}, testInfo) => {
  test.setTimeout(600_000)

  const fixture = await launchPerfApp({
    seed: async (hermesHome, mockUrl) => {
      await seedSessionRail(hermesHome, PROFILES, 167, mockUrl)
      // 167*3 = 501 seeded rows total.
    },
  })

  const { page } = fixture

  try {
    const sidebar = page.locator('[data-slot="sidebar"]')

    // Switch the rail into the all-profiles grouped view. The "Show all
    // profiles" pill only exists while the default profile is active; a seeded
    // profile may win "most recent activity" at boot, so route home first.
    const showAll = page.getByRole('button', { name: 'Show all profiles' })

    if (!(await showAll.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Switch to default' }).click()
    }

    const t0 = Date.now()
    await showAll.click()

    // A seeded named profile can leave the onboarding glass up (no provider
    // configured in that profile's home); it intercepts rail clicks, so
    // dismiss it when present.
    const later = page.getByRole('button', { name: "I'll choose a provider later" })

    if (await later.isVisible().catch(() => false)) {
      await later.click()
    }

    // All-profiles alone renders one flat interleaved list; the per-owner
    // groups only materialize once grouping is set to "Gateway & profile".
    await page.getByRole('button', { name: 'Filters' }).click()
    const groupingSub = page.getByRole('menuitem', { name: /^Grouping/ })
    await groupingSub.hover()
    await page.waitForTimeout(300)

    if (!(await page.getByRole('menuitemradio', { name: 'Gateway & profile' }).isVisible().catch(() => false))) {
      await groupingSub.click()
    }

    await page.getByRole('menuitemradio', { name: 'Gateway & profile' }).click()
    await page.keyboard.press('Escape')

    for (const profile of PROFILES) {
      await expect(sidebar.locator(`[data-gateway-group*="${profile}"]`).first()).toBeVisible()
    }

    await reportMetric(testInfo, 'session_rail.grouped_render', Date.now() - t0)

    const rows = sidebar.getByRole('button', { name: /perf rail / })
    await reportMetric(testInfo, 'session_rail.rendered_rows', await rows.count(), 'rows')

    // Groups render a 5-row window each and grow via a "Show N more in
    // <profile>" control. Fully expanding all three IS the 500-row render the
    // wave cares about — walk them all open, then scroll to the list bottom.
    const showMore = sidebar.getByRole('button', { name: /Show \d+ more in / })
    const loadMore = sidebar.getByRole('button', { name: /Load( \d+)? more/ })
    const tExpand = Date.now()
    let expandClicks = 0

    for (;;) {
      if (await showMore.first().isVisible().catch(() => false)) {
        // Always click the FIRST control: expanding a group grows the list and
        // remounts later buttons, so nth(i) handles go stale mid-loop.
        await showMore.first().click()
        expandClicks += 1
      } else if (await loadMore.first().isVisible().catch(() => false)) {
        await loadMore.first().click()
        expandClicks += 1
        await page.waitForTimeout(300)
      } else {
        break
      }

      if (expandClicks > 400) {throw new Error('profile groups never fully expanded')}
    }

    await reportMetric(testInfo, 'session_rail.expand_all_groups', Date.now() - tExpand)
    await reportMetric(testInfo, 'session_rail.expand_clicks', expandClicks, 'clicks')
    await reportMetric(testInfo, 'session_rail.rendered_rows_expanded', await rows.count(), 'rows')

    // Scroll the rail to its bottom: keep wheeling the list's scroller until
    // scrollTop stops increasing, then confirm the last gamma row exists in
    // the virtual window.
    const scroller = sidebar.locator('div.overflow-y-auto').last()
    await startFrameSampler(page)
    const tScroll = Date.now()
    let lastTop = -1

    for (let i = 0; i < 200; i += 1) {
      const top = await scroller.evaluate((el) => {
        el.scrollTop += el.clientHeight

        return el.scrollTop
      })

      if (top === lastTop) {break}
      lastTop = top
      await page.waitForTimeout(60)
    }

    // NOTE (baseline-relevant): the recents slice is a GLOBAL window
    // (`_pinned_window` over the merged list) while `Load more` is gated on
    // per-profile "slice came back full" flags. Once the limit outgrows every
    // profile's row count (~200 with 167/profile), the footer hides even though
    // ~300 rows remain on disk — so the deepest row here is whatever the last
    // page yielded, not seed 0. The spec asserts the scroller bottomed out over
    // the loaded DOM rather than hunting a specific oldest row.
    const atBottom = await scroller.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
    )

    expect(atBottom, 'rail scroller reached the bottom').toBe(true)
    expect(await rows.count()).toBeGreaterThan(0)
    await reportMetric(testInfo, 'session_rail.scroll_to_bottom', Date.now() - tScroll)
    await reportStats(testInfo, 'session_rail.scroll_frames', summarize(await stopFrameSampler(page)))
  } finally {
    await fixture.cleanup()
  }
})
