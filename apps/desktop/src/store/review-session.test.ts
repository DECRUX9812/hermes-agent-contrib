import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'

import { collectSessionEditPaths, toRepoRelativePath } from './review-session'

const toolMessage = (toolName: string, args: Record<string, unknown>, result?: Record<string, unknown>): ChatMessage =>
  ({ id: 'm1', parts: [{ type: 'tool-call', toolName, args, result }], role: 'assistant' }) as ChatMessage

describe('collectSessionEditPaths', () => {
  it('collects paths from file-edit tool calls only', () => {
    const messages: ChatMessage[] = [
      toolMessage('edit_file', { path: 'src/a.ts' }),
      toolMessage('terminal', { command: 'rm x' }),
      toolMessage('write_file', { file: '/tmp/b.ts' }),
      toolMessage('patch', {}, { path: 'src/c.ts' })
    ]

    expect(collectSessionEditPaths(messages).sort()).toEqual(['/tmp/b.ts', 'src/a.ts', 'src/c.ts'])
  })

  it('dedupes repeated edits to the same file', () => {
    const messages: ChatMessage[] = [toolMessage('edit_file', { path: 'src/a.ts' }), toolMessage('patch', { path: 'src/a.ts' })]

    expect(collectSessionEditPaths(messages)).toEqual(['src/a.ts'])
  })

  it('ignores non-tool parts and malformed calls', () => {
    const messages: ChatMessage[] = [
      ({ id: 'm1', parts: [{ type: 'text', text: 'editing src/x.ts' }], role: 'assistant' }) as ChatMessage,
      toolMessage('edit_file', { path: 42 })
    ]

    expect(collectSessionEditPaths(messages)).toEqual([])
  })
})

describe('toRepoRelativePath', () => {
  const cwd = '/repo/root'

  it('strips the repo cwd prefix', () => {
    expect(toRepoRelativePath('/repo/root/src/a.ts', cwd)).toBe('src/a.ts')
  })

  it('keeps already-relative paths, normalized', () => {
    expect(toRepoRelativePath('./src/a.ts', cwd)).toBe('src/a.ts')
    expect(toRepoRelativePath('src//a.ts/', cwd)).toBe('src//a.ts')
  })

  it('drops paths outside the repo', () => {
    expect(toRepoRelativePath('/elsewhere/a.ts', cwd)).toBeNull()
    expect(toRepoRelativePath('C:\\work\\a.ts', cwd)).toBeNull()
    expect(toRepoRelativePath('~/a.ts', cwd)).toBeNull()
    expect(toRepoRelativePath('', cwd)).toBeNull()
  })
})
