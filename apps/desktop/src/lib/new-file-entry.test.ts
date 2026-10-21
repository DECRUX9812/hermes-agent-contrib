/**
 * New file / folder paths stay inside the folder they are created in:
 * slashes make intermediate folders, and nothing absolute or `..` passes.
 */

import { describe, expect, it } from 'vitest'

import { planNewEntry } from './new-file-entry'

describe('new file entry', () => {
  it('creates intermediate folders for a nested name', () => {
    expect(planNewEntry('/repo/', 'src/utils/date.ts')).toEqual({
      folders: ['/repo/src', '/repo/src/utils'],
      target: '/repo/src/utils/date.ts'
    })
    expect(planNewEntry('/repo', ' notes.md ')).toEqual({ folders: [], target: '/repo/notes.md' })
  })

  it('refuses names that would leave the folder or name nothing', () => {
    for (const typed of ['', '  ', '/etc/passwd', 'C:\\x', '../up.txt', 'a/../../b', 'a/./b', 'bad:name']) {
      expect(planNewEntry('/repo', typed)).toBeNull()
    }
  })
})
