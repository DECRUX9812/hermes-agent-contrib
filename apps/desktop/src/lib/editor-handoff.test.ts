/**
 * Editor hand-off URLs: local files use the editor's `file` route, SSH files
 * the editor's remote route, and a path an editor could never resolve (a
 * relative one) yields nothing to open.
 */

import { describe, expect, it } from 'vitest'

import { editorOpenUrl, EDITORS } from './editor-handoff'

describe('editor hand-off', () => {
  it('opens local files, with the line, in every editor', () => {
    for (const editor of EDITORS) {
      expect(editorOpenUrl(editor.id, { line: 12, path: '/work/my repo/app.ts' })).toBe(
        `${editor.scheme}://file/work/my%20repo/app.ts:12`
      )
    }

    expect(editorOpenUrl('vscode', { path: 'C:\\work\\app.ts' })).toBe('vscode://file/C:/work/app.ts')
    expect(editorOpenUrl('vscode', { path: 'src/app.ts' })).toBeNull()
  })

  it('opens SSH files through the remote route', () => {
    expect(editorOpenUrl('cursor', { path: '/srv/app.ts', sshHost: 'dev@box' })).toBe(
      'cursor://vscode-remote/ssh-remote+dev%40box/srv/app.ts'
    )
    expect(editorOpenUrl('zed', { line: 3, path: '/srv/app.ts', sshHost: 'dev@box' })).toBe(
      'zed://ssh/dev@box/srv/app.ts:3'
    )
  })
})
