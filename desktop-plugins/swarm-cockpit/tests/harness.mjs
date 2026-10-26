// Shared node:vm harness for the swarm-cockpit plugin tests.
//
// plugin.js is read as text, its imports stripped, `export default` rewritten to a
// global, and internal helpers re-exported onto `globalThis` for assertions.
// Objects built inside the vm carry that realm's prototypes, so every assertion
// here compares FIELDS explicitly — never deepEqual across realms.

import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

const HELPER_EXPORTS = [
  'statusKey',
  'statusMeta',
  'isLiveRow',
  'normalizeRow',
  'sortRows',
  'buildForest',
  'flattenForest',
  'formatAge',
  'ageSeconds',
  'ageLine',
  'metaLine',
  'clip',
  'tailLines',
  'activityLine',
  'counts',
  'chipLabel',
  'chipTitle',
  'rpcErrorCopy',
  'SubagentRow',
]

/** plugin.js with its imports stripped, `export default` globalised and internals
 *  re-exported onto the vm global (extraExports lets a test pull components too). */
export function pluginSourceCode(extraExports = []) {
  const names = [...HELPER_EXPORTS, ...extraExports]

  return source
    .replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import .* from 'react\/jsx-runtime'\r?\n/m, '')
    .replace(/^import .* from 'react'\r?\n/m, '')
    .replace('export default {', 'globalThis.plugin = {')
    .concat(
      '\nglobalThis.__helpers = { ' +
        names.map((name) => `${name}: typeof ${name} === 'function' ? ${name} : undefined`).join(', ') +
        ' };\n'
    )
}

/**
 * Load plugin.js into a fresh vm context.
 *
 * options.revealCalls  — array that host.revealPane records into
 * options.hostState    — atoms exposed as host.state.*
 */
export function loadPlugin({ revealCalls = [], hostState = {} } = {}) {
  const atom = (value) => ({
    get: () => value,
    set: () => undefined,
    listen: () => undefined,
  })
  const jsx = (type, props = {}) => ({ $$el: true, type, props })

  const subscriptions = []
  const requests = []

  const context = {
    atom,
    jsx,
    jsxs: jsx,
    // Area constants exactly as the real SDK exports them (desktop/src/sdk/index.ts):
    //   PANES_AREA = 'panes', STATUSBAR_AREAS.right = 'statusBar.right', PALETTE_AREA = 'palette'
    PANES_AREA: 'panes',
    STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
    PALETTE_AREA: 'palette',
    // react — components are only rendered in the render-smoke tests; the effects
    // are deliberately inert so no timer is created inside the vm.
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
    useEffect: () => undefined,
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    // SDK
    useValue: (value) => (value && typeof value.get === 'function' ? value.get() : null),
    cn: (...parts) => parts.filter(Boolean).join(' '),
    // UI kit: transparent wrappers — jsx() records the element, and invoking one
    // renders its children so their text stays visible to textOf().
    Button: (props = {}) => props.children ?? null,
    Codicon: () => null,
    Input: (props = {}) => props.children ?? null,
    host: {
      state: hostState,
      request: async (method, params) => {
        requests.push({ method, params })
        return { subagents: [], delegations: [] }
      },
      revealPane: (id) => revealCalls.push(id),
      notify: () => undefined,
    },
    // enough DOM for the module-level guards
    document: { visibilityState: 'visible' },
  }

  const code = pluginSourceCode()

  vm.runInNewContext(code, context)

  return { context, plugin: context.plugin, helpers: context.__helpers, subscriptions, requests }
}

/** Collect every string rendered in a jsx()/jsxs() tree. */
export function textOf(node, out = [], depth = 0) {
  if (node === null || node === undefined || node === false || depth > 24) {
    return out
  }

  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      textOf(child, out, depth)
    }

    return out
  }

  if (typeof node === 'object' && node.$$el) {
    // A component element: invoke it and walk what it returns. Children come in
    // through props, so walking both would double every string.
    if (typeof node.type === 'function') {
      textOf(node.type(node.props || {}), out, depth + 1)
      return out
    }

    textOf(node.props && node.props.children, out, depth + 1)
  }

  return out
}

/** Every element type name in a jsx()/jsxs() tree (strings, components, slots). */
export function typesOf(node, out = []) {
  if (node === null || node === undefined || node === false) {
    return out
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      typesOf(child, out)
    }

    return out
  }

  if (typeof node === 'object' && node.$$el) {
    out.push(node.type)
    typesOf(node.props && node.props.children, out)
  }

  return out
}

/** Every element (with its props) in a jsx()/jsxs() tree matching `predicate`. */
export function findElements(node, predicate, out = [], depth = 0) {
  if (node === null || node === undefined || node === false || depth > 24) {
    return out
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      findElements(child, predicate, out, depth)
    }

    return out
  }

  if (typeof node === 'object' && node.$$el) {
    if (predicate(node)) {
      out.push(node)
    }

    if (typeof node.type === 'function') {
      findElements(node.type(node.props || {}), predicate, out, depth + 1)
      return out
    }

    findElements(node.props && node.props.children, predicate, out, depth + 1)
  }

  return out
}
