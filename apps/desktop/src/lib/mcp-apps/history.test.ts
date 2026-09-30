import { expect, it } from 'vitest'

import { toChatMessages } from '@/lib/chat-messages'
import type { SessionMessage } from '@/types/hermes'

// A reloaded chat still mounts the tool's MCP App: the gateway persists
// `mcp_app` with the tool message's display_metadata, and only a ui:// ref
// is ever projected onto the part.
it('rehydrates the MCP App ref from stored history, ui:// only', () => {
  const call = (id: string) => ({
    role: 'assistant',
    content: '',
    tool_calls: [{ id, type: 'function', function: { name: 'mcp__counter__show_counter', arguments: '{}' } }]
  })

  const result = (id: string, resourceUri: string) => ({
    role: 'tool',
    tool_call_id: id,
    name: 'mcp__counter__show_counter',
    content: JSON.stringify({ result: 'count=1' }),
    display_metadata: {
      tool_result_metadata: { mcp_app: { resourceUri, server: 'counter', title: 'Counter', tool: 'show_counter' } }
    }
  })

  const rows = [
    { role: 'user', content: 'show it' },
    call('a'),
    result('a', 'ui://counter/app.html'),
    call('b'),
    result('b', 'https://evil.example/app.html')
  ] as SessionMessage[]

  const parts = toChatMessages(rows)
    .flatMap(message => message.parts)
    .filter(part => part.type === 'tool-call')

  expect(parts[0].toolResultMetadata?.mcp_app).toEqual({
    resourceUri: 'ui://counter/app.html',
    server: 'counter',
    title: 'Counter',
    tool: 'show_counter'
  })
  expect(parts[1].toolResultMetadata?.mcp_app).toBeUndefined()
})
