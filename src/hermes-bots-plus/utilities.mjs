// Plugin-only Tailwind utilities.
//
// The host stylesheet only contains classes the host build saw. An arbitrary
// class used only by this plugin (`size-[34px]`, `bg-(--ui-accent)/12`, …)
// is in no stylesheet and silently does nothing. This compiles exactly the
// plugin's class candidates that the host CSS lacks, with the host's own
// variants, so the plugin can mount them in `@layer utilities` at register.
// Classes the host already has are never re-emitted: a later duplicate of a
// base class would beat the host's own responsive variant on the same element.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const HOST_PRELUDE = `@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme) theme(reference);
@import 'tailwindcss/utilities.css' layer(utilities);
@custom-variant hover (&:hover);
@custom-variant dark (&:is(.dark *));
@custom-variant compact (@media (max-height: 768px));
`

const esc = cls => cls.replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`)

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      return sourceFiles(path)
    }

    return /\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
  })
}

/** Only arbitrary-value candidates: named utilities are the host's vocabulary. */
export function arbitraryCandidates(text) {
  const out = new Set()

  for (const token of text.split(/[\s'"`{}]+/)) {
    if (/^[!a-z0-9:/@\-[\]().,_%#*+&=>~]+$/i.test(token) && /-(\[[^\]\s]+\]|\(--[^)\s]+\))/.test(token)) {
      out.add(token)
    }
  }

  return out
}

export async function pluginUtilitiesCss({ require, srcDir, hostCss = '' }) {
  const { compile } = require('@tailwindcss/node')
  const candidates = new Set()

  for (const file of sourceFiles(srcDir)) {
    for (const c of arbitraryCandidates(readFileSync(file, 'utf8'))) {
      candidates.add(c)
    }
  }

  const missing = [...candidates].filter(c => !hostCss.includes(`.${esc(c)}`)).sort()
  const compiler = await compile(HOST_PRELUDE, { base: require.resolve('tailwindcss/package.json').replace(/\/[^/]*$/, ''), onDependency() {} })
  const css = compiler.build(missing)
  // Drop the theme/base/components layer stubs and any :root/@property noise;
  // keep the utilities layer only (host already owns theme variables).
  const start = css.indexOf('@layer utilities')

  return { css: start >= 0 ? css.slice(start) : '', missing }
}
