import { useStore } from '@nanostores/react'
import { type DragEvent, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { NEW_CHAT_ROUTE } from '@/app/routes'
import { ActivityTimerText } from '@/components/chat/activity-timer-text'
import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { Codicon } from '@/components/ui/codicon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ContextSpotView } from '@/orchestrator/panel'
import { $activeSessionId } from '@/store/session'
import {
  $contextSpot,
  $orchestratorContextError,
  $orchestratorContextLoading,
  $orchestratorSessions,
  reloadContext,
  setObjective
} from '@/store/orchestrator-context'
import {
  $agentTileOrder,
  $subagentsBySession,
  buildSubagentTree,
  type SubagentNode,
  subagentsForPanel
} from '@/store/subagents'

import { ContextSpot } from './context-spot'
import { statusGlyph } from './index'

/** Apply the user's saved order, then append anything new in arrival order. */
function orderTiles(nodes: readonly SubagentNode[], saved: readonly string[]): SubagentNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const ordered = saved.map(id => byId.get(id)).filter((node): node is SubagentNode => Boolean(node))
  const seen = new Set(ordered.map(node => node.id))

  return [...ordered, ...nodes.filter(node => !seen.has(node.id))]
}

export function AgentsSidePanel() {
  const { t } = useI18n()
  const bySession = useStore($subagentsBySession)
  const activeSessionId = useStore($activeSessionId)
  const savedOrder = useStore($agentTileOrder)

  const nodes = useMemo(
    () => buildSubagentTree(subagentsForPanel(bySession, activeSessionId)),
    [bySession, activeSessionId]
  )
  const tiles = useMemo(() => orderTiles(nodes, savedOrder), [nodes, savedOrder])

  const [expanded, setExpanded] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const navigate = useNavigate()
  const spot = useStore($contextSpot)
  const spotError = useStore($orchestratorContextError)
  const spotLoading = useStore($orchestratorContextLoading)
  // Subscribe so the spot's active count follows the orchestrator's sessions,
  // not just the delegation stream.
  useStore($orchestratorSessions)

  // Mounted in BOTH branches below: the pane must never render as a bare empty
  // area — the context spot is what makes the workspace legible with no
  // sub-agents running.
  const spotElement = (
    <ContextSpot
      error={spotError}
      loading={spotLoading}
      onNewChat={() => navigate(NEW_CHAT_ROUTE)}
      onRefresh={() => void reloadContext()}
      onSetObjective={setObjective}
      spot={spot as ContextSpotView | null}
    />
  )

  const moveTile = (from: number, to: number) => {
    if (from === to) {
      return
    }

    const next = tiles.map(node => node.id)
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    $agentTileOrder.set(next)
  }

  if (tiles.length === 0) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-slot="agents-pane">
        {spotElement}
        <div className="grid min-w-0 flex-1 place-items-center gap-3 px-4 py-10 text-center" data-slot="agents-empty">
          <Codicon className="text-muted-foreground/60" name="hubot" size="1.5rem" />
          <div className="grid gap-1">
            <p className="text-sm font-medium text-foreground/90">{t.agents.emptyTitle}</p>
            <p className="max-w-56 text-xs leading-relaxed text-muted-foreground/75">{t.agents.emptyDesc}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-slot="agents-pane">
      {spotElement}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 py-2">
        {tiles.map((node, index) => (
          <AgentTile
            expanded={expanded === node.id}
            index={index}
            key={node.id}
            node={node}
            onDragEnd={() => setDragIndex(null)}
            onDragStart={event => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', String(index))
              setDragIndex(index)
            }}
            onDrop={event => {
              event.preventDefault()
              const from = dragIndex ?? Number(event.dataTransfer.getData('text/plain'))

              if (!Number.isNaN(from)) {
                moveTile(from, index)
              }
              setDragIndex(null)
            }}
            onToggle={() => setExpanded(expanded === node.id ? null : node.id)}
            over={dragIndex !== null && dragIndex !== index}
          />
        ))}
      </div>
    </div>
  )
}

interface AgentTileProps {
  expanded: boolean
  index: number
  node: SubagentNode
  onDragEnd: () => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onToggle: () => void
  over: boolean
}

function AgentTile({ expanded, index, node, onDragEnd, onDragStart, onDrop, onToggle, over }: AgentTileProps) {
  const { t } = useI18n()
  const running = node.status === 'running' || node.status === 'queued'
  const elapsed = useElapsedSeconds(running, 'agent-tile:' + node.id, node.startedAt)
  // A standalone agent (not one worker of a same-shape fan-out) reads as a
  // custom/agent-authored delegate — badge it apart from batch workers.
  const isCustom = node.taskCount <= 1 && !node.delegationId
  const latest = node.stream.at(-1)

  return (
    <div
      className={cn(
        'grid min-w-0 gap-0 rounded-lg border border-(--ui-stroke-quaternary) bg-(--ui-bg-primary) transition-colors',
        over && 'ring-1 ring-(--ui-focus) border-(--ui-focus)'
      )}
      draggable
      onDragEnd={onDragEnd}
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDragStart={onDragStart}
      onDrop={onDrop}
    >
      <button
        aria-expanded={expanded}
        className="group flex w-full min-w-0 items-start gap-2 px-2.5 py-2 text-left"
        onClick={onToggle}
        type="button"
      >
        <span aria-hidden className="mt-0.5 shrink-0 cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground/70">
          <Codicon name="gripper" size="0.75rem" />
        </span>
        <span className="mt-0.5 flex h-[1.05rem] shrink-0 items-center">{statusGlyph(node.status, t.agents)}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="wrap-anywhere text-[0.75rem] font-medium leading-[1rem] text-foreground/90">
            {node.goal}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-[0.625rem] font-medium text-muted-foreground/60">#{index + 1}</span>
            {isCustom ? (
              <span className="rounded bg-(--ui-purple)/12 px-1 py-px text-[0.5625rem] font-medium text-(--ui-purple)">
                {t.agents.title}
              </span>
            ) : (
              <span className="rounded bg-muted/60 px-1 py-px text-[0.5625rem] font-medium text-muted-foreground/80">
                {t.agents.delegation(node.taskCount)}
              </span>
            )}
            {node.model ? (
              <span className="max-w-24 truncate rounded bg-muted/60 px-1 py-px font-mono text-[0.5625rem] text-muted-foreground/70">
                {node.model}
              </span>
            ) : null}
          </span>
        </span>
        <span className="mt-0.5 flex shrink-0 flex-col items-end gap-0.5">
          {running ? <ActivityTimerText className="text-[0.625rem]" seconds={elapsed} /> : null}
          <Codicon
            className={cn('text-muted-foreground/50 transition-transform', expanded && 'rotate-90')}
            name="chevron-right"
            size="0.75rem"
          />
        </span>
      </button>

      {expanded ? (
        <div className="grid min-w-0 gap-2 border-t border-(--ui-stroke-quaternary) px-3 py-2">
          <div className="flex items-center gap-2 text-[0.6875rem]">
            <span className="font-medium text-foreground/80">{statusLabel(node.status, t.agents)}</span>
            {node.currentTool ? (
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground/70">{node.currentTool}</span>
            ) : null}
          </div>
          {latest ? (
            <p className={cn('wrap-anywhere text-[0.6875rem] leading-relaxed', latest.isError ? 'text-destructive' : 'text-muted-foreground/80')}>
              {latest.text}
              {running ? (
                <GlyphSpinner ariaLabel={t.agents.streaming} className="ml-1 inline-block size-2 align-middle" spinner="breathe" />
              ) : null}
            </p>
          ) : (
            <p className="text-[0.6875rem] text-muted-foreground/60">{t.agents.waitingActivity}</p>
          )}
          {node.summary ? <p className="wrap-anywhere text-[0.6875rem] leading-relaxed text-foreground/85">{node.summary}</p> : null}
          <p className="text-[0.625rem] text-muted-foreground/60">
            {[
              node.toolCount ? t.agents.toolsCount(node.toolCount) : '',
              node.filesRead.length + node.filesWritten.length ? t.agents.filesCount(node.filesRead.length + node.filesWritten.length) : '',
              node.children.length ? t.agents.agentsCount(node.children.length) : ''
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function statusLabel(status: SubagentNode['status'], a: ReturnType<typeof useI18n>['t']['agents']): string {
  switch (status) {
    case 'completed':
      return a.done
    case 'failed':
    case 'interrupted':
      return a.failed
    case 'queued':
      return a.queued
    default:
      return a.running
  }
}
