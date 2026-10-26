/**
 * vm harness for the local-model-deck desktop plugin.
 *
 * Reads plugin.js as text, strips the import blocks, runs the module in a node:vm sandbox with
 * a stubbed SDK surface, and exposes the internals the tests poke. Mirrors the convention in
 * ~/.hermes/skills/software-development/hermes-desktop-plugin-testing/SKILL.md.
 */

import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

/**
 * Internals exported for the tests. Every name MUST exist in plugin.js: the export line below
 * evaluates at vm load, so a typo fails every test in the file, not just one.
 */
export const EXPORTED = [
  'orNull',
  'baseName',
  'shortId',
  'modelFromProps',
  'nCtxFromProps',
  'totalSlotsFromProps',
  'slotsSummary',
  'modelFromCmdline',
  'fmtBytes',
  'fmtCount',
  'fmtCtx',
  'fmtRss',
  'fmtUptime',
  'fmtClock',
  'metricsRow',
  'runtimeRow',
  'processRow',
  'deckStatus',
  'backendState',
  'errorText',
  'DeckPane',
  'DeckChip',
]

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
}

export function loadPlugin(overrides = {}) {
  const jsx = (type, props = {}) => ({ $$el: true, type, props: props || {} })
  const atom = (value) => ({ get: () => value, set: () => undefined, listen: () => () => {} })
  const context = {
    jsx,
    jsxs: jsx,
    atom,
    queryClient: { invalidateQueries: () => undefined },
    useValue: (a) => (a && typeof a.get === 'function' ? a.get() : null),
    useQuery: () => ({ data: null, isLoading: false, isError: false, error: null }),
    host: { notify: () => undefined, navigate: () => undefined },
    PALETTE_AREA: 'palette',
    STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
    ...overrides,
  }
  const code = SOURCE
    .replace(/^import\s*\{[\s\S]*?\}\s*from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import\s*\{[\s\S]*?\}\s*from 'react\/jsx-runtime'\r?\n/m, '')
    .replace('export default {', 'globalThis.plugin = {')
    .concat('\n' + EXPORTED.map((name) => `globalThis.__${name} = ${name};`).join('\n'))
  vm.runInNewContext(code, context)
  return context
}

/** Flatten a jsx tree to its visible text, invoking function components as it goes. */
export function textOf(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (typeof node === 'object' && node.$$el) {
    const props = node.props || {}
    if (typeof node.type === 'function') return textOf(node.type(props), out)
    textOf(props.children, out)
    return out
  }
  return out
}
