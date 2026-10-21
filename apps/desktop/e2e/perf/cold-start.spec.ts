/**
 * Perf baseline: cold start — process launch to interactive.
 *
 * Numbers are emitted as `PERF[cold_start.*]=<ms>` console lines (see
 * metrics.ts) and quoted in docs/revamp/baseline.md. Three fresh launches,
 * each on its own sandboxed home; every iteration pays the full Electron +
 * backend-spawn cost.
 */

import { writeEnvFile, writeMockProviderConfig } from '../../../../tests-js/scripts/mock-provider-config'
import { startMockServer } from '../../../../tests-js/scripts/mock-server'
import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  waitForAppReady,
} from '../fixtures'
import { test } from '../test'

import { reportMetric, summarize } from './metrics'

test.describe.configure({ mode: 'serial' })

const ITERATIONS = 3

test('cold start: launch to interactive', // eslint-disable-next-line no-empty-pattern
  async ({}, testInfo) => {
  test.setTimeout(ITERATIONS * 300_000)
  const samples: number[] = []

  for (let i = 0; i < ITERATIONS; i += 1) {
    const mock = await startMockServer()
    const sandbox = createSandbox(`perf-cold-${i}`)

    try {
      writeMockProviderConfig(sandbox.hermesHome, mock.url)
      writeEnvFile(sandbox.hermesHome)
      const env = buildAppEnv(sandbox, {})

      const t0 = Date.now()
      const { app, page } = await launchDesktop(env)
      await waitForAppReady({ app, page, sandbox, mock, mockUrl: mock.url, cleanup: async () => undefined })
      const ms = Date.now() - t0
      samples.push(ms)
      await reportMetric(testInfo, `cold_start.run${i + 1}`, ms)
      await app.close().catch(() => undefined)
    } finally {
      sandbox.cleanup()
      await mock.close().catch(() => undefined)
    }
  }

  const stats = summarize(samples)
  await reportMetric(testInfo, 'cold_start.p50', stats.p50)
  await reportMetric(testInfo, 'cold_start.max', stats.max)
})
