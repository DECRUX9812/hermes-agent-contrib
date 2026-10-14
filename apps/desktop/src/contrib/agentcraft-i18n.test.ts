import { afterEach, expect, it } from 'vitest'

import { PALETTE_AREA, type PaletteContribution } from '@/app/command-palette/contrib'
import { SIDEBAR_NAV_AREA, type SidebarNavContribution } from '@/app/routes'
import { createPluginContext } from '@/contrib/plugin'
import { registry } from '@/contrib/registry'
import { setRuntimeI18nLocale } from '@/i18n/runtime'

import plugin from '../plugins/agentcraft/plugin'

const disposers: Array<() => void> = []

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
})

it('labels the Studio nav row and palette entry from its locale bundle, never with a raw key', () => {
  setRuntimeI18nLocale('en')
  plugin.register(createPluginContext('agentcraft', dispose => disposers.push(dispose)))

  const nav = registry.getArea(SIDEBAR_NAV_AREA).find(c => c.id === 'agentcraft:nav')
  const open = registry.getArea(PALETTE_AREA).find(c => c.id === 'agentcraft:open')

  expect((nav?.data as SidebarNavContribution | undefined)?.label).toBe('Studio')
  expect((open?.data as PaletteContribution | undefined)?.label).toBe('Open AgentCraft Studio')
})
