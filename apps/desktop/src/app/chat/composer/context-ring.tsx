import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { ContextUsagePanel } from '@/app/shell/context-usage-panel'
import { useContextBreakdown } from '@/app/shell/hooks/use-context-breakdown'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { releaseTypingFocus } from '@/components/ui/keyboard-first'
import { Tip } from '@/components/ui/tooltip'
import type { HermesGateway } from '@/hermes'
import { useI18n } from '@/i18n'
import { contextBarLabel } from '@/lib/statusbar'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $sessionStates } from '@/store/session-states'
import type { UsageStats } from '@/types/hermes'

import { GHOST_ICON_BTN } from './control-classes'

const EMPTY_USAGE: UsageStats = { calls: 0, input: 0, output: 0, total: 0 }

const RING_R = 6.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R

/**
 * Context-window fill ring beside the model pill (Industry 2.3). Reads THIS
 * surface's SessionView so side-by-side tiles each show their own window, and
 * opens the same ContextUsagePanel the statusbar gauge hosts — the breakdown
 * RPC (`session.context_breakdown`, a read-only chars/4 pass) is shared, so
 * the ring adds no data plumbing.
 *
 * Hidden on a draft: with no runtime there is no window to measure.
 */
export function ContextRing({ disabled, gateway }: { disabled: boolean; gateway?: HermesGateway | null }) {
  const copy = useI18n().t.shell.statusbar.contextUsagePanel
  const view = useSessionView()
  const runtimeId = useStore(view.$runtimeId)
  const busy = useStore(view.$busy)
  const [open, setOpen] = useState(false)

  const requestGateway = useMemo(
    () =>
      <T,>(method: string, params?: Record<string, unknown>): Promise<T> =>
        gateway ? gateway.request<T>(method, params) : Promise.reject(new Error('no gateway')),
    [gateway]
  )

  const { breakdown, loading } = useContextBreakdown({
    busy,
    enabled: Boolean(runtimeId),
    requestGateway,
    sessionId: runtimeId
  })

  // Per-session twin of $currentUsage — the tile's own slice, never whichever
  // session last streamed into the global. Same merge as the statusbar gauge:
  // the breakdown wins when present (it's session-keyed and measured), the
  // streamed usage carries the figure mid-turn while estimates are suspended.
  const sessionUsage = useStoreSelector($sessionStates, states =>
    runtimeId ? (states[runtimeId]?.usage ?? null) : null
  )

  const usage = useMemo<UsageStats>(
    () =>
      breakdown
        ? {
            ...(sessionUsage ?? EMPTY_USAGE),
            context_estimated: breakdown.context_estimated,
            context_source: breakdown.context_source,
            context_max: breakdown.context_max,
            context_percent: breakdown.context_percent,
            context_used: breakdown.context_used
          }
        : (sessionUsage ?? EMPTY_USAGE),
    [breakdown, sessionUsage]
  )

  if (!runtimeId) {
    return null
  }

  const percent = Math.max(0, Math.min(100, Math.round(usage.context_percent ?? 0)))
  const title = usage.context_max ? `${copy.title} — ${contextBarLabel(usage)}` : copy.title

  // Same as the model pill: closing the dropdown returns focus to this button,
  // which would swallow the next typed character — release it to the editor.
  const setMenuOpen = (next: boolean) => {
    setOpen(next)

    if (!next) {
      releaseTypingFocus()
    }
  }

  return (
    <DropdownMenu onOpenChange={setMenuOpen} open={open}>
      <Tip label={title} side="top">
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={title}
            className={cn(GHOST_ICON_BTN, 'p-0')}
            disabled={disabled}
            type="button"
            variant="ghost"
          >
            <svg aria-hidden="true" className="size-4 -rotate-90" viewBox="0 0 16 16">
              <circle
                cx="8"
                cy="8"
                fill="none"
                r={RING_R}
                strokeWidth="1.5"
                style={{ stroke: 'var(--ui-stroke-tertiary)' }}
              />
              {percent > 0 ? (
                <circle
                  cx="8"
                  cy="8"
                  fill="none"
                  r={RING_R}
                  strokeDasharray={`${(percent / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
                  strokeLinecap="round"
                  strokeWidth="1.5"
                  style={{ stroke: 'var(--ui-accent)' }}
                />
              ) : null}
            </svg>
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-72 p-0" side="top" sideOffset={8}>
        <ContextUsagePanel breakdown={breakdown} loading={loading} usage={usage} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
