/**
 * The Desk plugin's registration contract, run against a recording context:
 *
 *  - one page at `/desk` (ROUTES_AREA);
 *  - one rail entry with the briefcase icon and the localized label
 *    (SIDEBAR_NAV_AREA) — that entry is what makes the Desk reachable from
 *    the plugin rail;
 *  - the hermes-office workstream event invalidates the Desk's query cache.
 */

import type { PluginContext } from '@hermes/plugin-sdk'
import { ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'

const plugin = (await import('./plugin')).default

interface Registration {
  area: string
  data?: Record<string, unknown>
  id: string
}

/** A recording `PluginContext`: registrations, their disposers, teardown. */
function recordingContext() {
  const disposers: (() => void)[] = []
  const registrations: Registration[] = []

  const ctx = {
    i18n: { onLocaleChange: () => () => undefined, register: () => () => undefined, t: (key: string) => key },
    onDispose: (fn: () => void) => disposers.push(fn),
    onEvent: vi.fn(() => () => undefined),
    register: (registration: Registration) => {
      registrations.push(registration)

      return () => {
        registrations.splice(registrations.indexOf(registration), 1)
      }
    },
    registerMany: (cs: Registration[]) => {
      for (const registration of cs) {
        ctx.register(registration)
      }

      return () => registrations.forEach(() => undefined)
    }
  }

  return {
    ctx: ctx as unknown as PluginContext,
    disposers,
    find: (id: string) => registrations.find(registration => registration.id === id)
  }
}

describe('desk plugin registration', () => {
  it('registers the /desk page and the briefcase rail entry', () => {
    const { ctx, find } = recordingContext()

    plugin.register(ctx)

    const page = find('page')

    expect(page?.area).toBe(ROUTES_AREA)
    expect(page?.data).toMatchObject({ path: '/desk' })

    const nav = find('nav')

    expect(nav?.area).toBe(SIDEBAR_NAV_AREA)
    expect(nav?.data).toMatchObject({ codicon: 'briefcase', label: 'nav', path: '/desk' })
  })

  it('hears the hermes-office workstream event for cache invalidation', () => {
    const { ctx, find } = recordingContext()

    plugin.register(ctx)

    expect(ctx.onEvent).toHaveBeenCalledWith('plugin.hermes-office.workstream.updated', expect.any(Function))
    expect(find('page')).toBeTruthy()
  })
})
