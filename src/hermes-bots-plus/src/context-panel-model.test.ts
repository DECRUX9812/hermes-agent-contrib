import { describe, expect, it } from 'vitest'

import { buildTrace, contextReading, contextTone, shortDuration, shortTokens } from './context-panel-model'

describe('contextReading', () => {
  it('prefers the breakdown when it knows the window size', () => {
    const reading = contextReading(
      { context_estimated: true, context_max: 200_000, context_percent: 41, context_used: 82_000 },
      { compressions: 2, context_max: 200_000, context_percent: 55, context_used: 110_000 }
    )

    expect(reading).toEqual({ compressions: 2, estimated: true, max: 200_000, percent: 41, used: 82_000 })
  })

  it('falls back to streamed usage when the breakdown is zeroed', () => {
    const reading = contextReading(
      { context_max: 0, context_percent: 0, context_used: 0 },
      { context_max: 128_000, context_used: 32_000 }
    )

    expect(reading).toMatchObject({ estimated: false, max: 128_000, percent: 25, used: 32_000 })
  })

  it('has no reading without a window size and clamps silly percentages', () => {
    expect(contextReading(null, { context_used: 5 })).toBeNull()
    expect(contextReading(null, { context_max: 10, context_percent: 140, context_used: 14 })?.percent).toBe(100)
  })
})

describe('formatting', () => {
  it('tones by how full the window is', () => {
    expect([contextTone(10), contextTone(70), contextTone(89), contextTone(90)]).toEqual([
      'calm',
      'warm',
      'warm',
      'full'
    ])
  })

  it('shortens token counts and durations', () => {
    expect([shortTokens(950), shortTokens(12_400), shortTokens(128_000), shortTokens(1_048_576)]).toEqual([
      '950',
      '12.4k',
      '128k',
      '1.05M'
    ])
    expect([shortDuration(420), shortDuration(4_250), shortDuration(125_000)]).toEqual(['420ms', '4.3s', '2m 05s'])
  })
})

describe('buildTrace', () => {
  const history = [
    { role: 'user', text: 'check the  build\nplease', timestamp: 100 },
    { context: 'npm test', name: 'terminal', role: 'tool', timestamp: 104, tool_call_id: 'a' },
    { context: 'src/app.ts', name: 'read_file', role: 'tool', timestamp: 105.5, tool_call_id: 'b' },
    { role: 'assistant', text: 'All green.', timestamp: 107 },
    { role: 'system', text: 'ignored', timestamp: 108 },
    { role: 'user', text: 'and now?', timestamp: 200 },
    { context: 'git status', name: 'terminal', role: 'tool' }
  ]

  it('splits the transcript into turns with timed steps', () => {
    const [first, second] = buildTrace(history)

    expect(first).toMatchObject({ answered: true, index: 1, prompt: 'check the build please', span: 7000 })
    expect(first.steps.map(step => [step.id, step.context, step.took])).toEqual([
      ['a', 'npm test', 4000],
      ['b', 'src/app.ts', 1500]
    ])
    expect(first.slowest?.id).toBe('a')
    expect(second).toMatchObject({ answered: false, index: 2, prompt: 'and now?', span: 0 })
    expect(second.steps[0].took).toBeUndefined()
    expect(second.slowest).toBeUndefined()
  })

  it('names steps the way tool cards do and survives junk', () => {
    const [turn] = buildTrace([{ name: 'terminal', role: 'tool' }, null, 'x'])

    expect(turn.prompt).toBe('')
    expect(turn.steps[0].name).toBeTruthy()
    expect(turn.steps[0].icon).toBeTruthy()
    expect(buildTrace(undefined)).toEqual([])
  })
})
