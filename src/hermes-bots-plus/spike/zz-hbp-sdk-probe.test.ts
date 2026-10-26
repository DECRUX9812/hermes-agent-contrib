// TEMPORARY spike probe (not for commit).
import { readFileSync, writeFileSync } from 'node:fs'

import { it } from 'vitest'

import * as sdk from '@/sdk/index'

it('spike: sdk names missing on Nous main', () => {
  const used = readFileSync('/tmp/hbp-used.txt', 'utf8').split('\n').filter(Boolean)
  const missing = used.filter(name => !(name in sdk))
  const paths = readFileSync('/tmp/hbp-hostpaths.txt', 'utf8').split('\n').filter(Boolean)
  const missingHost = paths.filter(path => {
    let node: unknown = sdk
    for (const key of path.split('.')) {
      if (node == null || !(key in (node as object))) return true
      node = (node as Record<string, unknown>)[key]
    }
    return false
  })
  writeFileSync('/tmp/hbp-missing.json', JSON.stringify({ missing, missingHost }, null, 1))
})
