/**
 * Reporting helpers for the perf lane. Specs measure wall-clock latencies and
 * renderer frame stats, then emit one `PERF[metric]=value unit` line per
 * measurement — the line format is what `docs/revamp/baseline.md` quotes, so
 * keep it stable.
 */

import { type Page, type TestInfo } from '@playwright/test'

export interface FrameStats {
  count: number
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
}

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) {return 0}
  const index = Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))

  return sorted[index]
}

export function summarize(values: number[]): FrameStats {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = sorted.length ? sorted.reduce((sum, v) => sum + v, 0) / sorted.length : 0

  return {
    count: sorted.length,
    mean,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  }
}

/** Emit one baseline-quotable line and attach the sample to the report. */
export async function reportMetric(
  testInfo: TestInfo,
  name: string,
  value: number,
  unit = 'ms',
): Promise<void> {
  const rounded = Math.round(value * 100) / 100
   
  console.log(`PERF[${name}]=${rounded}${unit}`)
  await testInfo.attach(`perf-${name}`, {
    body: JSON.stringify({ metric: name, value: rounded, unit }),
    contentType: 'application/json',
  })
}

export async function reportStats(
  testInfo: TestInfo,
  name: string,
  stats: FrameStats,
  unit = 'ms',
): Promise<void> {
  await reportMetric(testInfo, `${name}.p50`, stats.p50, unit)
  await reportMetric(testInfo, `${name}.p95`, stats.p95, unit)
  await reportMetric(testInfo, `${name}.max`, stats.max, unit)
}

/** Wall-clock around an async step. */
export async function timeMs<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const t0 = Date.now()
  const result = await fn()

  return { ms: Date.now() - t0, result }
}

/**
 * Start a rAF frame-interval sampler in the page. While it runs, every frame
 * interval is pushed to `window.__PERF_FRAMES__`. Stop with stopFrameSampler,
 * which returns the raw deltas (ms).
 */
export async function startFrameSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __PERF_FRAMES__?: number[]; __PERF_FRAMES_STOP__?: boolean }
    w.__PERF_FRAMES__ = []
    w.__PERF_FRAMES_STOP__ = false
    let last = performance.now()

    const tick = (t: number) => {
      if (w.__PERF_FRAMES_STOP__) {return}
      w.__PERF_FRAMES__!.push(t - last)
      last = t
      requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
  })
}

export async function stopFrameSampler(page: Page): Promise<number[]> {
  const raw = await page.evaluate(() => {
    const w = window as unknown as { __PERF_FRAMES__?: number[]; __PERF_FRAMES_STOP__?: boolean }
    w.__PERF_FRAMES_STOP__ = true

    return w.__PERF_FRAMES__ ?? []
  })

  // The first sample can be negative: rAF hands the callback the frame's vsync
  // timestamp, which can predate the `performance.now()` taken at start.
  return raw.filter(delta => delta > 0)
}
