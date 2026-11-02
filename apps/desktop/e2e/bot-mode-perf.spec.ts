/**
 * Bot Mode timing, measured instead of asserted.
 *
 * "Smooth and fast" is the other half of the parity brief, and it is the half
 * that can be measured without a screen. This spec records four numbers the
 * user actually feels, and fails only on gross regressions — the ceilings are
 * deliberately loose, because a shared CI box under load is not a benchmark.
 * The value is the log line: a run that suddenly reads 4s where it read 900ms
 * is a regression you can see.
 *
 *   1. app ready      — launch to a usable window
 *   2. Bots stage     — click to a painted roster
 *   3. bot chat       — row click to the first painted message
 *   4. renderer boot  — the page's own navigation timings
 *
 *   xvfb-run -a npx playwright test e2e/bot-mode-perf.spec.ts --reporter=line
 */
import fs from 'node:fs'
import path from 'node:path'

import { writeEnvFile, writeMockProviderConfig } from '../../../tests-js/scripts/mock-provider-config'
import { startMockServer } from '../../../tests-js/scripts/mock-server'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  type MockBackendFixture,
  waitForAppReady
} from './fixtures'
import { RealSessionBuilder } from './real-session-builder'
import { expect, test } from './test'

type Page = MockBackendFixture['page']

let fixture: MockBackendFixture | null = null
let appReadyMs = 0

/** Loose ceilings: these catch a 4x regression, not a slow afternoon. */
const CEILING = { appReady: 60_000, botsStage: 15_000, botChat: 60_000 }

async function seedBot(hermesHome: string, mockUrl: string, name: string): Promise<void> {
  const dir = path.join(hermesHome, 'profiles', name)
  fs.mkdirSync(dir, { recursive: true })
  writeMockProviderConfig(dir, mockUrl)
  writeEnvFile(dir)

  const builder = await RealSessionBuilder.start(dir)

  try {
    await builder.createSession({ title: 'Bot Chat', turns: [`Hello ${name}`] })
  } finally {
    await builder.close()
  }
}

const rosterRow = (page: Page, key: string) =>
  page.locator(`[data-slot="bots-roster"] [data-roster-key="${key}"]`)

test.beforeAll(async () => {
  const mock = await startMockServer()
  const sandbox = createSandbox('bots-perf')
  writeMockProviderConfig(sandbox.hermesHome, mock.url)
  writeEnvFile(sandbox.hermesHome)
  await seedBot(sandbox.hermesHome, mock.url, 'alpha')

  const started = Date.now()
  const { app, page } = await launchDesktop(buildAppEnv(sandbox))

  fixture = {
    app,
    page,
    mock,
    mockUrl: mock.url,
    sandbox,
    cleanup: async () => {
      await app.close().catch(() => undefined)
      await mock.close()
      sandbox.cleanup()
    }
  }
  await waitForAppReady(fixture, 120_000)
  appReadyMs = Date.now() - started
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('Bot Mode timings are logged and stay under their ceilings', async () => {
  test.setTimeout(240_000)
  const { page } = fixture!

  const stageStart = Date.now()

  await page
    .getByRole('button', { name: 'Bots', exact: true })
    .or(page.getByRole('tab', { name: 'Bots', exact: true }))
    .first()
    .click()
  await expect(page.locator('[data-slot="bots-roster"]')).toBeVisible({ timeout: 30_000 })
  await expect(rosterRow(page, 'local::alpha')).toBeVisible({ timeout: 30_000 })
  const botsStageMs = Date.now() - stageStart

  const chatStart = Date.now()

  await rosterRow(page, 'local::alpha').click()
  await expect(page.getByText('Hello alpha', { exact: true }).filter({ visible: true }).first())
    .toBeVisible({ timeout: 60_000 })
  const botChatMs = Date.now() - chatStart

  const renderer = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const paint = performance.getEntriesByType('paint')
    const fcp = paint.find(entry => entry.name === 'first-contentful-paint')

    return {
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      domInteractive: nav ? Math.round(nav.domInteractive) : null,
      firstContentfulPaint: fcp ? Math.round(fcp.startTime) : null
    }
  })

  console.log(
    `[perf] app-ready ${appReadyMs}ms · bots-stage ${botsStageMs}ms · bot-chat ${botChatMs}ms · ` +
      `fcp ${renderer.firstContentfulPaint}ms · dcl ${renderer.domContentLoaded}ms · ` +
      `interactive ${renderer.domInteractive}ms`
  )

  expect(appReadyMs, 'app ready').toBeLessThan(CEILING.appReady)
  expect(botsStageMs, 'Bots stage paint').toBeLessThan(CEILING.botsStage)
  expect(botChatMs, 'bot chat paint').toBeLessThan(CEILING.botChat)
})
