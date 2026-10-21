/**
 * AgentCraft Studio — a voxel "Warm Studio" world (ported from blendi-remade/agentcraft,
 * MIT) rendered with three.js inside Hermes Desktop: timber hall, copper-domed Goal
 * Atrium, landscaped grounds, six skinned agents on a scripted pocket-notes scenario.
 * Pure renderer plugin: the sim runs in-page, no backend calls, no core edits.
 */

import './agentcraft.css'

import {
  cn,
  Codicon,
  type HermesPlugin,
  host,
  PALETTE_AREA,
  type PaletteContribution,
  type RouteContribution,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution,
  STATUSBAR_AREAS,
  Tip,
} from '@hermes/plugin-sdk'
import { lazy, Suspense } from 'react'

import { AGENTCRAFT_LOCALES } from './i18n'

const StudioPage = lazy(() => import('./studio-page'))

function StudioStatus() {
  return (
    <Tip label="Open AgentCraft Studio">
      <button
        className={cn(
          'inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] tabular-nums transition-colors',
          'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
        )}
        onClick={() => host.navigate('/studio')}
        type="button"
      >
        <Codicon name="map" size="0.7rem" />
        <span>studio</span>
      </button>
    </Tip>
  )
}

const plugin: HermesPlugin = {
  id: 'agentcraft',
  name: 'AgentCraft Studio',
  description: 'A voxel agent-village page: six skinned agents work a scripted repo scenario in a three.js Minecraft-style studio.',
  defaultEnabled: true,
  register(ctx) {
    ctx.i18n.register(AGENTCRAFT_LOCALES)

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/studio' } satisfies RouteContribution,
        render: () => (
          <Suspense fallback={<div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>building the studio…</div>}>
            <StudioPage />
          </Suspense>
        ),
      },
      {
        id: 'status',
        area: STATUSBAR_AREAS.right,
        order: 78,
        render: () => <StudioStatus />,
      },
    ])

    const registerLabels = () =>
      ctx.registerMany([
        {
          id: 'nav',
          area: SIDEBAR_NAV_AREA,
          order: 55,
          data: { codicon: 'map', label: ctx.i18n.t('nav'), path: '/studio' } satisfies SidebarNavContribution,
        },
        {
          id: 'open',
          area: PALETTE_AREA,
          data: {
            id: 'agentcraft.openStudio',
            label: ctx.i18n.t('openStudio'),
            keywords: ['studio', 'agentcraft', 'minecraft', 'voxel', 'agents'],
            run: () => host.navigate('/studio'),
          } satisfies PaletteContribution,
        },
      ])

    let disposeLabels = registerLabels()
    ctx.i18n.onLocaleChange(() => {
      disposeLabels()
      disposeLabels = registerLabels()
    })
  },
}

export default plugin
