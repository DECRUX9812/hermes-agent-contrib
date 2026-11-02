// The single implementation of "how many colour literals outside the token
// layer" and "how many inline style objects". Both the pre-commit ratchet
// (lint-hex-tokens.mjs) and the external debt audit read this, so the two
// numbers cannot drift apart — they did, for weeks, while comments full of
// issue numbers (`#89206`) were counted as colours.
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Valid CSS colour lengths only. `#89206` is an issue reference. */
export const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g

/** Comments carry prose, issue ids and examples; none of it is a design value. */
export const stripComments = source =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** A theme preset IS the palette for its theme, so it holds literals by right. */
const PALETTE_DIRS = ['themes/']

export function countDebt(root) {
  const src = join(root, 'src')
  let hex = 0
  let inline = 0
  const offenders = []

  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!['node_modules', '__snapshots__'].includes(entry.name)) {
          walk(full)
        }

        continue
      }

      if (!/\.(ts|tsx)$/.test(entry.name)) {
        continue
      }

      const rel = relative(src, full).replaceAll('\\', '/')

      if (/\.test\./.test(rel) || PALETTE_DIRS.some(dirName => rel.startsWith(dirName))) {
        continue
      }

      const source = stripComments(readFileSync(full, 'utf8'))
      const hits = source.match(HEX) ?? []

      if (hits.length) {
        hex += hits.length
        offenders.push({ count: hits.length, file: rel })
      }

      if (/\.tsx$/.test(entry.name)) {
        inline += (source.match(/style=\{\{/g) ?? []).length
      }
    }
  }

  walk(src)
  offenders.sort((a, b) => b.count - a.count)

  return { hex, inline, offenders }
}

// CLI: `node scripts/hex-count.mjs <apps/desktop>` prints the JSON the audit
// reads, so the gate and the ratchet share one implementation.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2]

  if (!root) {
    console.error('usage: node scripts/hex-count.mjs <apps/desktop>')
    process.exit(2)
  }

  process.stdout.write(JSON.stringify(countDebt(root), null, 2))
}
