import { defineConfig } from '@playwright/test'

/**
 * Perf lane: seeded, single-worker Electron specs that report wall-clock
 * numbers instead of asserting. Excluded from the default suite via
 * `testIgnore: ['perf/**']` in the root playwright.config.ts; run it with
 *
 *   cd apps/desktop && npm run build && npx playwright test --config e2e/perf/playwright.config.ts
 *
 * Numbers land on the console as `PERF[name]=value` lines and are quoted in
 * apps/desktop/docs/revamp/baseline.md.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Each spec launches real Electron processes and seeds via a real gateway
  // subprocess — serial only, and generous with time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 60_000 },
  reporter: [['list']],
  outputDir: '../../test-results/perf',
})
