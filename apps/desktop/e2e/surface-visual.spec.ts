/**
 * Shell visual capture.
 *
 * Bot Mode got a screenshot gate first because that is where the polish rounds
 * kept failing. The rest of the app never had one — so any app-wide change
 * (the type ramp, the 135 static inline styles, the surface contract's second
 * consumer) is unverifiable by eye and had to be argued rather than shown.
 *
 * This spec photographs the surfaces those changes touch most: the default chat
 * with a real session, and the settings overlay. Baselines are gitignored
 * (sv*-snapshots/), a working instrument rather than committed fixtures; run
 * with `--update-snapshots` once to pin them.
 *
 *   xvfb-run -a npx playwright test e2e/surface-visual.spec.ts --workers=1 --reporter=line
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


let fixture: MockBackendFixture | null = null
const pageErrors: string[] = []

test.beforeAll(async () => {
  const mock = await startMockServer()
  const sandbox = createSandbox('surface-visual')
  writeMockProviderConfig(sandbox.hermesHome, mock.url)
  writeEnvFile(sandbox.hermesHome)

  const dir = path.join(sandbox.hermesHome, 'profiles', 'alpha')
  fs.mkdirSync(dir, { recursive: true })
  writeMockProviderConfig(dir, mock.url)
  writeEnvFile(dir)

  const builder = await RealSessionBuilder.start(dir)

  try {
    await builder.createSession({ title: 'Shell Baseline', turns: ['Hello shell'] })
  } finally {
    await builder.close()
  }

  const { app, page } = await launchDesktop(buildAppEnv(sandbox))
  page.on('pageerror', error => pageErrors.push(String(error)))

  fixture = { app, page, mock, mockUrl: mock.url, sandbox, cleanup: async () => { await app.close().catch(() => undefined); await mock.close(); sandbox.cleanup() } }
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test.afterEach(() => {
  expect(pageErrors, 'no page errors during the walk').toEqual([])
})

test('the default chat paints with a real session list', async () => {
  test.setTimeout(180_000)
  const { app, page } = fixture!

  // The session list is the shell's left column; its rows are the surface every
  // app-wide typography change lands on first.
  await expect(page.getByRole('button', { name: /New session/i }).first()).toBeVisible({ timeout: 60_000 })

  await expectVisualSnapshot(page, { app, name: 'surface-chat' })
})

test('the settings overlay paints', async () => {
  test.setTimeout(180_000)
  const { app, page } = fixture!

  const settings = page.getByRole('button', { name: 'Open settings' }).first()
  await expect(settings).toBeVisible({ timeout: 30_000 })
  await settings.click()

  // Settings is a full-screen overlay, not a role=dialog: it has its own
  // left nav (Appearance, Workspace, Safety …) and the model page by default.
  await expect(page.getByRole('button', { name: 'Appearance' }).first()).toBeVisible({ timeout: 20_000 })

  await expectVisualSnapshot(page, { app, name: 'surface-settings' })
})
