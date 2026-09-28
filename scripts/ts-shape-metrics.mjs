#!/usr/bin/env node
/**
 * Shape metrics for apps/desktop (revamp wave 0.3).
 *
 * Counts, over TypeScript sources under apps/desktop (excluding
 * node_modules, dist, and test-result output):
 *   - files over 1,000 lines
 *   - files over 1,500 lines
 *   - store atoms: non-test files in apps/desktop/src/store/
 *
 * Printed output is the canonical shape quote for
 * apps/desktop/docs/revamp/baseline.md — wave PRs diff these numbers to show
 * the monolith shrinking.
 *
 * Usage: node scripts/ts-shape-metrics.mjs [--json]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopRoot = path.join(repoRoot, 'apps', 'desktop')

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'test-results',
  'playwright-report',
  '.vite',
  'release',
])
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full)
    } else if (TS_EXTENSIONS.has(path.extname(entry.name))) {
      yield full
    }
  }
}

function lineCount(file) {
  const buf = readFileSync(file)
  let lines = 1
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 10) lines += 1
  }
  // A trailing newline means the count above is exact; an empty file is 0.
  if (buf.length === 0) return 0
  if (buf[buf.length - 1] === 10) return lines - 1
  return lines
}

function main() {
  const json = process.argv.includes('--json')
  const files = []
  let totalLines = 0

  for (const file of walk(desktopRoot)) {
    const lines = lineCount(file)
    totalLines += lines
    files.push({ file: path.relative(repoRoot, file), lines })
  }

  files.sort((a, b) => b.lines - a.lines)
  const over1000 = files.filter((f) => f.lines > 1_000)
  const over1500 = files.filter((f) => f.lines > 1_500)

  const storeDir = path.join(desktopRoot, 'src', 'store')
  const storeFiles = readdirSync(storeDir).filter(
    (name) => TS_EXTENSIONS.has(path.extname(name)) && statSync(path.join(storeDir, name)).isFile(),
  )
  const storeAtoms = storeFiles.filter((name) => !name.includes('.test.'))
  const storeTests = storeFiles.filter((name) => name.includes('.test.'))

  const summary = {
    ts_files: files.length,
    total_lines: totalLines,
    files_over_1000: over1000.length,
    files_over_1500: over1500.length,
    store_atoms: storeAtoms.length,
    store_test_files: storeTests.length,
  }

  if (json) {
    console.log(JSON.stringify({ summary, over1000 }, null, 2))
    return
  }

  console.log('# apps/desktop TypeScript shape')
  console.log(`ts files:            ${summary.ts_files}`)
  console.log(`total lines:         ${summary.total_lines}`)
  console.log(`files > 1000 lines:  ${summary.files_over_1000}`)
  console.log(`files > 1500 lines:  ${summary.files_over_1500}`)
  console.log(`store atoms:         ${summary.store_atoms} (src/store/* non-test files; ${summary.store_test_files} test files excluded)`)
  console.log('')
  console.log('## files > 1500 lines')
  for (const f of over1500) console.log(`${String(f.lines).padStart(6)}  ${f.file}`)
  console.log('')
  console.log('## files 1001–1500 lines')
  for (const f of over1000) {
    if (f.lines <= 1_500) console.log(`${String(f.lines).padStart(6)}  ${f.file}`)
  }
}

main()
