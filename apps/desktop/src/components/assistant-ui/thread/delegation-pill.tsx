import { useStore } from '@nanostores/react'
import { type FC, useMemo, useState } from 'react'

import { SubagentRow } from '@/app/agents'
import { useSessionView } from '@/app/chat/session-view'
import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { ActivityTimerText } from '@/components/chat/activity-timer-text'
import { SCAFFOLD_GLYPH_CLASS, SCAFFOLD_LABEL_CLASS, SCAFFOLD_META_CLASS } from '@/components/chat/scaffold-row'
import { Codicon } from '@/components/ui/codicon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { useViewedInterval } from '@/hooks/use-viewed-interval'
import { useI18n } from '@/i18n'
import { useSessionSlice } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $subagentsBySession, buildSubagentTree, type SubagentProgress } from '@/store/subagents'

const isLive = (item: SubagentProgress) => item.status === 'queued' || item.status === 'running'

/** What the pill names: the one worker's goal, or the first worker plus a
 *  count of the rest — "inspect repo · +2 more agents" reads as the fan-out
 *  it is without listing every worker in a scaffold row. */
export const delegationPillLabel = (
  live: readonly SubagentProgress[],
  moreAgents: (count: number) => string
): string => {
  const first = live[0]?.goal ?? ''

  return live.length > 1 ? `${first} · ${moreAgents(live.length - 1)}` : first
}

/**
 * The transcript's live delegation marker.
 *
 * `delegate_task` calls already render a card listing their children, but
 * delegation also happens without one — a group round whose bot fans work
 * out, a background spawn that only ever arrives as `subagent.*` events. The
 * subagent store sees all of it, so this pill reads THAT feed, not the tool
 * parts: while any of this session's workers are live, a compact row at the
 * transcript tail names the first of them, counts the rest, and ticks their
 * age. Click it and it opens the turn's full subagent tree (the same
 * `SubagentRow` the Agents panel uses), folded back into one row when done.
 *
 * Terminal-only states hide the pill entirely (mirroring the composer's
 * SubagentSection, which stands down the moment nothing is live) — a
 * finished delegation's outcome already reads in its tool card or the next
 * message.
 */
export const DelegationPill: FC = () => {
  const { t } = useI18n()
  const sessionId = useStore(useSessionView().$runtimeId)
  const items = useSessionSlice($subagentsBySession, sessionId)
  const live = items.filter(isLive)
  const hasLive = live.length > 0
  const [open, setOpen] = useState(false)
  const [nowMs, setNowMs] = useState(Date.now)

  // The expanded tree's age stamps tick once a second, and only while anyone
  // is watching them — a closed pill pays nothing.
  useViewedInterval(() => setNowMs(Date.now()), 1000, open && hasLive)

  const oldest = live.reduce((min, item) => Math.min(min, item.startedAt), Number.POSITIVE_INFINITY)
  const elapsed = useElapsedSeconds(hasLive, `delegation-pill:${sessionId}`, hasLive ? oldest : undefined)
  const tree = useMemo(() => (open ? buildSubagentTree(items) : []), [items, open])

  if (!hasLive) {
    return null
  }

  const allQueued = live.every(item => item.status === 'queued')
  const statusLabel = allQueued ? t.agents.queued : t.agents.running

  return (
    <div className="grid min-w-0 max-w-full gap-1 pl-(--message-text-indent)" data-slot="delegation-pill">
      <div className="flex min-w-0 max-w-full items-center gap-1.5" data-conversation-scaffold="">
        <span className={SCAFFOLD_GLYPH_CLASS}>
          <GlyphSpinner
            ariaLabel={statusLabel}
            className="size-3.5 text-[0.95rem] text-(--ui-text-tertiary)"
            spinner="breathe"
          />
        </span>
        <button
          aria-expanded={open}
          className={cn(
            SCAFFOLD_LABEL_CLASS,
            'min-w-0 truncate text-left transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none'
          )}
          onClick={() => setOpen(value => !value)}
          type="button"
        >
          {delegationPillLabel(live, t.agents.moreAgents)}
        </button>
        <ActivityTimerText className={SCAFFOLD_META_CLASS} seconds={elapsed} />
        <Codicon
          className="ml-auto shrink-0 text-(--conversation-scaffold-text)"
          name={open ? 'chevron-down' : 'chevron-right'}
          size="0.625rem"
        />
      </div>
      {open && tree.length > 0 ? (
        <div className="grid min-w-0 gap-3 pl-5 pt-0.5" data-slot="delegation-pill-tree">
          {tree.map(node => (
            <SubagentRow key={node.id} node={node} nowMs={nowMs} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
