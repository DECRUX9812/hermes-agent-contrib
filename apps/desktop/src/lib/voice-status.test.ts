import { describe, expect, it } from 'vitest'

import type { ChatMessage, ChatMessagePart } from './chat-messages'
import type { TodoItem } from './todos'
import { composeStatusSpeech, isVoiceStatusQuestion, type VoiceStatusCopy } from './voice-status'

const copy: VoiceStatusCopy = {
  idle: 'idle',
  working: 'working',
  workingOn: detail => `working on ${detail}`,
  stalled: 'stalled',
  needsInput: 'needs input',
  finished: 'finished',
  progress: (done, total) => `${done}/${total} done`
}

const todo = (id: string, status: TodoItem['status'], content = id): TodoItem => ({ content, id, status })

const assistantWithTool = (toolName: string, done = false): ChatMessage =>
  ({
    id: 'm1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-call' as const,
        toolCallId: 'call_1',
        toolName,
        args: {} as never,
        argsText: '{}',
        ...(done ? { result: 'ok' } : {})
      } as ChatMessagePart
    ],
    timestamp: 0
  }) as unknown as ChatMessage

describe('isVoiceStatusQuestion', () => {
  it('matches whole-utterance status asks', () => {
    expect(isVoiceStatusQuestion("what's it doing?")).toBe(true)
    expect(isVoiceStatusQuestion('status')).toBe(true)
    expect(isVoiceStatusQuestion('Give me an update!')).toBe(true)
    expect(isVoiceStatusQuestion('are you done')).toBe(true)
  })

  it('accepts an optional Hermes address prefix', () => {
    expect(isVoiceStatusQuestion("hey hermes, what's it doing")).toBe(true)
    expect(isVoiceStatusQuestion('Hermes status')).toBe(true)
  })

  it('rejects real requests that merely contain a status word', () => {
    expect(isVoiceStatusQuestion('check the build status when it finishes')).toBe(false)
    expect(isVoiceStatusQuestion('update the readme')).toBe(false)
    expect(isVoiceStatusQuestion("tell me what's happening in the logs")).toBe(false)
    expect(isVoiceStatusQuestion('')).toBe(false)
  })
})

describe('composeStatusSpeech', () => {
  it('says idle when nothing is running', () => {
    expect(composeStatusSpeech(copy, 'idle', [], [])).toBe('idle')
    expect(composeStatusSpeech(copy, 'draft', [], [])).toBe('idle')
  })

  it('names the in-progress todo while working', () => {
    const todos = [todo('a', 'completed'), todo('b', 'in_progress', 'running the tests'), todo('c', 'pending')]

    expect(composeStatusSpeech(copy, 'working', todos, [])).toBe('working on running the tests 1/3 done')
  })

  it('falls back to the running tool, then the bare working line', () => {
    expect(composeStatusSpeech(copy, 'working', [], [assistantWithTool('terminal')])).toBe('working on terminal')
    expect(composeStatusSpeech(copy, 'working', [], [assistantWithTool('terminal', true)])).toBe('working')
    expect(composeStatusSpeech(copy, 'working', [], [])).toBe('working')
  })

  it('reports waiting, stalled and finished states', () => {
    expect(composeStatusSpeech(copy, 'needs-input', [], [])).toBe('needs input')
    expect(composeStatusSpeech(copy, 'stalled', [todo('a', 'pending')], [])).toBe('stalled 0/1 done')
    expect(composeStatusSpeech(copy, 'unread', [], [])).toBe('finished')
    expect(composeStatusSpeech(copy, 'background', [], [])).toBe('working')
  })

  it('does not count cancelled todos toward progress', () => {
    const todos = [todo('a', 'completed'), todo('b', 'cancelled')]

    expect(composeStatusSpeech(copy, 'working', todos, [])).toBe('working 1/1 done')
  })
})
