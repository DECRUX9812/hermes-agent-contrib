import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from\s*['"][^'"]+['']\s*;?/g, '')
  .replace('export default {', 'globalThis.plugin = {')

const ctx = { jsx: () => null, jsxs: () => null, useRef: () => ({ current: null }), console }
vm.runInNewContext(code, ctx)
const p = ctx.plugin

test('plugin default export shape', () => {
  assert.equal(typeof p, 'object')
  assert.equal(typeof p.id, 'string')
  assert.equal(p.id, 'code-workspace')
  assert.equal(typeof p.register, 'function')
})
