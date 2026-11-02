#!/usr/bin/env node
// Fail on colour literals outside the token layer.
//
// Hermes carries 266 design tokens and ~2,078 production hex values. The two
// numbers are not unrelated: a vocabulary that large constrains nothing, so a
// component that needs "a slightly different grey" writes `#8b8d94` instead of
// asking the token layer. design/vocabulary.css shrinks that vocabulary to
// fourteen aliases; this lint is what makes the shrink stick.
//
// The count is a RATCHET, not a cliff. From day one it fails any change that
// raises the number, and `--update` lowers the committed baseline as components
// are converted. A hard zero from the start would be switched off within a week,
// which is the failure mode this replaces.
//
// Definition files may hold literal colours; nothing else may.
//
//   node scripts/lint-hex-tokens.mjs            # check
//   node scripts/lint-hex-tokens.mjs --update   # lower the baseline to today
//
// Scope matches desktop-debt-audit.sh exactly — production .ts/.tsx under src/,
// tests excluded — so there is one number and one tree. A mock's `#888` avatar
// is not a design decision, and counting it is what made an earlier baseline
// read 3,715 instead of 2,078. CSS outside src/styles.css is not counted here;
// the stylesheets are the token layer's own home, not component code.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { countDebt } from './hex-count.mjs'

const HERE = import.meta.dirname
const DESKTOP_ROOT = resolve(HERE, '..')
const BASELINE = join(HERE, 'hex-baseline.json')

const { hex: total, offenders } = countDebt(DESKTOP_ROOT)
const update = process.argv.includes('--update')

if (update) {
  writeFileSync(BASELINE, `${JSON.stringify({ count: total, updatedAt: new Date().toISOString() }, null, 2)}\n`)
  console.log(`lint:hex — baseline updated to ${total} colour literal(s) outside the token layer`)
  process.exit(0)
}

let baseline = 0

try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).count ?? 0
} catch {
  console.error('lint:hex — no baseline at scripts/hex-baseline.json; run with --update once')
  process.exit(1)
}

const delta = total - baseline

if (delta > 0) {
  offenders.sort((a, b) => b.count - a.count)
  console.error(
    `lint:hex — ${total} colour literals outside the token layer, baseline ${baseline} (+${delta}).\n` +
      `Use design/vocabulary.css aliases (--alias-bg-*, --alias-label-*, --alias-border-*, --alias-brand-primary, --alias-state-*).\n\n` +
      offenders
        .slice(0, 15)
        .map(entry => `  ${String(entry.count).padStart(4)}  ${entry.rel}  (${entry.sample})`)
        .join('\n') +
      '\n'
  )
  process.exit(1)
}

if (delta < 0) {
  console.log(
    `lint:hex — ${total} colour literals, baseline ${baseline} (${delta}) — good, run with --update to lower the ratchet`,
  )
  process.exit(0)
}

console.log(`lint:hex — ${total} colour literals outside the token layer, at the baseline.`)
