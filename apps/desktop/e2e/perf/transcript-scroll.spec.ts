/**
 * Perf baseline: a 2,000-message transcript — time to first paint of the
 * newest message, scroll-to-oldest latency, and frame pacing while the
 * virtualized list does the walk.
 */

import { expect } from '@playwright/test'

import { test } from '../test'

import { seedTranscriptSession } from './fixture-generator'
import {
  reportMetric,
  reportStats,
  startFrameSampler,
  stopFrameSampler,
  summarize,
} from './metrics'
import { launchPerfApp } from './perf-harness'

const TITLE = 'PERF TRANSCRIPT 2000'
const PAIRS = 1_000

test('2000-message transcript: open + scroll', // eslint-disable-next-line no-empty-pattern
  async ({}, testInfo) => {
  test.setTimeout(600_000)

  const fixture = await launchPerfApp({
    seed: async (hermesHome) => {
      await seedTranscriptSession(hermesHome, { title: TITLE, pairs: PAIRS })
    },
  })

  const { page } = fixture

  try {
    const viewport = page.locator('[data-slot="aui_thread-viewport"]')

    // open_to_latest: click the row → the newest rendered message paints.
    const t0 = Date.now()
    await page
      .locator('[data-slot="sidebar"] button')
      .filter({ hasText: TITLE })
      .first()
      .click()
    await expect(viewport).toContainText(`PERF TRANSCRIPT LAST ASSISTANT ${PAIRS - 1}`)
    const openMs = Date.now() - t0
    await reportMetric(testInfo, 'transcript.open_to_latest', openMs)

    // scroll_to_oldest: history paginates — the oldest rows sit behind a
    // "Show earlier messages" gate at the top of the window. Loop scroll-up +
    // gate-click until the first seeded row (the title) renders; each gate
    // click is one older-history load.
    const scroller = page
      .locator('[data-slot="aui_thread-viewport"]')
      .locator('..')

    const earlier = page.getByText('Show earlier messages', { exact: true })
    const pageLoads: number[] = []

    const tScroll = Date.now()
    await startFrameSampler(page)

    for (let i = 0; i < 40; i += 1) {
      await scroller.evaluate((el) => {
        const target = el.scrollHeight > el.clientHeight ? el : (el.firstElementChild as HTMLElement | null) ?? el
        target.scrollTop = 0
      })

      if (
        await viewport
          .getByText(TITLE, { exact: false })
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        break
      }

      // While a page is loading the gate is swapped for a spinner — give it a
      // beat to re-render before deciding it's gone for good.
      const gateUp = await earlier
        .waitFor({ state: 'visible', timeout: 45_000 })
        .then(() => true)
        .catch(() => false)

      if (!gateUp) {
        throw new Error('no "Show earlier messages" gate and the oldest row never rendered')
      }

      const tLoad = Date.now()
      await earlier.click()
      await page.waitForTimeout(400)
      pageLoads.push(Date.now() - tLoad)
    }

    await expect(viewport).toContainText(TITLE, { timeout: 120_000 })
    const scrollUpMs = Date.now() - tScroll
    const upFrames = await stopFrameSampler(page)
    await reportMetric(testInfo, 'transcript.scroll_to_oldest', scrollUpMs)
    await reportMetric(testInfo, 'transcript.earlier_page_loads', pageLoads.length, 'loads')

    if (pageLoads.length > 0) {
      await reportStats(testInfo, 'transcript.earlier_page_load', summarize(pageLoads))
    }

    await reportStats(testInfo, 'transcript.scroll_frames', summarize(upFrames))

    // And back to the bottom.
    const tBack = Date.now()
    await scroller.evaluate((el) => {
      const target = el.scrollHeight > el.clientHeight ? el : (el.firstElementChild as HTMLElement | null) ?? el
      target.scrollTop = target.scrollHeight
    })
    await startFrameSampler(page)
    await expect(viewport).toContainText(`PERF TRANSCRIPT LAST ASSISTANT ${PAIRS - 1}`, { timeout: 120_000 })
    const scrollDownMs = Date.now() - tBack
    const downFrames = await stopFrameSampler(page)
    await reportMetric(testInfo, 'transcript.scroll_to_latest', scrollDownMs)
    await reportStats(testInfo, 'transcript.scroll_latest_frames', summarize(downFrames))
  } finally {
    await fixture.cleanup()
  }
})
