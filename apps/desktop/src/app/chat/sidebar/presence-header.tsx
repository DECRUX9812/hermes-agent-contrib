import type { ReactNode } from 'react'

import { SidebarGroupContent } from '@/components/ui/sidebar'

import { AgentPresence } from './agent-presence'
import { ColonyRoster } from './colony-roster'

// The sidebar's top group with the colony header in front of it: who is here
// and what they are doing, then the roster, then the nav the sidebar owns.
export function SidebarPresenceGroupContent({ children }: { children: ReactNode }) {
  return (
    <SidebarGroupContent>
      <div className="px-0 pb-2">
        <AgentPresence />
      </div>
      <ColonyRoster />
      {children}
    </SidebarGroupContent>
  )
}
