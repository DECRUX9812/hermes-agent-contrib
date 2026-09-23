import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { test } from 'vitest'

import { resolveSshBinary, SshBinaryUnavailableError } from './ssh-binary'

type ProbeResult = 'enoent' | 'fail' | 'ok'

function fakeSpawn(results: Record<string, ProbeResult>) {
  const calls: string[] = []

  const spawnFn = (command: string) => {
    calls.push(command)
    const child = new EventEmitter() as any

    child.kill = () => {}
    queueMicrotask(() => {
      const mode = results[command] ?? 'enoent'

      if (mode === 'enoent') {
        child.emit('error', Object.assign(new Error(`spawn ${command} ENOENT`), { code: 'ENOENT' }))
      } else {
        child.emit('exit', mode === 'ok' ? 0 : 1)
      }
    })

    return child
  }

  return { calls, spawnFn: spawnFn as any }
}

const WIN32_DEPS = { platform: 'win32', systemRoot: 'D:\\WinRoot', resourcesPath: null }

test('resolveSshBinary prefers ssh on PATH when the in-box System32 binary fails the -V probe', async () => {
  const system32 = 'D:\\WinRoot\\System32\\OpenSSH\\ssh.exe'
  const { spawnFn } = fakeSpawn({ ssh: 'ok', [system32]: 'fail' })

  const resolved = await resolveSshBinary({
    ...WIN32_DEPS,
    exists: candidate => candidate === 'ssh' || candidate === system32,
    spawnFn
  })

  assert.equal(resolved, 'ssh')
})

test('resolveSshBinary falls back to the System32 in-box binary when PATH ssh is broken', async () => {
  const system32 = 'D:\\WinRoot\\System32\\OpenSSH\\ssh.exe'
  const { spawnFn } = fakeSpawn({ ssh: 'enoent', [system32]: 'ok' })

  const resolved = await resolveSshBinary({
    ...WIN32_DEPS,
    exists: candidate => candidate === 'ssh' || candidate === system32,
    spawnFn
  })

  assert.equal(resolved, system32)
})

test('resolveSshBinary uses a bundled ssh when present and working', async () => {
  const bundled = '/res/openssh/ssh'
  const { spawnFn } = fakeSpawn({ ssh: 'fail', [bundled]: 'ok' })

  const resolved = await resolveSshBinary({
    exists: candidate => candidate === 'ssh' || candidate === bundled,
    platform: 'linux',
    resourcesPath: '/res',
    spawnFn
  })

  assert.equal(resolved, bundled)
})

test('resolveSshBinary throws a typed error listing every tried candidate when all probes fail', async () => {
  const system32 = 'D:\\WinRoot\\System32\\OpenSSH\\ssh.exe'
  const { spawnFn } = fakeSpawn({ ssh: 'fail', [system32]: 'fail' })

  await assert.rejects(
    resolveSshBinary({
      ...WIN32_DEPS,
      exists: () => true,
      spawnFn
    }),
    (error: unknown) => {
      assert.ok(error instanceof SshBinaryUnavailableError)
      assert.match(error.message, /ssh/)
      assert.match(error.message, /System32\\OpenSSH\\ssh\.exe/)

      return true
    }
  )
})
