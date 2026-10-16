import { afterEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'

import {
  bridgedInnerCall,
  claimedToolPartIn,
  effectiveToolName,
  TRANSCRIPT_TOOL_PART_AREA
} from './tool-part-renderers'

const disposers: Array<() => void> = []

afterEach(() => {
  disposers.splice(0).forEach(d => d())
})

const claim = (toolName: string) =>
  disposers.push(
    registry.register({
      area: TRANSCRIPT_TOOL_PART_AREA,
      data: { render: () => null, toolName },
      id: `claim-${toolName}`
    })
  )

const part = (toolName: string, extra: Record<string, unknown> = {}) => ({
  args: {},
  isError: false,
  result: { ok: true },
  toolCallId: 'tc-1',
  toolName,
  ...extra
})

describe('effectiveToolName', () => {
  it('is the part tool name outside the bridge', () => {
    expect(effectiveToolName(part('ambition_card'))).toBe('ambition_card')
  })

  it('resolves a single-call bridge part to the inner tool', () => {
    expect(
      effectiveToolName(
        part('tool_call', { args: { calls: [{ arguments: { altitude: 'a' }, name: 'ambition_card' }] } })
      )
    ).toBe('ambition_card')
  })

  it('falls back to the stored result tool name when args do not carry one', () => {
    expect(effectiveToolName(part('tool_call', { args: {}, storedResultToolName: 'ambition_judge' }))).toBe(
      'ambition_judge'
    )
  })

  it('keeps the wrapper name for a batch bridge', () => {
    expect(
      effectiveToolName(
        part('tool_call', {
          args: { calls: [{ arguments: {}, name: 'ambition_card' }, { arguments: {}, name: 'ambition_judge' }] }
        })
      )
    ).toBe('tool_call')
  })
})

describe('bridgedInnerCall', () => {
  it('reads the single inner call and its arguments', () => {
    expect(bridgedInnerCall(part('tool_call', { args: { calls: [{ arguments: { a: 1 }, name: 'ambition_card' }] } }))).toEqual({
      args: { a: 1 },
      name: 'ambition_card'
    })
  })

  it('is null for an ordinary tool part', () => {
    expect(bridgedInnerCall(part('terminal', { args: { command: 'ls' } }))).toBeNull()
  })
})

describe('claimedToolPartIn', () => {
  it('rewrites a claimed bridge part to the plugin tool identity', () => {
    claim('ambition_card')

    const claimed = claimedToolPartIn(
      registry.getArea(TRANSCRIPT_TOOL_PART_AREA),
      part('tool_call', {
        args: { calls: [{ arguments: { altitude: 'a' }, name: 'ambition_card' }] },
        storedResultToolName: 'ambition_card'
      }) as never
    )

    expect(claimed?.props.toolName).toBe('ambition_card')
    expect(claimed?.props.args).toEqual({ altitude: 'a' })
  })

  it('leaves unclaimed and multi-call bridge parts alone', () => {
    expect(claimedToolPartIn(registry.getArea(TRANSCRIPT_TOOL_PART_AREA), part('ambition_card') as never)).toBeNull()

    claim('ambition_card')

    expect(
      claimedToolPartIn(
        registry.getArea(TRANSCRIPT_TOOL_PART_AREA),
        part('tool_call', {
          args: { calls: [{ arguments: {}, name: 'ambition_card' }, { arguments: {}, name: 'ambition_judge' }] }
        }) as never
      )
    ).toBeNull()
  })
})
