import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { AgentPresence } from '@/app/chat/sidebar/agent-presence'
import { ColonyRoster } from '@/app/chat/sidebar/colony-roster'
import { OverlayView } from '@/app/overlays/overlay-view'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'
import { $attentionItemCount } from '@/store/attention-inbox'
import { $colonyBots } from '@/store/bot-character'
import { $cronJobs } from '@/store/cron'

import { ActivityTab } from './activity-tab'
import { ApprovalsTab } from './approvals-tab'
import { BotsTab } from './bots-tab'
import { UpcomingTab } from './upcoming-tab'

type ActivityPaneTab = 'activity' | 'approvals' | 'upcoming' | 'bots'

// The Activity Pane — Hermes's answer to "what's happening right now."
// One calm, glanceable view: live status header, colony roster, then four
// tabs. Activity shows what every bot is doing and has done. Approvals
// surfaces everything waiting on the user with explicit buttons. Upcoming
// shows scheduled work with health. Bots is the colony: picker, character
// cards, rapport. Muse-inspired pattern, Hermes design — never copied.

const TABS: ReadonlyArray<{ id: ActivityPaneTab; label: string; icon: string }> = [
  { id: 'activity', label: 'Activity', icon: 'pulse' },
  { id: 'approvals', label: 'Approvals', icon: 'shield' },
  { id: 'upcoming', label: 'Upcoming', icon: 'watch' },
  { id: 'bots', label: 'Bots', icon: 'robot' }
]

export function ActivityView({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<ActivityPaneTab>('activity')
  const approvalCount = useStore($attentionItemCount)
  const cronJobs = useStore($cronJobs)
  const bots = useStore($colonyBots)

  const badgeFor = (id: ActivityPaneTab): number | null => {
    switch (id) {
      case 'approvals':
        return approvalCount > 0 ? approvalCount : null

      case 'upcoming':
        return cronJobs.length > 0 ? cronJobs.length : null

      case 'bots':
        return bots.length > 1 ? bots.length : null

      default:
        return null
    }
  }

  return (
    <OverlayView onClose={onClose} rootClassName="mx-auto w-full max-w-2xl">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Live status header — who's here, what they're doing. */}
        <div className="flex shrink-0 flex-col gap-2 px-5 pt-[calc(var(--titlebar-height)+0.875rem)] pb-1">
          <div className="flex items-baseline justify-between">
            <h1 className="text-[1.0625rem] font-semibold text-foreground">Activity</h1>
            <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">
              Live from this machine
            </span>
          </div>
          <AgentPresence />
          <ColonyRoster />
        </div>

        {/* Tabs — one tap to each surface. */}
        <div aria-label="Activity sections" className="shrink-0 px-5 pb-2 pt-1" role="tablist">
          <div className="flex gap-1 rounded-xl bg-(--ui-control-background) p-1">
            {TABS.map(t => {
              const badge = badgeFor(t.id)
              const active = tab === t.id

              return (
                <button
                  aria-selected={active}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5',
                    'text-[0.75rem] font-semibold transition-colors duration-150 outline-none',
                    'focus-visible:ring-2 focus-visible:ring-(--ui-accent)/50',
                    active
                      ? 'bg-(--ui-control-active-background) text-foreground shadow-sm'
                      : 'text-(--ui-text-tertiary) hover:text-foreground'
                  )}
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  role="tab"
                  type="button"
                >
                  <Codicon className="text-[0.875rem]" name={t.icon} />
                  <span>{t.label}</span>
                  {badge !== null && (
                    <span
                      className={cn(
                        'grid min-w-5 place-items-center rounded-full px-1 text-[0.625rem] font-bold leading-4',
                        t.id === 'approvals' && !active
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-(--ui-control-hover-background) text-(--ui-text-secondary)'
                      )}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          {tab === 'activity' && <ActivityTab />}
          {tab === 'approvals' && <ApprovalsTab />}
          {tab === 'upcoming' && <UpcomingTab />}
          {tab === 'bots' && <BotsTab />}
        </div>
      </div>
    </OverlayView>
  )
}
