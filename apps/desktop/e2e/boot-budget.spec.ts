/**
 * Boot budget — the shell's first paint, held to a number.
 *
 * 2.5s FCP was the user-visible item nobody had touched. Measuring it properly
 * changed what it is: on a cold render the renderer paints its first frame at
 * ~150ms, and FIRST CONTENTFUL PAINT lands ~1.4s later. The intervening work is
 * not one big task (the longest is ~290ms); it is React mount plus the first
 * data round-trip before anything meaningful is on screen.
 *
 * This spec measures a reload (so the observer exists before the document runs)
 * and holds two numbers: FCP and total blocking time. A threshold is the only
 * way "fast" stays true — and the budget is deliberately loose, because a shared
 * CI box under load is not a benchmark.
 *
 *   xvfb-run -a npx playwright test e2e/boot-budget.spec.ts --workers=1 --reporter=line
 */

import { writeEnvFile, writeMockProviderConfig } from '../../../tests-js/scripts/mock-provider-config'
import { startMockServer } from '../../../tests-js/scripts/mock-server'

import { buildAppEnv, createSandbox, launchDesktop, type MockBackendFixture, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture | null = null

/** Warm-reload budgets. Measured 2026-11-02: FCP 1556ms, blocking ~370ms. */
const BUDGET = { fcp: 3000, blocking: 900 }

test.beforeAll(async () => {
  const mock = await startMockServer()
  const sandbox = createSandbox('boot-budget')
  writeMockProviderConfig(sandbox.hermesHome, mock.url)
  writeEnvFile(sandbox.hermesHome)
  const { app, page } = await launchDesktop(buildAppEnv(sandbox))

  // The observer must exist before the document runs, and the app is already up
  // by the time we get the page — so install it and reload once.
  await page.addInitScript(() => {
    ;(window as unknown as { __long: Array<{ d: number; s: number }> }).__long = []
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        ;(window as unknown as { __long: Array<{ d: number; s: number }> }).__long.push({ d: Math.round(entry.duration), s: Math.round(entry.startTime) })
      }
    }).observe({ entryTypes: ['longtask'] })
  })

  fixture = { app, page, mock, mockUrl: mock.url, sandbox, cleanup: async () => { await app.close().catch(() => undefined); await mock.close(); sandbox.cleanup() } }
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => { await fixture?.cleanup(); fixture = null })

test('the shell paints its first content within budget', async () => {
  test.setTimeout(180_000)
  const { page } = fixture!

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)

  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const fcp = performance.getEntriesByType('paint').find(entry => entry.name === 'first-contentful-paint')
    const long = (window as unknown as { __long?: Array<{ d: number; s: number }> }).__long ?? []

    return {
      blocking: long.reduce((sum, task) => sum + task.d, 0),
      dcl: Math.round(nav.domContentLoadedEventEnd),
      fcp: fcp ? Math.round(fcp.startTime) : null,
      longest: Math.max(0, ...long.map(task => task.d))
    }
  })

  console.log(
    `[boot] fcp ${data.fcp}ms · dcl ${data.dcl}ms · blocking ${data.blocking}ms · longest task ${data.longest}ms`,
  )

  expect(data.fcp, 'first contentful paint').not.toBeNull()
  expect(data.fcp!, 'first contentful paint').toBeLessThan(BUDGET.fcp)
  expect(data.blocking, 'total blocking time').toBeLessThan(BUDGET.blocking)
})
