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

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const HERE = import.meta.dirname
const DESKTOP_ROOT = resolve(HERE, '..')
const SRC = join(DESKTOP_ROOT, 'src')
const BASELINE = join(HERE, 'hex-baseline.json')

/** Files whose job is to define colour. Everything else consumes tokens. */
const DEFINITION_FILES = new Set(['src/styles.css', 'src/design/vocabulary.css'])

/** A theme preset IS a palette: it is the token layer for its theme, so it may
 *  hold literals by definition. Component code may not. */
const DEFINITION_DIRS = ['src/themes/']

/** CSS colours are 3, 4, 6 or 8 hex digits — nothing else. */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g

/** Strip comments before counting. `// #94570` is an issue reference, not a
 *  design decision, and counting them inflated the first baseline by hundreds —
 *  the audit script this mirrors still has that flaw. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const SOURCE_EXT = /\.(ts|tsx)$/

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__snapshots__') {
        walk(full, out)
      }

      continue
    }

    if (SOURCE_EXT.test(entry.name)) {
      out.push(full)
    }
  }

  return out
}

const files = walk(SRC)
const offenders = []

for (const file of files) {
  const rel = relative(DESKTOP_ROOT, file).replaceAll('\\', '/')

  if (DEFINITION_FILES.has(rel) || DEFINITION_DIRS.some(dir => rel.startsWith(dir)) || /\.test\.[cm]?[tj]sx?$/.test(rel)) {
    continue
  }

  const hits = withoutComments(readFileSync(file, 'utf8')).match(HEX)

  if (hits) {
    offenders.push({ rel, count: hits.length, sample: [...new Set(hits)].slice(0, 3).join(' ') })
  }
}

const total = offenders.reduce((sum, entry) => sum + entry.count, 0)
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
