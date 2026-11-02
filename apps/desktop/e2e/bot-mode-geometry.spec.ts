/**
 * Bot Mode geometry audit.
 *
 * The rest of the harness proves that a surface paints and says the right
 * words. None of it proves the words fit: a control can sit past the window
 * edge, a label can be ellipsized (or clipped mid-word) inside its own box, and
 * every presence assertion still passes. `geometry.ts` turns those two
 * questions into numbers, and this spec points that probe at the three Bot
 * Mode surfaces where polish has been shakiest:
 *
 *   1. the roster,
 *   2. the "+" menu that opens from the roster header,
 *   3. the New bot dialog.
 *
 * Each test asserts the probe finds nothing, and prints every offender when it
 * does. The separate self-check test proves the probe is not vacuous: it
 * injects one clipped control per detection mode (off-left, off-right,
 * ellipsized, hidden-overflow) and requires the probe to name all of them, then
 * removes them. Without it, "zero offenders" would be indistinguishable from a
 * probe that silently measures nothing.
 *
 * If a surface grows an offender, the printed list is the defect report. When
 * the offender is a real product bug (not an intentional scroll region), mark
 * that test `test.fail()` with the list in an annotation: the suite stays green,
 * the bug stays recorded, and the day it is fixed the test flips to "passed
 * unexpectedly" and asks for the marker to come off.
 *
 * Run (no display):
 *   xvfb-run -a npx playwright test e2e/bot-mode-geometry.spec.ts --reporter=line
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
import { describeGeometry, measureClipping } from './geometry'
import { RealSessionBuilder } from './real-session-builder'
import { expect, test } from './test'

type Page = MockBackendFixture['page']

let fixture: MockBackendFixture | null = null

/** Seed a bot profile with one finished session so its row and chat are real. */
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

/** The stage switch is a button on some shells and a tab on others — and it is
 *  gone once the Bots stage is active (the sidebar header becomes "BOTS"), so
 *  entering twice must not look for it. */
async function openBots(page: Page): Promise<void> {
  const roster = page.locator('[data-slot="bots-roster"]')

  if (await roster.isVisible().catch(() => false)) {
    return
  }

  const tab = page
    .getByRole('button', { name: 'Bots', exact: true })
    .or(page.getByRole('tab', { name: 'Bots', exact: true }))
    .first()

  await tab.click()
  await expect(page.getByRole('button', { name: 'New bot or group chat' })).toBeVisible()
  await expect(roster).toBeVisible({ timeout: 30_000 })
}

const rosterRow = (page: Page, key: string) =>
  page.locator(`[data-slot="bots-roster"] [data-roster-key="${key}"]`)

test.beforeAll(async () => {
  const mock = await startMockServer()
  const sandbox = createSandbox('bots-geometry')
  writeMockProviderConfig(sandbox.hermesHome, mock.url)
  writeEnvFile(sandbox.hermesHome)
  await seedBot(sandbox.hermesHome, mock.url, 'alpha')
  await seedBot(sandbox.hermesHome, mock.url, 'beta')

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
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

/**
 * The assertion under test. On success it records a pass annotation; on a
 * breach it prints every offender and fails with the formatted list.
 */
async function expectNothingClipped(page: Page, surface: string): Promise<void> {
  const problems = await measureClipping(page)
  const rendered = describeGeometry(problems)

  if (rendered) {
    // stdout survives the `line` reporter, so a known failure still reports
    // exactly what is wrong even though the run stays green.
    console.log(`\n[geometry] ${surface}: ${problems.length} offender(s)\n${rendered}\n`)
    test.info().annotations.push({
      type: 'geometry',
      description: `${surface}: ${problems.length} offender(s)\n${rendered}`
    })
  }

  expect(rendered, `${surface} has clipped or truncated controls:\n${rendered}`).toBe('')
}

test('roster: no clipped or truncated controls', async () => {
  test.setTimeout(180_000)
  const { page } = fixture!

  await openBots(page)
  await expect(rosterRow(page, 'local::alpha')).toBeVisible({ timeout: 30_000 })
  await expect(rosterRow(page, 'local::beta')).toBeVisible({ timeout: 30_000 })

  await expectNothingClipped(page, 'roster')
})

test('"+" menu: no clipped or truncated controls', async () => {
  test.setTimeout(180_000)
  const { page } = fixture!

  await openBots(page)
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('menuitem', { name: 'New bot' })).toBeVisible()

  await expectNothingClipped(page, '"+" menu')

  // Leave the next surface a clean tree.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden({ timeout: 10_000 })
})

test('New bot dialog: no clipped or truncated controls', async () => {
  test.setTimeout(180_000)
  const { page } = fixture!

  await openBots(page)
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await page.getByRole('menuitem', { name: 'New bot' }).click()

  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByRole('button', { name: /^Create/ })).toBeVisible()

  await expectNothingClipped(page, 'New bot dialog')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
})

/** Injected controls only exist for the lifetime of this test; anything using
 *  these labels is ours, not the product's. */
const isCanary = (problem: { target: string }) => problem.target.startsWith('Canary')

test('bot chat + context rail: no clipped or truncated controls', async () => {
  test.setTimeout(240_000)
  const { page } = fixture!

  await openBots(page)
  await rosterRow(page, 'local::alpha').click()
  await expect(page.getByText('Hello alpha', { exact: true }).filter({ visible: true }).first())
    .toBeVisible({ timeout: 60_000 })

  // The rail is the surface the earlier rounds never measured. Its footer is
  // where a label was already found clipped by hand ("Open chat …").
  await expect(page.getByRole('button', { name: /Open chat/ })).toBeVisible({ timeout: 30_000 })

  await expectNothingClipped(page, 'bot chat + context rail')
})

test('probe self-check: every detection mode still fires', async () => {
  test.setTimeout(180_000)
  const { page } = fixture!

  await openBots(page)

  await page.evaluate(() => {
    const add = (label: string, id: string, style: Partial<CSSStyleDeclaration>) => {
      const button = document.createElement('button')

      button.id = id
      button.textContent = label
      Object.assign(button.style, {
        position: 'fixed',
        height: '30px',
        opacity: '1',
        visibility: 'visible',
        ...style
      })
      document.body.appendChild(button)
    }

    // Past the right edge; past the left edge (60px of it on screen); a label
    // ellipsized inside its own 60px box; and one clipped mid-word instead.
    add('Canary offscreen control', 'canary-right', { left: '1300px', top: '700px', width: '120px' })
    add('Canary offscreen control', 'canary-left', { left: '-60px', top: '740px', width: '120px' })
    add('Canary ellipsized label', 'canary-ellipsis', {
      left: '600px',
      top: '700px',
      width: '60px',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis'
    })
    add('Canary clipped label', 'canary-clip', {
      left: '700px',
      top: '700px',
      width: '60px',
      overflow: 'hidden',
      whiteSpace: 'nowrap'
    })

    // The control's own box fits; the label is cut inside a child span. That is
    // the "Open chat …" shape in the rail footer, invisible to the own-box rule.
    const wrapper = document.createElement('button')

    wrapper.id = 'canary-inner'
    wrapper.style.cssText =
      'position:fixed;left:800px;top:700px;width:200px;height:30px;opacity:1;visibility:visible'

    const inner = document.createElement('span')

    inner.textContent = 'Canary inner-clipped label'
    inner.style.cssText = 'display:block;width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis'
    wrapper.appendChild(inner)
    document.body.appendChild(wrapper)
  })

  let canaries: Awaited<ReturnType<typeof measureClipping>> = []

  try {
    canaries = (await measureClipping(page)).filter(isCanary)

    expect(
      canaries.map(problem => problem.kind).sort(),
      `probe missed a detection mode:\n${describeGeometry(canaries)}`
    ).toEqual(['offscreen', 'offscreen', 'truncated-label', 'truncated-label', 'truncated-label'])

    // Both horizontal directions must be named, not just the right edge.
    expect(canaries.some(problem => problem.kind === 'offscreen' && problem.detail.includes('at left'))).toBe(true)
    expect(canaries.some(problem => problem.kind === 'offscreen' && problem.detail.includes('at right'))).toBe(true)
  } finally {
    await page.evaluate(() => {
      for (const id of ['canary-right', 'canary-left', 'canary-ellipsis', 'canary-clip', 'canary-inner']) {
        document.getElementById(id)?.remove()
      }
    })
  }

  // The injection must not leak into another surface's measurement.
  expect((await measureClipping(page)).filter(isCanary), 'canary controls were not removed').toEqual([])
})
