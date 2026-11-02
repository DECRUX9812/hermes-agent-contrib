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

const { hex: total, inline, inlineDynamic, offenders, textArbitrary } = countDebt(DESKTOP_ROOT)
const update = process.argv.includes('--update')

if (update) {
  writeFileSync(BASELINE, `${JSON.stringify({ count: total, inline, textArbitrary, updatedAt: new Date().toISOString() }, null, 2)}\n`)
  console.log(`lint:hex — baseline updated: ${total} colour literal(s), ${inline} inline style(s), ${textArbitrary} arbitrary type size(s)`)
  process.exit(0)
}

let baseline = 0
let typeBaseline = 0
let inlineBaseline = 0

try {
  const saved = JSON.parse(readFileSync(BASELINE, 'utf8'))

  baseline = saved.count ?? 0
  typeBaseline = saved.textArbitrary ?? 0
  inlineBaseline = saved.inline ?? 0
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
        .map(entry => `  ${String(entry.count).padStart(4)}  ${entry.file}`)
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

if (textArbitrary > typeBaseline) {
  console.error(
    `lint:type — ${textArbitrary} arbitrary font size(s), baseline ${typeBaseline} (+${textArbitrary - typeBaseline}).\n` +
      `Use a ramp step (text-9/10/11/13/15/20/22, or Tailwind's xs/sm/base/lg/xl/2xl). Half-step optical corrections are exempt in scripts/hex-count.mjs.`,
  )
  process.exit(1)
}

// Inline styles are a NO-GROWTH ratchet, not a ceiling to reach. Measured:
// of 173, 38 are dynamic (a computed width cannot be a class), and of the 135
// static ones 120 are structural geometry or theme previews. The 50 ceiling
// cannot be met without changing layouts, so the gate's job here is to stop NEW
// ones appearing while the convertible residue is worked off component by
// component.
if (inline > inlineBaseline) {
  console.error(
    `lint:inline — ${inline} inline style object(s), baseline ${inlineBaseline} (+${inline - inlineBaseline}).\n` +
      'Prefer a utility class or a token; a computed value (width: ${pct}%) legitimately stays inline.',
  )
  process.exit(1)
}

console.log(
  `lint:hex — ${total} colour literals outside the token layer, at the baseline.\n` +
    `lint:type — ${textArbitrary} arbitrary font size(s), at the baseline.\n` +
    `lint:inline — ${inline} inline style object(s) (${inlineDynamic} dynamic), no growth.`,
)
