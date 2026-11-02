#!/usr/bin/env node
// Convert inline style objects to classes — only where the translation is exact.
//
// The debt counter says ~139 static inline styles. Hand-converting six a round is
// 23 rounds of typing; a codemod is the only honest way to move the number. But
// a codemod that reflows layout is worse than the debt, so this one refuses
// anything it cannot express as a single, exact utility class:
//
//   - every property must map to a Tailwind utility with the same computed value
//   - the element must already carry a literal className to append to
//   - the className must not already set that utility family (adding `p-[8px]`
//     next to `px-2` invites a specificity argument nobody wins)
//
//   node scripts/codemod-inline-styles.mjs          # dry run: what would change
//   node scripts/codemod-inline-styles.mjs --apply  # rewrite the files
//
// Anything it cannot translate with certainty is left alone — it is a broom,
// not a refactorer.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.argv[2]?.startsWith('--') || !process.argv[2] ? process.cwd() : process.argv[2]
const APPLY = process.argv.includes('--apply')
const SRC = join(ROOT, 'src')

/** property → [utility prefix, allowed values] ; value `n` means a pixel number. */
const MAP = {
  alignItems: ['items-', ['flex-start', 'center', 'flex-end', 'baseline', 'stretch']],
  borderRadius: ['rounded-[', 'px'],
  color: ['text-(', 'var'],
  backgroundColor: ['bg-(', 'var'],
  display: ['', ['flex', 'grid', 'inline-flex', 'block', 'inline-block', 'none']],
  flex: ['flex-', ['none', '1', 'auto']],
  flexWrap: ['flex-', ['wrap', 'nowrap']],
  cursor: ['cursor-', ['pointer', 'default', 'text', 'move', 'not-allowed']],
  objectFit: ['object-', ['cover', 'contain', 'fill', 'none']],
  background: ['bg-(', 'var'],
  borderColor: ['border-(', 'var'],
  fontSize: ['text-[', 'px'],
  gap: ['gap-[', 'px'],
  justifyContent: ['justify-', ['flex-start', 'center', 'flex-end', 'space-between', 'space-around']],
  lineHeight: ['leading-[', 'px'],
  margin: ['m-[', 'px'],
  marginBottom: ['mb-[', 'px'],
  marginLeft: ['ml-[', 'px'],
  marginRight: ['mr-[', 'px'],
  marginTop: ['mt-[', 'px'],
  maxHeight: ['max-h-[', 'px'],
  maxWidth: ['max-w-[', 'px'],
  bottom: ['bottom-[', 'px'],
  height: ['h-[', 'px'],
  left: ['left-[', 'px'],
  right: ['right-[', 'px'],
  top: ['top-[', 'px'],
  width: ['w-[', 'px'],
  zIndex: ['z-[', 'int'],
  minHeight: ['min-h-[', 'px'],
  minWidth: ['min-w-[', 'px'],
  overflow: ['overflow-', ['auto', 'hidden', 'visible', 'scroll']],
  position: ['', ['absolute', 'relative', 'fixed', 'sticky']],
  padding: ['p-[', 'px'],
  paddingBottom: ['pb-[', 'px'],
  paddingLeft: ['pl-[', 'px'],
  paddingRight: ['pr-[', 'px'],
  paddingTop: ['pt-[', 'px']
}

/** Families whose existing presence means "do not add another". */
const FAMILY = {
  alignItems: ['items-'],
  color: ['text-'],
  backgroundColor: ['bg-'],
  background: ['bg-'],
  borderColor: ['border-'],
  cursor: ['cursor-'],
  objectFit: ['object-'],
  flexWrap: ['flex-'],
  borderRadius: ['rounded-'],
  display: ['flex', 'grid', 'block', 'hidden', 'inline-'],
  flex: ['flex-'],
  fontSize: ['text-'],
  gap: ['gap-'],
  justifyContent: ['justify-'],
  lineHeight: ['leading-'],
  margin: ['m-'],
  marginBottom: ['mb-'],
  marginLeft: ['ml-'],
  marginRight: ['mr-'],
  marginTop: ['mt-'],
  maxHeight: ['max-h-'],
  maxWidth: ['max-w-'],
  bottom: ['bottom-'],
  height: ['h-'],
  left: ['left-'],
  right: ['right-'],
  top: ['top-'],
  width: ['w-'],
  zIndex: ['z-'],
  minHeight: ['min-h-'],
  minWidth: ['min-w-'],
  overflow: ['overflow-'],
  position: ['absolute', 'relative', 'fixed', 'sticky'],
  padding: ['p-'],
  paddingBottom: ['pb-'],
  paddingLeft: ['pl-'],
  paddingRight: ['pr-'],
  paddingTop: ['pt-']
}

const QUOTED = /^['"]([^'"]+)['"]$/

/** `maxHeight: 200` → `max-h-[200px]`, or null when it is not a certain match. */
function toClass(property, rawValue) {
  const entry = MAP[property]

  if (!entry) {
    return null
  }

  const [prefix, kind] = entry
  const value = rawValue.trim()

  // Tailwind v4 shorthand: `text-(--token)` is exactly `color: var(--token)`.
  if (kind === 'var') {
    const token = value.match(/^['"]var\((--[\w-]+)\)['"]$/)?.[1]

    return token ? `${prefix}${token})` : null
  }

  if (kind === 'int') {
    if (!/^-?\d+$/.test(value)) {
      return null
    }

    return `${prefix}${value}]`
  }

  if (kind === 'px') {
    // `12` and `'12px'` are the same length; both become max-h-[12px].
    const pixels = /^\d+$/.test(value) ? value : value.match(/^['"](\d+)px['"]$/)?.[1]

    return pixels ? `${prefix}${pixels}px]` : null
  }

  const quoted = value.match(QUOTED)?.[1]

  if (!quoted || !kind.includes(quoted)) {
    return null
  }

  return `${prefix}${quoted}`
}

/** Colour utilities need a narrower conflict test: `text-sm` is a size, and
 *  treating it as "text colour already set" blocked every colour conversion. */
const COLOUR_FAMILIES = new Set(['color', 'backgroundColor'])

const COLOUR_IN_CLASS = /(^|\s)(text|bg)-(\(--|[a-z]+-?\d{2,3}\b|white\b|black\b|transparent\b|current\b)/

const familiesPresent = className => family => {
  if (COLOUR_FAMILIES.has(family)) {
    return COLOUR_IN_CLASS.test(className)
  }

  return FAMILY[family].some(prefix => new RegExp(`(^|\\s)${prefix.replace('[', '\\[')}`).test(className))
}

const report = []
let converted = 0

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!['node_modules', '__snapshots__'].includes(entry.name)) {
        walk(full)
      }

      continue
    }

    if (!/\.tsx$/.test(entry.name)) {
      continue
    }

    const rel = relative(SRC, full)

    if (/\.test\./.test(rel)) {
      continue
    }

    const source = readFileSync(full, 'utf8')
    let next = source

    for (const match of [...source.matchAll(/style=\{\{([\s\S]{0,300}?)\}\}/g)]) {
      const [whole, body] = match
      const parts = body
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)

      if (!parts.length) {
        continue
      }

      const classes = []
      let allMapped = true

      for (const part of parts) {
        const colon = part.indexOf(':')

        if (colon < 0) {
          allMapped = false
          break
        }

        const property = part.slice(0, colon).trim()
        const cls = toClass(property, part.slice(colon + 1))

        if (!cls) {
          allMapped = false
          break
        }

        classes.push({ cls, property })
      }

      if (!allMapped) {
        continue
      }

      // The owning element must already have a literal className. It may sit
      // either side of the style attribute — JSX does not fix the order, and
      // only looking backwards silently refused most of the file set.
      const at = next.indexOf(whole)
      const windowStart = Math.max(0, at - 600)
      const before = next.slice(0, at)
      const after = next.slice(at + whole.length, at + whole.length + 600)
      const backAt = before.lastIndexOf('className="')
      const forwardAt = after.indexOf('className="')

      let classNameAt = -1

      if (backAt >= windowStart) {
        classNameAt = backAt
      } else if (forwardAt >= 0) {
        const abs = at + whole.length + forwardAt
        const close = next.indexOf('"', abs + 11)
        const existing = next.slice(abs + 11, close)
        const hasForward = familiesPresent(existing)

        if (close < 0) {
          continue
        }

        const parts2 = classes.filter(({ property }) => !hasForward(property)).map(({ cls }) => cls)

        if (parts2.length !== classes.length) {
          continue
        }

        next = next.slice(0, close) + ` ${parts2.join(' ')}` + next.slice(close) + next.slice(at + whole.length + forwardAt)
        next = next.replace(whole, '')

        converted += 1
        report.push(`${rel}: +${parts2.join(' ')} (forward)`)
        continue
      }

      if (classNameAt < 0) {
        continue
      }

      const close = before.indexOf('"', classNameAt + 11)

      if (close < 0) {
        continue
      }

      const existing = before.slice(classNameAt + 11, close)
      const has = familiesPresent(existing)

      if (classes.some(({ property }) => has(property))) {
        continue
      }

      const added = classes.map(({ cls }) => cls).join(' ')
      const replaced = before.slice(0, close) + ` ${added}` + before.slice(close) + next.slice(next.indexOf(whole) + whole.length)

      next = replaced
      converted += 1
      report.push(`${rel}: +${added}`)
    }

    if (APPLY && next !== source) {
      writeFileSync(full, next)
    }
  }
}

walk(SRC)

for (const line of report) {
  console.log(line)
}

console.log(`\n${APPLY ? 'converted' : 'would convert'} ${converted} inline style object(s)`)
