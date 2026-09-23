import assert from 'node:assert/strict'

import { test } from 'vitest'

import { findPosixSystemPython } from './system-python'

const versionsByPath: Record<string, string> = {
  '/usr/bin/python3': '3.9',
  '/usr/local/bin/python': '3.12'
}

const findOnPath = (command: string) =>
  command === 'python3' ? '/usr/bin/python3' : command === 'python' ? '/usr/local/bin/python' : null

const execText = async (command: string) => versionsByPath[command]

test('skips an out-of-range python3 and returns the supported python', async () => {
  const result = await findPosixSystemPython({ findOnPath, execText })

  assert.equal(result, '/usr/local/bin/python')
})

test('returns null when every candidate is out of range', async () => {
  const result = await findPosixSystemPython({
    findOnPath,
    execText: async () => '3.9'
  })

  assert.equal(result, null)
})

test('returns null when no candidate is on PATH', async () => {
  const result = await findPosixSystemPython({
    findOnPath: () => null,
    execText: async () => '3.12'
  })

  assert.equal(result, null)
})

test('skips a candidate whose version probe fails', async () => {
  const result = await findPosixSystemPython({
    findOnPath,
    execText: async (command: string) => {
      if (command === '/usr/bin/python3') {
        throw new Error('probe failed')
      }

      return '3.13'
    }
  })

  assert.equal(result, '/usr/local/bin/python')
})
