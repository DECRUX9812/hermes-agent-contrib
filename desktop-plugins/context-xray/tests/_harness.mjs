/**
 * Shared node:vm harness for context-xray/plugin.js.
 *
 * Replicates the desktop runtime's ESM handling the same way the app's loader
 * does (strip the bare SDK/React specifiers, run the module body in a fresh
 * context), so pure helpers and registration can be exercised without a build
 * step and without a browser.
 *
 * Rules this harness obeys (learned the hard way, see the
 * hermes-desktop-plugin-testing skill):
 *   - only plugin-internal helpers are exported to the sandbox; anything that
 *     touches an SDK identifier lives in components the tests never call.
 *   - vm-realm objects carry that realm's Object prototype: tests compare
 *     FIELDS explicitly, never deepEqual against a host literal.
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

/** Names exported from the sandbox for the pure-logic tests. Every one of these
 *  must exist in plugin.js — a missing name throws at load and reddens the file. */
const PURE = [
  'ID',
  'PANE_ID',
  'PANE_REF',
  'TOP_N',
  'CHARS_PER_TOKEN',
  'CATEGORY_COLORS',
  'FALLBACK_COLOR',
  'BASIS_LABEL',
  'BASIS_NOTE',
  'utf8Bytes',
  'estimateTokensFromText',
  'fmtTokens',
  'sharePct',
  'shareLabel',
  'clampPct',
  'categoryColor',
  'normalizeCategories',
  'sumTokens',
  'historyRowMeasure',
  'historyRowLabel',
  'topHistoryRows',
  'estimateFromHistory',
  'buildContributors',
  'configContextLength',
  'resolveWindowMax',
  'usagePercent',
  'chipText',
  'chipLabel',
  'buildContextView',
  'refreshBus',
]

const COMPONENTS = ['XrayPane', 'XrayChip']

const store = (value) => ({ get: () => value, listen: () => () => {}, subscribe: () => () => {} })

const stripImports = (code) =>
  code
    .replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import .* from 'react\/jsx-runtime'\r?\n/m, '')
    .replace(/^import .* from 'react'\r?\n/m, '')

/**
 * Build a sandbox and load the plugin into it.
 *
 * options:
 *   sessionId  – value of host.state.focusedSessionId (null = no active session)
 *   liveUsage  – value of host.state.focusedUsage (the status-bar chip's free source)
 *   data       – { breakdown, history, config } returned per queryKey kind
 *   errors     – { breakdown, history } Error instances to hand back from useQuery
 *   paneVisibility – false removes host.paneVisibility (feature-detect fallback path)
 */
export function makeRuntime(options = {}) {
  const { sessionId = null, liveUsage = null, data = {}, errors = {}, paneVisibility = true } = options

  const contributions = []
  const requests = []

  const context = {
    // SDK constants the module reads at register/declaration scope. The app's real
    // @hermes/plugin-sdk exports these; the sandbox has to provide them too.
    STATUSBAR_AREAS: { left: 'statusbar.left', right: 'statusbar.right' },
    PANES_AREA: 'panes',
    atom: store,
    jsx: (type, props = {}) => ({ $$el: true, type, props: props || {} }),
    jsxs: (type, props = {}) => ({ $$el: true, type, props: props || {} }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
    useEffect: (fn) => {
      try {
        fn()
      } catch {
        /* stub: effects never throw into a test */
      }
      return undefined
    },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useQuery: (query) => {
      const key = Array.isArray(query && query.queryKey) ? query.queryKey : []
      const kind = String(key[1] || '')
      const payload = kind === 'config' ? data.config : kind === 'chip' ? data.breakdown : data[kind]
      return {
        data: payload === undefined ? null : payload,
        error: errors[kind] || null,
        isLoading: false,
        isError: !!errors[kind],
      }
    },
    useQueryClient: () => ({ invalidateQueries: () => undefined }),
    useValue: (value) => (value && typeof value.get === 'function' ? value.get() : null),
    console,
  }

  context.host = {
    request: (method, params) => {
      requests.push({ method, params })
      return Promise.resolve(null)
    },
    state: {
      focusedSessionId: store(sessionId),
      activeSessionId: store(null),
      focusedUsage: store(liveUsage),
    },
  }
  if (paneVisibility) {
    context.host.paneVisibility = () => store(true)
  }

  const code = stripImports(SOURCE)
    .replace('export default {', 'globalThis.plugin = {')
    .concat(`\nglobalThis.__pure = { ${PURE.join(', ')} };\nglobalThis.__components = { ${COMPONENTS.join(', ')} };\n`)

  vm.runInNewContext(code, context)

  return {
    context,
    plugin: context.plugin,
    pure: context.__pure,
    components: context.__components,
    contributions,
    requests,
    register() {
      context.plugin.register({
        register: (item) => contributions.push(item),
      })
      return contributions
    },
  }
}

/** Flatten a jsx tree (components are invoked) into its text nodes. */
export function textOf(node, out = []) {
  if (node === null || node === undefined || node === true || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out)
    return out
  }
  if (typeof node === 'object') {
    if (typeof node.type === 'function') {
      textOf(node.type(node.props || {}), out)
      return out
    }
    textOf(node.props && node.props.children, out)
  }
  return out
}

export function text(tree) {
  return textOf(tree).join(' ')
}

/** A realistic session.context_breakdown payload. */
export function sampleBreakdown(overrides = {}) {
  return {
    categories: [
      { id: 'system_prompt', label: 'System prompt', color: 'var(--context-usage-system)', tokens: 8400 },
      { id: 'tool_definitions', label: 'Tool definitions', color: 'var(--context-usage-tools)', tokens: 21200 },
      { id: 'skills', label: 'Skills', color: 'var(--context-usage-skills)', tokens: 3100 },
      { id: 'conversation', label: 'Conversation', color: 'var(--context-usage-conversation)', tokens: 9600 },
    ],
    context_max: 200000,
    context_percent: 21,
    context_estimated: false,
    context_source: 'provider_usage',
    context_used: 42300,
    estimated_total: 42300,
    model: 'deepseek-v4.1-flash',
    ...overrides,
  }
}

/** A realistic session.history payload (display projection). */
export function sampleHistory(overrides = {}) {
  return {
    count: 3,
    messages: [
      { role: 'user', text: 'x'.repeat(400) }, // 100 tokens
      { role: 'assistant', text: 'y'.repeat(120) }, // 30 tokens
      { role: 'tool', name: 'terminal', text: 'z'.repeat(800), args: { command: 'ls' } }, // 201 tokens
    ],
    ...overrides,
  }
}
