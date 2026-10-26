// Bundles the fork's Bot Mode 2.0 source into one desktop-plugin plugin.js.
// Usage: node build.mjs <path-to-esbuild-package-dir>
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const esbuildDir = process.argv[2]

if (!esbuildDir) {
  console.error('usage: node build.mjs <dir containing node_modules with esbuild + nanostores>')
  process.exit(2)
}

const require = createRequire(resolve(esbuildDir, 'package.json'))
const esbuild = require('esbuild')
const compat = resolve(here, 'sdk-compat.ts')
const outfile = resolve(here, '../../desktop-plugins/hermes-bots-plus/plugin.js')
const HOST = new Set(['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'])

const hostImports = {
  name: 'host-imports',
  setup(build) {
    build.onResolve({ filter: /^@hermes\/plugin-sdk$/ }, args =>
      args.importer === compat ? { external: true, path: args.path } : { path: compat }
    )
    build.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, args => ({ external: true, path: args.path }))
    build.onResolve({ filter: /^nanostores$/ }, () => ({ path: require.resolve('nanostores') }))
    // The VNC screen viewer is an app dependency, not a plugin one; the pane
    // reports the import failure instead of bundling a VNC client.
    build.onResolve({ filter: /^@novnc\/novnc$/ }, () => ({ namespace: 'unavailable', path: 'novnc' }))
    build.onLoad({ filter: /.*/, namespace: 'unavailable' }, () => ({
      contents: "throw new Error('The VNC viewer is not available in the hermes-bots-plus overlay build')",
      loader: 'js'
    }))
  }
}

await esbuild.build({
  bundle: true,
  entryPoints: [resolve(here, 'src/plugin.tsx')],
  format: 'esm',
  jsx: 'automatic',
  logLevel: 'warning',
  outfile,
  plugins: [hostImports],
  target: 'es2022'
})

// Checked on the emitted file, not the metafile: esbuild's metafile flags
// type-only relative imports as external even though nothing is emitted.
const bundle = readFileSync(outfile, 'utf8')
const SPECIFIER_PATTERNS = [
  /^\s*(?:import|export)\b[^\n;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^\s*import\s*["']([^"']+)["']/gm,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g
]
const specifiers = new Set(SPECIFIER_PATTERNS.flatMap(pattern => [...bundle.matchAll(pattern)].map(match => match[1])))
const leaked = [...specifiers].filter(path => !HOST.has(path))

if (leaked.length) {
  console.error(`non-host imports would fail the loader allowlist: ${leaked.join(', ')}`)
  process.exit(1)
}

console.log(`built ${outfile} (${(bundle.length / 1024).toFixed(0)} KiB)`)
