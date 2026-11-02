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
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    // HTML numeric entities look like colours: `&#039;` matched as `#039`.
    .replace(/&#x?\d+;/gi, ' ')

/** A theme preset IS the palette for its theme, so it holds literals by right. */
const PALETTE_DIRS = ['themes/']

/**
 * Files whose literals are data, not styling: terminal protocols, third-party
 * brand marks, syntax themes, canvas/draw colours, colours injected into a page
 * that has none of our tokens. Each entry says why — an allowlist without reasons
 * becomes a place to hide things.
 */
const PALETTE_FILES = new Map([
  ['app/right-sidebar/terminal/selection.ts', 'ANSI terminal palette: these ARE the terminal colours'],
  ['app/right-sidebar/terminal/use-agent-terminal.ts', 'ANSI terminal palette'],
  ['app/right-sidebar/terminal/use-terminal-session.ts', 'ANSI terminal palette'],
  ['lib/mcp-brands.tsx', 'third-party brand marks (Slack, Discord, GitHub …)'],
  ['app/messaging/platform-icon.tsx', 'third-party brand marks'],
  ['components/chat/code-editor-theme.ts', 'syntax-highlighting theme'],
  ['components/chat/shiki-config.ts', 'syntax-highlighting theme'],
  ['plugins/kanban/types.ts', 'label colour palette chosen per card'],
  ['components/pane-shell/tree/zones-engine.ts', 'canvas draw colours, not DOM styles'],
  ['debug/perf-live.ts', 'canvas overlay drawn outside the token system'],
  ['components/pet/pet-star-shower.tsx', 'particle colours in a canvas animation'],
  ['components/chat/vibe-hearts.tsx', 'particle colours in a canvas animation'],
  ['lib/preview-annotate/tokens.ts', 'injected into the INSPECTED page, which has no Hermes tokens'],
  ['lib/preview-annotate/in-page.ts', 'injected into the INSPECTED page'],
  ['lib/preview-act/watch-in-page.ts', 'injected into the INSPECTED page'],
  ['app/starmap/color.ts', 'data-visualisation colour scale'],
  ['app/starmap/star-map.tsx', 'data-visualisation colour scale'],
  ['app/settings/billing/tier-art.tsx', 'brand artwork'],
  ['app/shell/wslg-window-controls.tsx', 'Windows close-button affordance, matched to the OS'],
  ['plugins/hermes-bots/avatar.tsx', 'seeded identity colour for generated avatars'],
])

/** `var(--token, #fallback)` is a fallback, not a design value: the literal only
 *  applies when the token is missing, which is the token layer's problem. */
const VAR_FALLBACK = /(?:var\(--[\w-]+,\s*|--[\w-]+,\s*)#[0-9a-fA-F]{3,8}\)/g

export function countDebt(root) {
  const src = join(root, 'src')
  let hex = 0
  // An inline style whose values are computed (`width: ${pct}%`) cannot be a
  // class and is not debt. One whose values are all literals can, and is.
  let inline = 0
  let inlineDynamic = 0
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

      if (PALETTE_FILES.has(rel)) {
        continue
      }

      const source = stripComments(readFileSync(full, 'utf8')).replace(VAR_FALLBACK, ' ')
      const hits = source.match(HEX) ?? []

      if (hits.length) {
        hex += hits.length
        offenders.push({ count: hits.length, file: rel })
      }

      if (/\.tsx$/.test(entry.name)) {
        for (const style of source.matchAll(/style=\{\{([\s\S]{0,400}?)\}\}/g)) {
          inline += 1

          if (/[\$]\{/.test(style[1])) {
            inlineDynamic += 1
          }
        }
      }
    }
  }

  walk(src)
  offenders.sort((a, b) => b.count - a.count)

  return { hex, inline, inlineDynamic, inlineStatic: inline - inlineDynamic, offenders }
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
