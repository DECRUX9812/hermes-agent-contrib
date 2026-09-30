/**
 * Quick Open reads a typed `name:line`, keeps only file/folder rows from the
 * backend's path completion, and resolves them against the project root.
 */

import { describe, expect, it } from 'vitest'

import { parseQuickOpenQuery, quickOpenItems, quickOpenPath } from './quick-open'

describe('quick open', () => {
  it('splits a line suffix off the search text', () => {
    expect(parseQuickOpenQuery(' store/app.ts:42 ')).toEqual({ line: 42, query: 'store/app.ts' })
    expect(parseQuickOpenQuery('app.ts:42:7')).toEqual({ line: 42, query: 'app.ts' })
    expect(parseQuickOpenQuery('app.ts')).toEqual({ line: null, query: 'app.ts' })
    expect(parseQuickOpenQuery(':12')).toEqual({ line: null, query: ':12' })
  })

  it('keeps file and folder rows once each and drops everything else', () => {
    const rows = quickOpenItems([
      { text: '@file:src/app.ts' },
      { text: '@folder:src/store/' },
      { text: '@quill' },
      { text: '@file:src/app.ts' },
      { text: '@url:https://x' }
    ])

    expect(rows).toEqual([
      { dir: 'src', isDir: false, name: 'app.ts', rel: 'src/app.ts' },
      { dir: 'src', isDir: true, name: 'store', rel: 'src/store' }
    ])
    expect(quickOpenPath('/work/repo/', rows[0].rel)).toBe('/work/repo/src/app.ts')
    expect(quickOpenPath('/work/repo', '/etc/hosts')).toBe('/etc/hosts')
  })
})
