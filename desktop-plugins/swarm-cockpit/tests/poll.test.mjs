// Live-update tests for the pane: the poll fires `subagent.list` with the focused
// runtime session id on a 2s cadence, a real roster renders, the RPC is skipped
// while the pane is hidden or the gateway is down, a refusal becomes copy instead
// of a fake row, and the interval is cleared on unmount.
//
// The hooks here are a tiny React stand-in (state persists across renders, effects
// are collected and run by the test, timers are captured instead of scheduled).

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import vm from 'node:vm'

import { pluginSourceCode, textOf } from './harness.mjs'

const flush = async (turns = 4) => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

const atomOf = (value) => ({ get: () => value, set: () => undefined, listen: () => undefined })

/** Shallow dep comparison — the same rule React uses for useMemo/useCallback. */
function sameDeps(prev, next) {
  if (!prev || !next || prev.length !== next.length) {
    return false
  }

  return prev.every((value, i) => Object.is(value, next[i]))
}

function createRuntime({ requestImpl, hostState = {}, paneVisible = true } = {}) {
  const hooks = { state: [], memo: [], effects: [] }
  const calls = []
  const timers = []
  const cleared = []
  let index = 0

  const context = {
    atom: atomOf,
    jsx: (type, props = {}) => ({ $$el: true, type, props }),
    jsxs: (type, props = {}) => ({ $$el: true, type, props }),
    PANES_AREA: 'panes',
    STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
    PALETTE_AREA: 'palette',
    cn: (...parts) => parts.filter(Boolean).join(' '),
    Button: (props = {}) => props.children ?? null,
    Codicon: () => null,
    Input: (props = {}) => props.children ?? null,
    useValue: (value) => (value && typeof value.get === 'function' ? value.get() : null),
    useState: (initial) => {
      const slot = index
      index += 1

      if (hooks.state.length <= slot) {
        hooks.state[slot] = typeof initial === 'function' ? initial() : initial
      }

      const set = (next) => {
        hooks.state[slot] = typeof next === 'function' ? next(hooks.state[slot]) : next
      }

      return [hooks.state[slot], set]
    },
    useMemo: (fn, deps) => {
      const slot = index
      index += 1

      const prev = hooks.memo[slot]
      const stale = !prev || !sameDeps(prev.deps, deps)

      if (stale) {
        hooks.memo[slot] = { deps: deps ? [...deps] : null, value: fn() }
      }

      return hooks.memo[slot].value
    },
    useCallback: (fn) => fn,
    useEffect: (fn) => {
      hooks.effects.push(fn)
    },
    setInterval: (fn, ms) => {
      const handle = { fn, ms }
      timers.push(handle)
      return handle
    },
    clearInterval: (handle) => cleared.push(handle),
    setTimeout: () => ({ unref: () => undefined }),
    clearTimeout: () => undefined,
    console,
    host: {
      state: hostState,
      paneVisibility: () => atomOf(paneVisible),
      request: async (method, params) => {
        calls.push({ method, params })
        return requestImpl(method, params)
      },
      revealPane: () => undefined,
    },
  }

  vm.runInNewContext(pluginSourceCode(['CockpitPane', 'CockpitChip']), context)

  return {
    context,
    calls,
    timers,
    cleared,
    hooks,
    /** Render a component and run the effects React would run after this pass. */
    async mount(component, props = {}) {
      index = 0
      hooks.effects = []
      const tree = context.__helpers[component](props)
      const cleanups = hooks.effects.map((effect) => effect())

      await flush()

      return { tree, cleanups }
    },
    async rerender(component, props = {}) {
      index = 0
      hooks.effects = []
      const tree = context.__helpers[component](props)

      await flush()

      return tree
    },
  }
}

const ROSTER = {
  subagents: [
    {
      subagent_id: 'sa-live',
      parent_id: null,
      depth: 0,
      goal: 'audit the repo',
      delegation_id: 'batch-1',
      model: 'deepseek-v4.1-flash',
      started_at: 1726800000,
      status: 'running',
      tool_count: 3,
      last_tool: 'read_file',
      accepting_steer: true,
    },
    {
      subagent_id: 'sa-done',
      parent_id: 'sa-live',
      depth: 1,
      goal: 'ship the tests',
      delegation_id: 'batch-1',
      model: 'deepseek-v4.1-flash',
      started_at: 1726799000,
      status: 'completed',
      tool_count: 9,
      last_tool: 'terminal',
      accepting_steer: false,
    },
  ],
  delegations: [],
}

const LIVE_HOST = {
  gateway: atomOf('open'),
  focusedSessionId: atomOf('sess-42'),
  activeSessionId: atomOf(null),
}

test('the pane polls subagent.list with the focused runtime session id', async () => {
  const rt = createRuntime({ requestImpl: () => ROSTER, hostState: LIVE_HOST })
  const { tree } = await rt.mount('CockpitPane')

  assert.equal(rt.calls.length, 1)
  assert.equal(rt.calls[0].method, 'subagent.list')
  assert.equal(rt.calls[0].params.session_id, 'sess-42')

  // a 2s poll, plus a 1s age clock once a live row exists
  const poll = rt.timers.find((timer) => timer.ms === 2000)

  assert.ok(poll, 'expected a 2s poll interval')

  // the first paint happens before the RPC resolves -> honest empty state, no rows
  const firstPaint = textOf(tree).join(' | ')

  assert.match(firstPaint, /no live subagents/)
  assert.doesNotMatch(firstPaint, /audit the repo/)
  assert.doesNotMatch(firstPaint, /undefined/)
})

test('the roster re-renders after the poll resolves, and the interval drives it', async () => {
  const rt = createRuntime({ requestImpl: () => ROSTER, hostState: LIVE_HOST })
  await rt.mount('CockpitPane')
  const tree = await rt.rerender('CockpitPane')
  const text = textOf(tree).join(' | ')

  assert.match(text, /audit the repo/)
  assert.match(text, /ship the tests/)
  assert.match(text, /running/)
  assert.match(text, /completed/)
  assert.match(text, /1 live · 2 tracked/)
  assert.match(text, /read_file/)
  assert.doesNotMatch(text, /no live subagents/)
  assert.doesNotMatch(text, /undefined/)

  const poll = rt.timers.find((timer) => timer.ms === 2000)

  poll.fn()
  await flush()
  assert.equal(rt.calls.length, 2)
})

test('unmounting clears the poll interval', async () => {
  const rt = createRuntime({ requestImpl: () => ROSTER, hostState: LIVE_HOST })
  const { cleanups } = await rt.mount('CockpitPane')

  assert.equal(cleanups.length > 0, true)

  for (const cleanup of cleanups) {
    if (typeof cleanup === 'function') {
      cleanup()
    }
  }

  assert.equal(rt.cleared.length >= 1, true)
})

test('a hidden pane never polls', async () => {
  const rt = createRuntime({ requestImpl: () => ROSTER, hostState: LIVE_HOST, paneVisible: false })

  await rt.mount('CockpitPane')

  assert.equal(rt.calls.length, 0)
  assert.equal(rt.timers.length, 0)
})

test('a down gateway never polls and says so', async () => {
  const rt = createRuntime({
    requestImpl: () => ROSTER,
    hostState: { gateway: atomOf('connecting'), focusedSessionId: atomOf('sess-42') },
  })
  const { tree } = await rt.mount('CockpitPane')
  const text = textOf(tree).join(' | ')

  assert.equal(rt.calls.length, 0)
  assert.equal(rt.timers.length, 0)
  assert.match(text, /backend not connected/)
  assert.match(text, /"connecting"/)
})

test('a gateway refusal becomes copy, never a fabricated roster', async () => {
  const rt = createRuntime({
    requestImpl: () => {
      throw new Error('session not found or not owned by this transport')
    },
    hostState: LIVE_HOST,
  })
  await rt.mount('CockpitPane')
  const tree = await rt.rerender('CockpitPane')
  const text = textOf(tree).join(' | ')

  assert.match(text, /subagent\.list failed/)
  assert.match(text, /does not own this session/)
  assert.match(text, /retry/)
  assert.doesNotMatch(text, /audit the repo/)
})

test('the chip polls on the slower cadence and labels the live count', async () => {
  const rt = createRuntime({ requestImpl: () => ROSTER, hostState: LIVE_HOST })
  await rt.mount('CockpitChip')
  const tree = await rt.rerender('CockpitChip')

  assert.equal(rt.calls[0].method, 'subagent.list')
  assert.equal(rt.timers[0].ms, 5000)
  assert.match(textOf(tree).join(' | '), /swarm 1 live/)
  assert.match(tree.props.title, /1 live \(1 running, 0 queued\)/)
})

test('the chip stays honest with no session and no gateway', async () => {
  const rt = createRuntime({
    requestImpl: () => ROSTER,
    hostState: { gateway: atomOf('open'), focusedSessionId: atomOf(null), activeSessionId: atomOf(null) },
  })
  const { tree } = await rt.mount('CockpitChip')

  assert.equal(rt.calls.length, 0)
  assert.match(textOf(tree).join(' | '), /swarm no session/)
})

test('the pane falls back to activeSessionId when no session is focused', async () => {
  const rt = createRuntime({
    requestImpl: () => ROSTER,
    hostState: { gateway: atomOf('open'), focusedSessionId: atomOf(null), activeSessionId: atomOf('sess-fallback') },
  })

  await rt.mount('CockpitPane')

  assert.equal(rt.calls.length, 1)
  assert.equal(rt.calls[0].params.session_id, 'sess-fallback')
})
