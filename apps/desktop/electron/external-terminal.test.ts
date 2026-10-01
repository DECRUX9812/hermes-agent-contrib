import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  buildTerminalScript,
  paneRunLine,
  posixQuote,
  resolveTerminalLaunch,
  terminalScriptEnv,
  terminalScriptExtension,
  tuiArgs,
  windowsQuote
} from './external-terminal'

const never = () => null
const always = (command: string) => `/usr/bin/${command}`

test('tuiArgs resumes the session in the TUI', () => {
  assert.deepEqual(tuiArgs('20260814_101010_abc123'), ['--tui', '--resume', '20260814_101010_abc123'])
})

test('tuiArgs pins the profile ahead of the mode flag', () => {
  assert.deepEqual(tuiArgs('sess', 'work'), ['--profile', 'work', '--tui', '--resume', 'sess'])
})

test('tuiArgs without a session opens a fresh TUI', () => {
  assert.deepEqual(tuiArgs('', 'work'), ['--profile', 'work', '--tui'])
})

test.skipIf(process.platform === 'win32')('the pane run line executes the launcher script with its cwd and env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes pane o'brien "))
  const script = path.join(dir, 'hermes.sh')

  fs.writeFileSync(
    script,
    buildTerminalScript({
      command: '/bin/sh',
      args: ['-c', 'printf "%s|%s" "$PWD" "$HERMES_HOME"'],
      cwd: dir,
      env: { HERMES_HOME: '/h' },
      platform: 'linux'
    })
  )

  const out = execFileSync('/bin/sh', ['-c', paneRunLine(script, 'linux')], { cwd: os.tmpdir() }).toString()

  assert.equal(out, `${fs.realpathSync(dir)}|/h`)
})

test('the Windows pane run line hands the .cmd launcher to cmd.exe', () => {
  assert.equal(paneRunLine('C:\\Users\\a b\\hermes.cmd', 'win32'), 'cmd /d /c "C:\\Users\\a b\\hermes.cmd"')
})

test('posixQuote survives embedded single quotes', () => {
  assert.equal(posixQuote("/tmp/o'brien"), `'/tmp/o'\\''brien'`)
})

test('windowsQuote doubles embedded quotes', () => {
  assert.equal(windowsQuote('C:\\a "b"'), '"C:\\a ""b"""')
})

test('terminalScriptEnv drops PATH in any casing and keeps the rest', () => {
  const env = terminalScriptEnv(
    { Path: 'C:\\junk', PATH: '/junk', PYTHONPATH: '/repo', PYTHONUTF8: '1' },
    '/home/b/.hermes'
  )

  assert.deepEqual(env, { PYTHONPATH: '/repo', PYTHONUTF8: '1', HERMES_HOME: '/home/b/.hermes' })
})

test('terminalScriptEnv skips empty values and an absent home', () => {
  assert.deepEqual(terminalScriptEnv({ PYTHONPATH: '' }), {})
})

test('buildTerminalScript execs the resolved runtime with its env', () => {
  const script = buildTerminalScript({
    args: ['-m', 'hermes_cli.main', '--tui', '--resume', 'sess'],
    command: '/home/b/.hermes/hermes-agent/venv/bin/python',
    cwd: "/home/b/o'brien",
    env: { PYTHONPATH: '/home/b/.hermes/hermes-agent' },
    platform: 'darwin'
  })

  assert.equal(
    script,
    [
      '#!/bin/sh',
      `cd '/home/b/o'\\''brien' || exit 1`,
      `export PYTHONPATH='/home/b/.hermes/hermes-agent'`,
      `exec '/home/b/.hermes/hermes-agent/venv/bin/python' '-m' 'hermes_cli.main' '--tui' '--resume' 'sess'`,
      ''
    ].join('\n')
  )
})

test('buildTerminalScript emits a cmd script on Windows', () => {
  const script = buildTerminalScript({
    args: ['--tui', '--resume', 'sess'],
    command: 'C:\\hermes\\venv\\Scripts\\hermes.exe',
    cwd: 'C:\\Users\\b',
    env: { PYTHONUTF8: '1' },
    platform: 'win32'
  })

  assert.deepEqual(script.split('\r\n'), [
    '@echo off',
    'cd /d "C:\\Users\\b"',
    'set "PYTHONUTF8=1"',
    '"C:\\hermes\\venv\\Scripts\\hermes.exe" "--tui" "--resume" "sess"',
    ''
  ])
})

test('terminalScriptExtension matches what the platform binds to a terminal', () => {
  assert.equal(terminalScriptExtension('darwin'), '.command')
  assert.equal(terminalScriptExtension('win32'), '.cmd')
  assert.equal(terminalScriptExtension('linux'), '.sh')
})

test('macOS opens the script with no -a so LaunchServices picks the user handler', () => {
  assert.deepEqual(resolveTerminalLaunch({ findOnPath: never, platform: 'darwin', scriptPath: '/tmp/x.command' }), {
    command: 'open',
    args: ['/tmp/x.command']
  })
})

test('Windows prefers Windows Terminal and falls back to a cmd console', () => {
  assert.deepEqual(
    resolveTerminalLaunch({
      findOnPath: command => (command === 'wt.exe' ? 'C:\\wt.exe' : null),
      platform: 'win32',
      scriptPath: 'C:\\x.cmd'
    }),
    { command: 'C:\\wt.exe', args: ['cmd.exe', '/k', 'C:\\x.cmd'] }
  )

  assert.deepEqual(resolveTerminalLaunch({ findOnPath: never, platform: 'win32', scriptPath: 'C:\\x.cmd' }), {
    command: 'cmd.exe',
    args: ['/c', 'start', '', 'cmd.exe', '/k', 'C:\\x.cmd']
  })
})

test("Linux leads with the user's x-terminal-emulator alternative", () => {
  assert.deepEqual(resolveTerminalLaunch({ findOnPath: always, platform: 'linux', scriptPath: '/tmp/x.sh' }), {
    command: '/usr/bin/x-terminal-emulator',
    args: ['-e', '/bin/sh', '/tmp/x.sh']
  })
})

test('Linux falls down the emulator ladder and omits a flagless terminal', () => {
  const onlyKitty = (command: string) => (command === 'kitty' ? '/usr/bin/kitty' : null)

  assert.deepEqual(resolveTerminalLaunch({ findOnPath: onlyKitty, platform: 'linux', scriptPath: '/tmp/x.sh' }), {
    command: '/usr/bin/kitty',
    args: ['/bin/sh', '/tmp/x.sh']
  })
})

test('Linux with no emulator installed reports no launch', () => {
  assert.equal(resolveTerminalLaunch({ findOnPath: never, platform: 'linux', scriptPath: '/tmp/x.sh' }), null)
})
