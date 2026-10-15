/**
 * Desk — the hermes-office plugin page, vendored in-tree from the
 * hermes-office repo's desktop frontend. One page (`/desk`) + one rail entry
 * (briefcase); every folder, workstream, receipt and diff comes from the
 * plugin's real backend REST namespace (`/api/plugins/hermes-office/*`), which
 * is a separate install — without it the page says so honestly, it never
 * fakes data.
 */

import {
  type HermesPlugin,
  host,
  PALETTE_AREA,
  type PaletteContribution,
  queryClient,
  type RouteContribution,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution,
  useValue
} from '@hermes/plugin-sdk'

import { bindDeskApi, DESK_KEY } from './api'
import { DeskHome } from './desk-home'
import { DESK_LOCALES, PLUGIN_ID } from './i18n'
import { $selectedWorkstream } from './state'
import { WorkstreamView } from './workstream'

// broadcast_plugin_event("hermes-office", "workstream.updated", ...) arrives
// on the gateway stream under this wire name.
const WORKSTREAM_UPDATED = 'plugin.hermes-office.workstream.updated'

function DeskPage() {
  const selected = useValue($selectedWorkstream)

  return selected === null ? <DeskHome /> : <WorkstreamView id={selected} key={selected} />
}

const plugin: HermesPlugin = {
  id: PLUGIN_ID,
  name: 'Desk',
  description: 'Office work on your folders: Word, Excel and PowerPoint edits with tracked changes, previews and receipts.',
  defaultEnabled: true,
  register(ctx) {
    ctx.i18n.register(DESK_LOCALES)
    ctx.onDispose(bindDeskApi(ctx.rest, ctx.os))
    ctx.onDispose(() => $selectedWorkstream.set(null))
    ctx.onEvent(WORKSTREAM_UPDATED, () => void queryClient.invalidateQueries({ queryKey: [DESK_KEY] }))

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/desk' } satisfies RouteContribution,
        render: () => <DeskPage />
      }
    ])

    const registerLabels = () =>
      ctx.registerMany([
        {
          id: 'nav',
          area: SIDEBAR_NAV_AREA,
          order: 52,
          data: {
            codicon: 'briefcase',
            label: ctx.i18n.t('nav'),
            path: '/desk',
            tier: 'advanced'
          } satisfies SidebarNavContribution
        },
        {
          id: 'open',
          area: PALETTE_AREA,
          data: {
            id: 'hermes-office.open',
            label: ctx.i18n.t('openCommand'),
            keywords: ['desk', 'office', 'word', 'excel', 'powerpoint', 'documents'],
            run: () => host.navigate('/desk')
          } satisfies PaletteContribution
        }
      ])

    let disposeLabels = registerLabels()
    ctx.i18n.onLocaleChange(() => {
      disposeLabels()
      disposeLabels = registerLabels()
    })
  }
}

export default plugin
