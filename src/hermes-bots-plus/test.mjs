// Runs this plugin's vitest suites inside a core checkout, which owns the
// test toolchain (vitest, jsdom, testing-library) and the `@/` sources the
// tests mock. The source is copied to where it would sit in the app, so its
// `../../contrib` imports resolve; the copy is removed afterwards.
// Usage: node test.mjs <core-checkout> [vitest filters...]
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [core, ...filters] = process.argv.slice(2)

if (!core) {
  console.error('usage: node test.mjs <core-checkout> [vitest filters...]')
  process.exit(2)
}

const desktop = resolve(core, 'apps/desktop')
const vitest = [resolve(desktop, 'node_modules/vitest/vitest.mjs'), resolve(core, 'node_modules/vitest/vitest.mjs')].find(existsSync)

if (!vitest) {
  console.error(`no vitest under ${core}`)
  process.exit(2)
}

const slot = 'hermes-bots-plus-under-test'
const target = resolve(desktop, 'src/plugins', slot)

rmSync(target, { force: true, recursive: true })
cpSync(resolve(here, 'src'), target, { recursive: true })

let status = 1

try {
  const paths = filters.length ? filters.map(f => `src/plugins/${slot}/${f}`) : [`src/plugins/${slot}/`]
  const run = spawnSync(process.execPath, [vitest, 'run', '--project', 'ui', ...paths], { cwd: desktop, stdio: 'inherit' })
  status = run.status ?? 1
} finally {
  rmSync(target, { force: true, recursive: true })
}

process.exit(status)
