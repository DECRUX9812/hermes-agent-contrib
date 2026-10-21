/**
 * Shared launch path for the perf lane. Wraps the standard e2e fixtures —
 * mock provider server, sandboxed home, real Electron boot — and hands specs
 * a ready page plus the seeded sandbox. `seed` runs AFTER the mock backend
 * config is written into the home (the fixture generator needs the real
 * gateway spawn to authenticate through the mock provider) and BEFORE the app
 * launches, so every spec measures a real cold boot over the seeded data.
 */

import { type ElectronApplication, type Page } from 'playwright-core'

import { writeEnvFile, writeMockProviderConfig } from '../../../../tests-js/scripts/mock-provider-config'
import { type MockServer, type MockServerOptions, startMockServer } from '../../../../tests-js/scripts/mock-server'
import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  type MockBackendFixture,
  type Sandbox,
  waitForAppReady,
} from '../fixtures'

export interface PerfFixture {
  app: ElectronApplication
  page: Page
  sandbox: Sandbox
  mock: MockServer
  cleanup: () => Promise<void>
}

export async function launchPerfApp(opts: {
  seed?: (hermesHome: string, mockUrl: string) => Promise<void>
  mock?: MockServerOptions
} = {}): Promise<PerfFixture> {
  const mock = await startMockServer(opts.mock)
  const sandbox = createSandbox('perf')
  writeMockProviderConfig(sandbox.hermesHome, mock.url)
  writeEnvFile(sandbox.hermesHome)
  await opts.seed?.(sandbox.hermesHome, mock.url)
  const env = buildAppEnv(sandbox, {})
  const { app, page } = await launchDesktop(env)

  const fixture: MockBackendFixture = {
    app,
    page,
    mock,
    mockUrl: mock.url,
    sandbox,
    cleanup: async () => undefined,
  }

  await waitForAppReady(fixture)

  return {
    ...fixture,
    cleanup: async () => {
      await app.close().catch(() => undefined)
      sandbox.cleanup()
      await mock.close().catch(() => undefined)
    },
  }
}
