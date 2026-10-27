// Bundles the fork's Bot Mode 2.0 source into one desktop-plugin plugin.js.
// Usage: node build.mjs <path-to-esbuild-package-dir>
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pluginUtilitiesCss } from './utilities.mjs'

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

// Plugin-only arbitrary utilities (see utilities.mjs), filtered against the
// host stylesheet named by HOST_CSS_DIR (default: the overlay's webapp dist).
const hostCssDir = process.env.HOST_CSS_DIR || resolve(homedir(), 'Code/hermes-overlay-core/apps/desktop/dist-webapp/assets')
const hostCss = existsSync(hostCssDir)
  ? readdirSync(hostCssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(resolve(hostCssDir, f), 'utf8')).join('')
  : ''
const utilities = await pluginUtilitiesCss({ require, srcDir: resolve(here, 'src'), hostCss })
const utilitiesCss = require('@tailwindcss/node').optimize?.(utilities.css, { minify: true })?.code ?? utilities.css

// noVNC (MPL-2.0) from the core checkout's node_modules, self-contained ESM.
const novnc = await esbuild.build({
  bundle: true,
  entryPoints: [require.resolve('@novnc/novnc')],
  format: 'esm',
  legalComments: 'inline',
  logLevel: 'warning',
  minify: true,
  target: 'es2022',
  write: false
})
const novncSource = `/* noVNC ${JSON.parse(readFileSync(resolve(dirname(require.resolve('@novnc/novnc')), '../package.json'), 'utf8')).version}, MPL-2.0, https://github.com/novnc/noVNC */\n${novnc.outputFiles[0].text}`
const novncLoader = `const source = ${JSON.stringify(novncSource)}
let loading = null
export function loadNovnc() {
  if (!loading) {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    loading = import(url).finally(() => URL.revokeObjectURL(url))
    loading.catch(() => { loading = null })
  }
  return loading
}`

const hostImports = {
  name: 'host-imports',
  setup(build) {
    build.onResolve({ filter: /^@hermes\/plugin-sdk$/ }, args =>
      args.importer === compat ? { external: true, path: args.path } : { path: compat }
    )
    build.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, args => ({ external: true, path: args.path }))
    build.onResolve({ filter: /^virtual:plugin-utilities$/ }, () => ({ namespace: 'plugin-utilities', path: 'css' }))
    build.onLoad({ filter: /.*/, namespace: 'plugin-utilities' }, () => ({
      contents: `export default ${JSON.stringify(utilitiesCss)}`,
      loader: 'js'
    }))
    build.onResolve({ filter: /^nanostores$/ }, () => ({ path: require.resolve('nanostores') }))
    // The VNC client rides along as module text and is evaluated from a blob
    // only when a screen attaches, so plugin load never pays for it. It has
    // top-level await, so it cannot sit inline in this bundle.
    build.onResolve({ filter: /^@novnc\/novnc$/ }, () => ({ namespace: 'novnc', path: 'rfb' }))
    build.onLoad({ filter: /.*/, namespace: 'novnc' }, () => ({ contents: novncLoader, loader: 'js' }))
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

console.log(`built ${outfile} (${(bundle.length / 1024).toFixed(0)} KiB; ${utilities.missing.length} plugin-only utilities, host css ${hostCss ? 'found' : 'MISSING'})`)
