import './rakazo.css'

import type { HermesPlugin } from '@hermes/plugin-sdk'
import { ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { RakazoShell } from './shell'

const RakazoDesktopPlugin: HermesPlugin = {
  id: 'rakazo',
  name: 'Rakazo AI Bots',
  description: 'Persistent autonomous AI bots with dedicated workspaces, cron routines, memory, and audit trails.',
  defaultEnabled: true,
  register(ctx) {
    // 1. Register full page route in desktop workspace
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: '/rakazo' },
      render: () => <RakazoShell />,
    })

    // 2. Register primary sidebar navigation item
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: {
        path: '/rakazo',
        label: 'Bots (Rakazo)',
        codicon: 'hubot',
      },
    })
  },
}

export default RakazoDesktopPlugin
