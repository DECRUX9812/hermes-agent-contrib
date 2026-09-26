import { describe, expect, it } from 'vitest'

import type { SessionMessage } from '../types/hermes'

import { markdownLabels, messageToMarkdown, sessionToMarkdown } from './session-markdown'

const labels = markdownLabels()

function message(overrides: Partial<SessionMessage> & Pick<SessionMessage, 'role'>): SessionMessage {
  return { content: '', ...overrides }
}

describe('messageToMarkdown', () => {
  it('renders user and assistant messages under role headings', () => {
    expect(messageToMarkdown(message({ content: 'hi', role: 'user' }), labels)).toBe('## User\n\nhi')
    expect(messageToMarkdown(message({ content: 'hello back', role: 'assistant' }), labels)).toBe(
      '## Assistant\n\nhello back'
    )
  })

  it('skips hidden rows entirely', () => {
    expect(
      messageToMarkdown(message({ content: 'secret', display_kind: 'hidden', role: 'assistant' }), labels)
    ).toBe('')
  })

  it('prefers display_content over raw content', () => {
    expect(
      messageToMarkdown(
        message({ content: 'internal scaffolding', display_content: 'visible', role: 'assistant' }),
        labels
      )
    ).toBe('## Assistant\n\nvisible')
  })

  it('collapses reasoning and persisted tool calls into details blocks', () => {
    const out = messageToMarkdown(
      message({
        content: 'answer',
        display_reasoning: 'thoughts',
        role: 'assistant',
        tool_calls: [{ function: { arguments: { path: 'a.ts' }, name: 'read_file' } }]
      }),
      labels
    )

    expect(out).toContain('<details>\n<summary>Reasoning</summary>\n\nthoughts\n\n</details>')
    expect(out).toContain('<summary>Tool call: read_file</summary>')
    expect(out).toContain('"path": "a.ts"')
    expect(out).toContain('\nanswer')
  })

  it('collapses tool rows under the tool name', () => {
    const out = messageToMarkdown(
      message({ args: { limit: 1 }, content: '', role: 'tool', tool_name: 'search' }),
      labels
    )

    expect(out).toContain('<summary>Tool result: search</summary>')
    expect(out).toContain('"limit": 1')
  })

  it('collapses the system prompt', () => {
    const out = messageToMarkdown(message({ content: 'You are Hermes', role: 'system' }), labels)

    expect(out).toBe('<details>\n<summary>System</summary>\n\nYou are Hermes\n\n</details>')
  })
})

describe('sessionToMarkdown', () => {
  it('joins rendered messages under a title and drops empty rows', () => {
    const out = sessionToMarkdown(
      'sess-1234',
      [
        message({ content: 'hi', role: 'user' }),
        message({ content: 'hidden', display_kind: 'hidden', role: 'assistant' }),
        message({ content: 'reply', role: 'assistant' })
      ],
      { title: 'My Chat' }
    )

    expect(out).toBe('# My Chat\n\n## User\n\nhi\n\n## Assistant\n\nreply\n')
  })

  it('uses a longer fence when a body contains triple backticks', () => {
    const out = sessionToMarkdown(
      'sess-1',
      [message({ args: '```\ncode\n```', content: '', role: 'tool', tool_name: 'run' })],
      {}
    )

    expect(out).toContain('````\n```\ncode\n```\n````')
  })
})
