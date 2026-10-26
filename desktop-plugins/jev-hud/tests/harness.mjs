/**
 * Shared node:vm harness for the jev-hud plugin tests.
 *
 * The plugin is read as text, its three import lines are stripped (the vm cannot resolve
 * bare specifiers) and the module is evaluated in a sandbox whose globals stand in for the
 * SDK surface it uses. `export default {` is rewritten so register() is reachable, and the
 * plugin's pure helpers + components are re-exported onto `globalThis.__hud`.
 *
 * Rules this harness obeys (see the hermes-desktop-plugin-testing skill):
 *  - never deepEqual whole vm-realm objects — compare fields explicitly;
 *  - every identifier the concat line names must already exist in plugin.js.
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

const SDK_STUB = {
  PALETTE_AREA: 'palette',
  STATUSBAR_AREAS: { left: 'statusbar.left', right: 'statusbar.right' },
  queryClient: { invalidateQueries: () => undefined },
}

/**
 * @param {object} [options]
 * @param {{recent?: object, summary?: object}} [options.queries] payloads the useQuery stub
 *        returns, keyed by the second element of the query key ('recent' | 'summary').
 * @param {object} [options.host] extra host overrides.
 */
export function loadPlugin(options = {}) {
  const queries = options.queries || {}
  const jsx = (type, props) => ({ $$el: true, type, props: props || {} })
  const context = {
    console,
    jsx,
    jsxs: jsx,
    useState: (value) => [value, () => undefined],
    useQuery: (opts) => {
      const key = opts && Array.isArray(opts.queryKey) ? opts.queryKey[1] : ''
      const given = key === 'recent' ? queries.recent : queries.summary
      return Object.assign({ data: undefined, isLoading: false, isError: false, isFetching: false }, given || {})
    },
    useQueryClient: () => ({ invalidateQueries: () => undefined }),
    host: Object.assign(
      {
        navigate: () => undefined,
        notify: () => undefined,
        request: async () => ({}),
        paneVisibility: () => ({ get: () => true }),
      },
      options.host || {},
    ),
    ...SDK_STUB,
  }

  const code = SOURCE.replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import .* from 'react'\r?\n/m, '')
    .replace(/^import .* from 'react\/jsx-runtime'\r?\n/m, '')
    .replace('export default {', 'globalThis.plugin = {')
    .concat(
      '\nglobalThis.__hud = { pct, ageSeconds, fmtAge, verdictTone, shortVerdict, classifyRestError,' +
        ' classifyPayload, fmtNumber, sourceLine, verdictLine, HudPane, HudChip, HudSummary, DecisionRow, DecisionDetail };\n',
    )

  vm.runInNewContext(code, context, { filename: 'plugin.js' })
  return context
}

/** Run the plugin's register() against a recording context; returns the contributions. */
export function register(plugin, overrides = {}) {
  const entries = []
  const ctx = Object.assign(
    {
      source: 'plugin:jev-hud',
      register: (contribution) => {
        entries.push(contribution)
        return () => undefined
      },
      registerMany: (list) => {
        list.forEach((c) => entries.push(c))
        return () => undefined
      },
      rest: () => Promise.reject(new Error('no backend in tests')),
      storage: { get: () => null, set: () => undefined, remove: () => undefined },
      onEvent: () => () => undefined,
      os: { notify: () => undefined },
    },
    overrides,
  )
  plugin.register(ctx)
  return entries
}

/** Expand a jsx tree, invoking function components, so text can be asserted on it. */
export function expand(node) {
  if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map(expand)
  if (typeof node !== 'object' || !node.$$el) return node
  const { type, props } = node
  if (typeof type === 'function') return expand(type(props || {}))
  const next = Object.assign({}, props)
  next.children = expand(props && props.children)
  return { $$el: true, type, props: next }
}

/** All text in an expanded tree, joined — enough for `assert.match`. */
export function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'object' && node.$$el) return textOf(node.props && node.props.children)
  return ''
}

/** Render a contribution's render() output to plain text. */
export function renderText(element) {
  return textOf(expand(element))
}
