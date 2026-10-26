/**
 * Registration tests: does register() actually wire the contributions the
 * plugin's header claims, against a recording stub ctx?
 *
 * These are the failures that would otherwise only surface as a missing pane
 * in the running app — a typo'd area constant, a contribution whose `data`
 * lacks the field the palette reads.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPlugin } from './harness.mjs'

/** Areas mirrored from the SDK's own constants. */
const AREAS = {
	PALETTE_AREA: 'palette',
	PANES_AREA: 'panes',
	ROUTES_AREA: 'routes',
	SIDEBAR_NAV_AREA: 'sidebar.nav',
	KEYBINDS_AREA: 'keybinds'
}

const navigateCalls = []

const recordingCtx = () => {
	const registered = []
	const i18n = []

	return {
		registered,
		i18n,
		ctx: {
			i18n: { register: bundle => i18n.push(bundle) },
			register: c => registered.push(c),
			onDispose: () => undefined
		}
	}
}

const setup = () => {
	const { ctx, registered, i18n } = recordingCtx()
	const host = {
		navigate: path => navigateCalls.push(path),
		state: { profile: { get: () => 'default' }, gateway: { get: () => 'open' }, cronJobs: { get: () => [] } },
		skills: { list: async () => [] },
		toolsets: { list: async () => [] },
		profiles: { list: async () => [] }
	}

	const handle = loadPlugin({ sdk: { ...AREAS, host } })

	handle.plugin.register(ctx)

	return { handle, registered, i18n, host }
}

test('register wires every surface the plugin advertises', () => {
	const { registered } = setup()
	const byArea = registered.reduce((acc, c) => ({ ...acc, [c.area]: (acc[c.area] ?? 0) + 1 }), {})

	assert.equal(byArea.panes, 1)
	assert.equal(byArea.routes, 1)
	assert.equal(byArea['sidebar.nav'], 1)
	assert.equal(byArea.palette, 2)
	assert.equal(byArea.keybinds, 1)
	assert.equal(registered.length, 6)
})

test('the route page is mounted at /jump and renders a component', () => {
	const { registered } = setup()
	const page = registered.find(c => c.area === 'routes')

	assert.equal(page.data.path, '/jump')
	assert.equal(typeof page.render, 'function')
	assert.ok(page.render(), 'render() must return an element')
})

test('the sidebar nav row carries the fields SidebarNavContribution reads', () => {
	const { registered } = setup()
	const nav = registered.find(c => c.area === 'sidebar.nav')

	assert.equal(nav.data.path, '/jump')
	assert.equal(nav.data.label, 'Jump')
	assert.equal(typeof nav.data.codicon, 'string')
})

test('the pane contribution declares a placement hint', () => {
	const { registered } = setup()
	const pane = registered.find(c => c.area === 'panes')

	assert.ok(pane.data.placement, 'a pane needs a placement hint or it lands arbitrarily')
	assert.equal(typeof pane.render, 'function')
})

test('the roster palette row satisfies PaletteContribution and re-reads on open', () => {
	const { registered } = setup()
	const roster = registered.find(c => c.area === 'palette' && c.data.id.endsWith('.roster'))

	// contrib.ts drops a contribution whose data lacks label/run.
	assert.equal(typeof roster.data.label, 'string')
	assert.equal(typeof roster.data.run, 'function')
	assert.ok(Array.isArray(roster.data.keywords))
	// The dynamic-membership door must be a FUNCTION, re-read per palette open.
	assert.equal(typeof roster.data.items, 'function')
	assert.ok(Array.isArray(roster.data.items()))
})

test('running the roster row navigates to the launcher page', () => {
	navigateCalls.length = 0
	const { registered } = setup()
	const roster = registered.find(c => c.area === 'palette' && c.data.id.endsWith('.roster'))

	roster.data.run()

	assert.deepEqual(navigateCalls, ['/jump'])
})

test("the keybind's default combo does not collide with a core binding", () => {
	// Core's defaults, read off lib/keybinds/actions.ts KEYBIND_ACTIONS.
	const core = new Set([
		'/', 'enter', 'mod+shift+m', 'ctrl+b', 'mod+alt+v', 'mod+d', 'mod+shift+]', 'mod+shift+[',
		'mod+shift+0', 'mod+n', 'mod+t', 'mod+shift+n', 'ctrl+tab', 'ctrl+pagedown',
		'ctrl+shift+tab', 'ctrl+pageup', 'mod+shift+f', 'pageup', 'pagedown', 'mod+shift+b',
		'mod+o', 'mod+k', 'mod+p', 'mod+.', 'mod+,', 'mod+b', 'mod+j', 'mod+shift+s',
		'mod+alt+t', 'mod+g', 'mod+shift+l', 'mod+shift+h', 'ctrl+`', 'ctrl+shift+`',
		'ctrl+shift+down', 'ctrl+shift+up', 'ctrl+shift+w', 'mod+\\', 'mod+w',
		'mod+shift+t', 'mod+f', 'mod+/'
	])

	const { registered } = setup()
	const keybind = registered.find(c => c.area === 'keybinds')

	assert.equal(keybind.data.category, 'navigation')
	assert.equal(typeof keybind.data.label, 'string')
	assert.equal(typeof keybind.data.run, 'function')

	for (const combo of keybind.data.defaults) {
		assert.ok(!core.has(combo), `default combo ${combo} collides with a core binding`)
	}
})

test('the i18n bundle carries every key the launcher renders', () => {
	const { i18n } = setup()
	const bundle = i18n[0]

	assert.ok(bundle && bundle.en, 'a plugin must ship its own en bundle')

	const en = bundle.en
	// Every t() call site in JumpLauncher, by key.
	for (const key of ['placeholder', 'noResults', 'noResultsHint', 'idleHint', 'hint']) {
		assert.equal(typeof en[key], 'string', `missing i18n key: ${key}`)
		assert.notEqual(en[key], '')
	}
})