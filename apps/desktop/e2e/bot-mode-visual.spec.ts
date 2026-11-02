/**
 * Bot Mode visual capture.
 *
 * The nine polish rounds before this one ended every report with "proven in
 * tests and in the bundle, but nobody has actually looked at it". That was
 * never true of the harness — it was true of the habit. Electron runs under
 * `xvfb-run` here, so the shipped renderer can be photographed.
 *
 * This spec does two things:
 *   1. asserts the Bot Mode surfaces actually paint (so it is a real test, and
 *      a blank pane, a thrown boundary or a missing roster fails the run), and
 *   2. hands every surface to `expectVisualSnapshot`, which pins the window to
 *      1220×800 and writes `<name>-actual.png` into the test output dir — a
 *      picture to look at, and a local baseline to diff against next time.
 *
 * Baselines live under `*-snapshots/`, which is gitignored: these are a working
 * instrument for a session, not committed fixtures. Run with
 * `--update-snapshots` to (re)pin them locally.
 *
 *   xvfb-run -a npx playwright test e2e/bot-mode-visual.spec.ts --reporter=line
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
import { expectVisualSnapshot } from './visual-snapshot'

type Page = MockBackendFixture['page']

let fixture: MockBackendFixture | null = null
const pageErrors: string[] = []

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
  const sandbox = createSandbox('bots-visual')
  writeMockProviderConfig(sandbox.hermesHome, mock.url)
  writeEnvFile(sandbox.hermesHome)
  await seedBot(sandbox.hermesHome, mock.url, 'alpha')
  await seedBot(sandbox.hermesHome, mock.url, 'beta')

  const { app, page } = await launchDesktop(buildAppEnv(sandbox))
  page.on('pageerror', error => pageErrors.push(String(error)))

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

test.afterEach(() => {
  // A thrown render boundary blanks a pane; the screenshot would still "pass".
  expect(pageErrors, 'no page errors during the walk').toEqual([])
})

test('the roster paints every bot, and nothing blank', async () => {
  test.setTimeout(120_000)
  const { app, page } = fixture!

  await openBots(page)
  await expect(rosterRow(page, 'local::alpha')).toBeVisible({ timeout: 30_000 })
  await expect(rosterRow(page, 'local::beta')).toBeVisible({ timeout: 30_000 })

  // A blank pane renders an empty background and nothing else; the row text is
  // the cheapest proof that the roster's data path ran.
  await expect(page.locator('[data-slot="bots-roster"]')).toContainText('alpha')

  // Icon-only controls need a name, not just a tooltip (WCAG 4.1.2). The toast
  // toggle had a Tip and nothing else, so it was nameless to assistive tech.
  await expect(page.getByRole('button', { name: /^Activity toasts/ })).toBeVisible()

  await expectVisualSnapshot(page, { app, name: 'bot-mode-roster' })
})

test('the new-bot dialog opens, is named, and closes without leaking', async () => {
  test.setTimeout(120_000)
  const { app, page } = fixture!

  await openBots(page)
  // The header's "+" is a menu, not a dialog: New bot / New group chat / New section.
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 15_000 })
  await expectVisualSnapshot(page, { app, name: 'bot-mode-new-menu' })

  await page.getByRole('menuitem', { name: 'New bot' }).click()
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible({ timeout: 15_000 })

  await expectVisualSnapshot(page, { app, name: 'bot-mode-create-dialog' })

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
})

test('the new-group dialog is its own surface', async () => {
  test.setTimeout(120_000)
  const { app, page } = fixture!

  await openBots(page)
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await page.getByRole('menuitem', { name: 'New group chat' }).click()

  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expectVisualSnapshot(page, { app, name: 'bot-mode-create-group-dialog' })

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
})

test('a bot chat opens from its roster row', async () => {
  test.setTimeout(180_000)
  const { app, page } = fixture!

  await openBots(page)
  await rosterRow(page, 'local::alpha').click()

  await expect(page.getByText('Hello alpha', { exact: true }).filter({ visible: true }).first())
    .toBeVisible({ timeout: 60_000 })

  // The Screen hero lives at the top of the rail. It had no host for a while —
  // <ScreenHero> is rendered only by RoutinesPane, which nothing mounts — so a
  // Bot Screen could not be reached from the UI at all. This is the regression
  // guard for that: the surface must be on screen, named for assistive tech.
  await expect(page.locator('button[aria-label^="Screen:"]').first()).toBeVisible({ timeout: 30_000 })

  await expectVisualSnapshot(page, { app, name: 'bot-mode-chat' })
})

test('a group room opens, and its destructive action is behind the overflow', async () => {
  test.setTimeout(240_000)
  const { app, page } = fixture!

  await openBots(page)
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await page.getByRole('menuitem', { name: 'New group chat' }).click()

  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible({ timeout: 15_000 })

  // Two members is the minimum the dialog will create with. Each row's
  // checkbox is named "<display name> <@handle>", so select by that.
  await dialog.getByRole('checkbox', { name: /^Beta / }).check()
  await dialog.getByRole('checkbox', { name: /^alpha / }).check()
  await dialog.getByLabel('Group name').fill('Design Room')

  await dialog.getByRole('button', { name: /^Create Group/ }).click()

  // A room opens as its own main-window tab (openGroupChat), so the Bots stage
  // stays behind it in the sidebar — but the header's overflow trigger exists
  // only inside a room, so it is the proof that the room itself painted.
  const more = page.getByRole('button', { name: 'More actions' }).first()
  await expect(more).toBeVisible({ timeout: 45_000 })
  await expectVisualSnapshot(page, { app, name: 'bot-mode-room' })

  // The whole point of the header change: nothing destructive sits on the row.
  await expect(page.getByRole('button', { name: /^Disband/ })).toHaveCount(0)
  await more.click()
  await expect(page.getByRole('menuitem', { name: /Disband/ })).toBeVisible({ timeout: 10_000 })
  await expectVisualSnapshot(page, { app, name: 'bot-mode-room-menu' })
  await page.keyboard.press('Escape')
})
