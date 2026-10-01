import assert from 'node:assert/strict'

import { test } from 'vitest'

import { vsCodeServerCandidates, vsCodeServerLaunch, vsCodeServerUrl } from './vscode-server'

const installed =
  (...names: string[]) =>
  (command: string) =>
    names.includes(command) ? `/usr/bin/${command}` : null

test('the ladder prefers the VS Code the user already has over a standalone server', () => {
  const kinds = vsCodeServerCandidates(installed('openvscode-server', 'code')).map(c => c.kind)

  assert.deepEqual(kinds, ['code', 'openvscode-server'])
})

test('no VS Code server installed leaves the ladder empty', () => {
  assert.deepEqual(vsCodeServerCandidates(installed('code-server')), [])
})

test('every rung binds loopback and requires the token it was given', () => {
  for (const kind of ['code', 'code-insiders', 'openvscode-server'] as const) {
    const { args } = vsCodeServerLaunch({ kind, path: `/usr/bin/${kind}` }, 41234, 'tok', 'linux')

    assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1', kind)
    assert.equal(args[args.indexOf('--port') + 1], '41234', kind)
    assert.equal(args[args.indexOf('--connection-token') + 1], 'tok', kind)
    assert.ok(!args.includes('--without-connection-token'), kind)
  }
})

test('the code CLI is asked to serve the web editor', () => {
  const { command, args } = vsCodeServerLaunch({ kind: 'code', path: '/usr/bin/code' }, 1, 't', 'linux')

  assert.equal(command, '/usr/bin/code')
  assert.equal(args[0], 'serve-web')
})

test('a Windows .cmd shim runs through cmd.exe with the same server flags', () => {
  const shim = vsCodeServerLaunch({ kind: 'code', path: 'C:\\VS Code\\bin\\code.cmd' }, 1, 't', 'win32')
  const direct = vsCodeServerLaunch({ kind: 'code', path: '/usr/bin/code' }, 1, 't', 'linux')

  assert.equal(shim.command, 'cmd.exe')
  assert.deepEqual(shim.args.slice(-direct.args.length), direct.args)
  assert.equal(shim.args[shim.args.length - direct.args.length - 1], 'C:\\VS Code\\bin\\code.cmd')
})

test('the pane URL carries the token and opens the folder', () => {
  const url = new URL(vsCodeServerUrl(41234, 'tok', '/home/me/my project', 'linux'))

  assert.equal(url.origin, 'http://127.0.0.1:41234')
  assert.equal(url.searchParams.get('tkn'), 'tok')
  assert.equal(url.searchParams.get('folder'), '/home/me/my project')
})

test('a Windows folder becomes the URI path VS Code expects', () => {
  const url = new URL(vsCodeServerUrl(1, 'tok', 'C:\\work\\site', 'win32'))

  assert.equal(url.searchParams.get('folder'), '/C:/work/site')
})
