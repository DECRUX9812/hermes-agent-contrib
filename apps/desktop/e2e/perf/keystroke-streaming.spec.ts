/**
 * Perf baseline: composer keystroke latency while a reply is streaming.
 *
 * The mock server holds the stream open after the first token
 * (holdFirstStreamForPrompt), so the app sits mid-render-loop while we type
 * into the composer and measure keypress → text-visible latency.
 */

import { expect } from '@playwright/test'

import { test } from '../test'

import { reportMetric, reportStats, summarize } from './metrics'
import { launchPerfApp } from './perf-harness'

const HELD_PROMPT = 'PERF HELD stream me'
const KEYS = 'the quick brown fox'.split('')
const COMPOSER = '[data-slot="composer-root"] [contenteditable="true"]'

test('composer keystroke latency while streaming', // eslint-disable-next-line no-empty-pattern
  async ({}, testInfo) => {
  test.setTimeout(300_000)

  const fixture = await launchPerfApp({
    mock: { holdFirstStreamForPrompt: 'PERF HELD' },
  })

  const { page, mock } = fixture

  try {
    const composer = page.locator(COMPOSER)
    await composer.click()
    await page.keyboard.type(HELD_PROMPT)
    await page.keyboard.press('Enter')

    // The stream is now parked after its first token; the renderer is
    // processing the stream hold.
    await Promise.race([
      mock.waitForHeldStream(),
      page
        .waitForTimeout(90_000)
        .then(() => Promise.reject(new Error('held stream never started — prompt never reached the mock'))),
    ])

    const deltas: number[] = []

    for (const key of KEYS) {
      const before = await composer.evaluate((el) => el.textContent?.length ?? 0)
      const t0 = Date.now()
      await page.keyboard.press(key === ' ' ? 'Space' : key)
      await expect
        .poll(async () => composer.evaluate((el) => el.textContent?.length ?? 0), { timeout: 15_000 })
        .toBeGreaterThan(before)
      deltas.push(Date.now() - t0)
    }

    await reportStats(testInfo, 'keystroke_while_streaming', summarize(deltas))

    // Baseline for contrast: release the stream, let it finish, re-measure.
    mock.releaseHeldStream()
    const viewport = page.locator('[data-slot="aui_thread-viewport"]')
    await expect(viewport).toContainText('Hello from the mock inference server', { timeout: 60_000 })
    await page.waitForTimeout(1_000)
    const idleDeltas: number[] = []

    for (const key of 'idle check'.split('')) {
      const before = await composer.evaluate((el) => el.textContent?.length ?? 0)
      const t0 = Date.now()
      await page.keyboard.press(key === ' ' ? 'Space' : key)
      await expect
        .poll(async () => composer.evaluate((el) => el.textContent?.length ?? 0), { timeout: 15_000 })
        .toBeGreaterThan(before)
      idleDeltas.push(Date.now() - t0)
    }

    await reportMetric(testInfo, 'keystroke_idle.p50', summarize(idleDeltas).p50)
  } finally {
    await fixture.cleanup()
  }
})
