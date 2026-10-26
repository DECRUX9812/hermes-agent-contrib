/**
 * Harness: load the Jump plugin in a node vm with the SDK stubbed.
 *
 * The plugin's import lines are stripped (a bare specifier cannot resolve
 * outside the app), `export default` is rewritten so register() is reachable,
 * and the pure helpers are re-exported onto globalThis.__jump. Mirrors the
 * jev-hud plugin's harness: never deepEqual whole vm-realm objects.
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

export function loadPlugin(options = {}) {
	const jsx = (type, props) => ({ $$el: true, type, props: props || {} })
	const context = {
		console,
		jsx,
		jsxs: jsx,
		...options.sdk
	}

	// `vm.runInContext` evaluates as a SCRIPT, so `export` is illegal in it.
		// Named exports become plain declarations; the default export object is
		// assigned to globalThis AS-IS (no stub — the tests register against the
		// real `register()`), which is why it works here and in the app.
		const code = SOURCE.replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
			.replace(/^import\s+\{[\s\S]*?\}\s+from 'react'\r?\n/m, '')
			.replace(/^import\s+\{[^}]*\}\s+from 'react\/jsx-runtime'\r?\n/m, '')
			.replace(/^export const /gm, 'const ')
			.replace(/^export default /m, 'globalThis.plugin = ')
			.concat('\nglobalThis.__jump = { fuzzyScore, fuzzyRank, publishRoster, rosterSnapshot, rowForPalette }\n')

	vm.createContext(context)
	vm.runInContext(code, context, { filename: 'jump-plugin.js' })

	// The vm's global object IS `context`, so the helpers land on `context.__jump`.
	// Flatten them onto the returned handle: tests destructure them by name and
	// read `ctx.plugin` for the default export.
	return Object.assign({ __jump: context.__jump }, context.__jump, { plugin: context.plugin })
}