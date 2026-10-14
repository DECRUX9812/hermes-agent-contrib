import '../run-tmp'
import '../fix-electron-tracing'

import { defineConfig } from '@playwright/test'

/**
 * Real-backend reload lane: every feature pillar edits something in a real app
 * (real Electron, real `hermes serve`, only the LLM scripted), reloads the window
 * the way Ctrl+R does, and asserts the edit is still there when read back from
 * the backend. Modelled on the core lane; one spec at a time, no retries.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.reload.spec.ts',
  timeout: 240_000,
  expect: { timeout: 60_000 },
  retries: 0,
  forbidOnly: true,
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/reload' }]],
  outputDir: '../../test-results/reload',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
})
