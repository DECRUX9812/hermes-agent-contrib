import './fleet.css'

import type { HermesPlugin } from '@hermes/plugin-sdk'
import { ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { HermesFleetShell } from './shell'

const HermesFleetPlugin: HermesPlugin = {
  id: 'hermes-fleet',
  name: 'Hermes Fleet',
  description: 'Autonomous AI Squad Command Center — Multi-agent fleet orchestration with sandboxes, memory, and sentry gates.',
  defaultEnabled: true,
  register(ctx) {
    // 1. Register main page in desktop app routing
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: '/fleet' },
      render: () => <HermesFleetShell />,
    })

    // 2. Register primary sidebar navigation icon
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: {
        path: '/fleet',
        label: 'Fleet (Squad)',
        codicon: 'organization',
      },
    })
  },
}

export default HermesFleetPlugin
