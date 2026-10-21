/**
 * The tree's "agent touched" marks: only landed assistant file edits count,
 * relative tool paths resolve against the project root, absolute ones stay.
 */

import { describe, expect, it } from 'vitest'

import { agentTouchedPaths } from './agent-touched'

const edit = (path: string) => ({
  args: { path },
  result: { diff: '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n', success: true },
  toolName: 'patch',
  type: 'tool-call'
})

describe('agent touched paths', () => {
  it('collects landed edits, resolving relative paths against the root', () => {
    const touched = agentTouchedPaths(
      [
        { parts: [edit('src/app.ts'), edit('/abs/notes.md')], role: 'assistant' },
        { parts: [edit('ignored.ts')], role: 'user' },
        { parts: [{ args: { path: 'pending.ts' }, toolName: 'patch', type: 'tool-call' }], role: 'assistant' }
      ],
      '/repo/'
    )

    expect([...touched].sort()).toEqual(['/abs/notes.md', '/repo/src/app.ts'])
  })
})
