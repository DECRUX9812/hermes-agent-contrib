#!/usr/bin/env node
/**
 * Known-red-aware UI gate.
 *
 * The full `vitest run --project ui` suite takes ~1,700 s and 61 of its 12,582
 * assertions fail for reasons already documented (docs/GATE-RED-AUDIT.md: the
 * Graphite default, the interface-mode flip, async layout persistence). A gate
 * that fails on those blocks every deploy of an otherwise-good tree — which is
 * exactly what happened on 2026-10-30: a 40-minute ship aborted on the known
 * reds and nothing shipped, leaving the served build behind HEAD.
 *
 * This wrapper keeps the gate honest and makes it usable:
 *   - a failure listed in scripts/known-red.json does NOT block;
 *   - a failure NOT listed blocks, including a NEW failure inside a file that
 *     is already known-red (the baseline is per test name, not per file);
 *   - a known-red test that now passes is reported as "fixed" so the baseline
 *     can be ratcheted down rather than rotting.
 *
 * Usage:
 *   node scripts/test-ui-gate.mjs                 # gate the tree
 *   node scripts/test-ui-gate.mjs --write-baseline # accept the current reds
 *   node scripts/test-ui-gate.mjs --project ui --json /tmp/ui.json
 *
 * Exit: 0 = no new failures, 1 = new failures, 2 = could not run.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const baselinePath = resolve(here, 'known-red.json')
const args = process.argv.slice(2)
const writeBaseline = args.includes('--write-baseline')
const reuse = valueOf('--reuse')
const project = valueOf('--project') ?? 'ui'
const reportPath = valueOf('--json') ?? '/tmp/vitest-ui-gate.json'

function valueOf(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : { files: [], tests: [] }
const knownTests = new Set(baseline.tests ?? [])
const knownFiles = new Set(baseline.files ?? [])

console.log(`[gate] vitest project=${project} — baseline ${knownTests.size} tests / ${knownFiles.size} files`)

// Two reporters: the human one for the log, json for the machine.
// `--reuse <path>` skips the run and grades an existing report (CI + self-test).
if (reuse) {
  console.log(`[gate] reusing report ${reuse} (vitest not run)`)
  if (!existsSync(reuse)) {
    console.error(`[gate] no report at ${reuse}`)
    process.exit(2)
  }
} else {
  const run = spawnSync(
    'npx',
    [
      'vitest',
      'run',
      `--project=${project}`,
      // One retry: the suite runs at ~10x oversubscription on this box, and the
      // frame/idle-timed specs (completed-reply-refresh, browser-hints) fail on
      // scheduling jitter but pass on a second attempt. A deterministic failure
      // still fails both attempts, so the gate keeps its teeth — the retry only
      // stops load noise from blocking a ship, which is what happened on
      // 2026-10-30 when one flaky keybinds spec cost a 33-minute run.
      '--retry=1',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${reportPath}`
    ],
    { cwd: appRoot, stdio: 'inherit', env: process.env, shell: false }
  )
  if (run.error) {
    console.error('[gate] could not start vitest:', run.error.message)
    process.exit(2)
  }
  if (!existsSync(reportPath)) {
    console.error(`[gate] vitest produced no json report at ${reportPath} (exit ${run.status})`)
    process.exit(2)
  }
}

const report = JSON.parse(readFileSync(reuse ?? reportPath, 'utf8'))
const rel = abs => relative(appRoot, abs).split('\\').join('/')

const failures = [] // { file, test } — test is null when the file failed to load
let passed = 0
for (const file of report.testResults ?? []) {
  const name = rel(file.name ?? file.testFilePath ?? '')
  const assertions = file.assertionResults ?? []
  if (assertions.length === 0) {
    if (file.status === 'failed') failures.push({ file: name, test: null })
    continue
  }
  let fileFailed = false
  for (const a of assertions) {
    if (a.status === 'passed') passed++
    else if (a.status === 'failed') {
      fileFailed = true
      const path = [...(a.ancestorTitles ?? []), a.title].filter(Boolean).join(' > ')
      failures.push({ file: name, test: path })
    }
  }
  if (fileFailed && failures.every(f => f.file !== name)) failures.push({ file: name, test: null })
}

const known = failures.filter(f => (f.test ? knownTests.has(`${f.file} > ${f.test}`) : knownFiles.has(f.file)))
const fresh = failures.filter(f => !(f.test ? knownTests.has(`${f.file} > ${f.test}`) : knownFiles.has(f.file)))

const failingFilesNow = new Set(failures.map(f => f.file))
// Only meaningful on a full-suite report; a partial/reused report would call
// every absent test "fixed".
const fullRun = (report.numTotalTests ?? passed + failures.length) > 10_000
const fixed = fullRun
  ? (baseline.tests ?? []).filter(t => {
      const file = t.slice(0, t.indexOf(' > '))
      return !failingFilesNow.has(file)
    })
  : []

console.log(
  `\n[gate] ${passed} passed · ${failures.length} failing · ${known.length} known-red · ${fresh.length} NEW`
)
if (known.length) {
  const byFile = new Map()
  for (const f of known) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1)
  console.log(`[gate] known-red files: ${byFile.size} (see docs/GATE-RED-AUDIT.md)`)
}
if (fixed.length) {
  console.log(`[gate] FIXED since the baseline (ratchet it down): ${fixed.length}`)
  for (const t of fixed.slice(0, 10)) console.log(`        + ${t}`)
}

if (writeBaseline) {
  const next = {
    _comment: baseline._comment,
    generated: new Date().toISOString().slice(0, 10),
    files: [...new Set(failures.map(f => f.file))].sort(),
    tests: failures.filter(f => f.test).map(f => `${f.file} > ${f.test}`).sort()
  }
  writeFileSync(baselinePath, JSON.stringify(next, null, 1) + '\n')
  console.log(`[gate] baseline rewritten: ${next.files.length} files / ${next.tests.length} tests`)
  process.exit(0)
}

if (fresh.length) {
  console.error('\n[gate] BLOCKING — failures that are not in the known-red baseline:')
  for (const f of fresh) console.error(`        - ${f.test ? `${f.file} > ${f.test}` : `${f.file} (suite failed to load)`}`)
  console.error('\n[gate] If these are expected, run: node scripts/test-ui-gate.mjs --write-baseline')
  process.exit(1)
}

console.log('[gate] OK — no new failures beyond the recorded baseline')
process.exit(0)
