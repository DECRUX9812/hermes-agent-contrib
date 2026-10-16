/**
 * The Ambition plugin's registration contract, run against a recording
 * context: the composer chip, the two transcript tool-part renderers and the
 * session-scoped `/ambition` command — plus the plugin event that drives
 * query invalidation.
 */

import type { PluginContext } from '@hermes/plugin-sdk'
import { COMPOSER_AREAS, TRANSCRIPT_TOOL_PART_AREA } from '@hermes/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'

import ambitionPlugin from './plugin'

interface Registration {
  area: string
  data?: Record<string, unknown>
  id: string
  render?: unknown
}

function recordingContext() {
  const registrations: Registration[] = []

  const ctx = {
    i18n: { onLocaleChange: () => () => undefined, register: () => () => undefined, t: (key: string) => key },
    onDispose: () => () => undefined,
    onEvent: vi.fn(() => () => undefined),
    register: (registration: Registration) => {
      registrations.push(registration)

      return () => undefined
    },
    registerMany: (cs: Registration[]) => {
      for (const registration of cs) {
        ctx.register(registration)
      }

      return () => undefined
    }
  }

  return {
    ctx: ctx as unknown as PluginContext,
    find: (area: string, id: string) => registrations.find(r => r.area === area && r.id === id)
  }
}

describe('ambition plugin registration', () => {
  it('registers the chip, both tool-part renderers and the slash command', () => {
    const { ctx, find } = recordingContext()

    ambitionPlugin.register(ctx)

    expect(find(COMPOSER_AREAS.actions, 'chip')?.render).toBeTypeOf('function')

    const cardPart = find(TRANSCRIPT_TOOL_PART_AREA, 'card-part')

    expect(cardPart?.data).toMatchObject({ toolName: 'ambition_card' })

    const judgePart = find(TRANSCRIPT_TOOL_PART_AREA, 'judge-part')

    expect(judgePart?.data).toMatchObject({ toolName: 'ambition_judge' })

    const slash = find(COMPOSER_AREAS.slashCommands, 'slash')

    expect(slash?.data).toMatchObject({ name: 'ambition' })
  })

  it('hears the ambition card event for cache invalidation', () => {
    const { ctx } = recordingContext()

    ambitionPlugin.register(ctx)

    expect(ctx.onEvent).toHaveBeenCalledWith('plugin.ambition.card.updated', expect.any(Function))
  })
})
