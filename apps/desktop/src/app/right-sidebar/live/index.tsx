import { useStore } from '@nanostores/react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { LiveAction } from '@/lib/live-actions'
import { cn } from '@/lib/utils'
import { $liveActions, $liveFocusCallId, $liveFollow } from '@/store/live-activity'
import { $focusedStoredSessionId } from '@/store/session-states'

import { PaneEmptyState, RightSidebarSectionHeader } from '..'
import { SidebarPanelLabel } from '../../shell/sidebar-label'

const SHELL_TOOLS = new Set(['terminal', 'process', 'execute_code'])

function seconds(value: number): string {
  if (value < 10) {
    return `${value.toFixed(1)}s`
  }

  if (value < 60) {
    return `${Math.round(value)}s`
  }

  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`
}

function clock(epochSeconds: number): string {
  return epochSeconds
    ? new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : ''
}

/** One re-render per second while something is running — the elapsed timers
 *  tick without subscribing the list to anything faster. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000)

  useEffect(() => {
    if (!active) {
      return
    }

    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000)

    return () => window.clearInterval(timer)
  }, [active])

  return active ? now : Date.now() / 1000
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard denied (unfocused window, web host without permission): the
    // text stays selectable in the pane, which is the fallback.
  }
}

const StatusGlyph = ({ status }: { status: LiveAction['status'] }) =>
  status === 'running' ? (
    <Codicon className="shrink-0 text-(--ui-accent)" name="loading" size="0.8rem" spinning />
  ) : status === 'error' ? (
    <Codicon className="shrink-0 text-destructive" name="error" size="0.8rem" />
  ) : (
    <Codicon className="shrink-0 text-(--ui-green)" name="pass" size="0.8rem" />
  )

const LiveActionRow = memo(function LiveActionRow({ action, now }: { action: LiveAction; now: number }) {
  const { t } = useI18n()
  const l = t.live
  const shell = SHELL_TOOLS.has(action.tool)
  const elapsed = (action.completedAt ?? now) - action.startedAt

  const copyBody = [shell && action.target ? `$ ${action.target}` : action.target, action.input, action.output]
    .filter(Boolean)
    .join('\n\n')

  return (
    <li
      className={cn(
        'group/live-row grid min-w-0 gap-1 border-b border-(--ui-stroke-tertiary) px-3 py-2.5 last:border-b-0',
        action.status === 'running' && 'bg-(--ui-accent)/[0.04]'
      )}
      data-live-call={action.id}
      data-live-status={action.status}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[0.6875rem]">
        <StatusGlyph status={action.status} />
        <span className="shrink-0 font-mono font-medium text-(--ui-text-secondary)">{action.tool}</span>
        {action.exitCode !== null ? (
          <span
            className={cn(
              'shrink-0 rounded px-1 font-mono text-[0.625rem]',
              action.exitCode === 0 ? 'text-(--ui-text-quaternary)' : 'bg-destructive/10 text-destructive'
            )}
          >
            {l.exitCode(action.exitCode)}
          </span>
        ) : null}
        <span className="min-w-0 flex-1" />
        <span className="shrink-0 tabular-nums text-(--ui-text-quaternary)">
          {action.status === 'running' ? l.runningFor(seconds(Math.max(0, elapsed))) : seconds(Math.max(0, elapsed))}
        </span>
        <span className="shrink-0 tabular-nums text-(--ui-text-quaternary)">{clock(action.startedAt)}</span>
        <Tip label={l.copy}>
          <Button
            aria-label={l.copy}
            className="size-4 shrink-0 rounded opacity-0 group-hover/live-row:opacity-100 focus-visible:opacity-100"
            onClick={() => void copyText(copyBody)}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="copy" size="0.7rem" />
          </Button>
        </Tip>
      </div>
      {action.target ? (
        <pre className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[0.75rem] leading-snug text-foreground">
          {shell ? <span className="select-none text-(--ui-text-quaternary)">$ </span> : null}
          {action.target}
        </pre>
      ) : null}
      {action.input ? (
        <pre className="max-h-40 min-w-0 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-(--ui-inline-code-background) px-2 py-1.5 font-mono text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">
          {action.input}
        </pre>
      ) : null}
      {action.status === 'running' ? (
        <div className="text-[0.6875rem] text-(--ui-text-quaternary)">{l.waitingForOutput}</div>
      ) : action.output ? (
        <pre
          className={cn(
            'max-h-80 min-w-0 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md px-2 py-1.5 font-mono text-[0.6875rem] leading-snug',
            'bg-(--ui-inline-code-background) text-(--ui-text-secondary)',
            action.status === 'error' && 'text-destructive'
          )}
          data-slot="live-output"
        >
          {action.output}
        </pre>
      ) : (
        <div className="text-[0.6875rem] text-(--ui-text-quaternary)">{l.noOutput}</div>
      )}
    </li>
  )
})

/** The focused session's tool calls, raw and in order (see store/live-activity). */
export function LiveActivityPane() {
  const { t } = useI18n()
  const l = t.live
  const sessionId = useStore($focusedStoredSessionId)
  const actions = useStore($liveActions)
  const follow = useStore($liveFollow)
  const focusCallId = useStore($liveFocusCallId)
  const running = actions.filter(action => action.status === 'running').length
  const now = useNow(running > 0)
  const listRef = useRef<HTMLDivElement>(null)

  // Follow mode pins the newest call in view as calls arrive and outputs land.
  useLayoutEffect(() => {
    const list = listRef.current

    if (!list || !follow || focusCallId) {
      return
    }

    list.scrollTop = list.scrollHeight
  }, [actions, follow, focusCallId])

  // "Live" on a run summary: scroll that call into view, once.
  useEffect(() => {
    if (!focusCallId) {
      return
    }

    const row = listRef.current?.querySelector(`[data-live-call="${CSS.escape(focusCallId)}"]`)

    if (row) {
      row.scrollIntoView({ block: 'start' })
      $liveFocusCallId.set(null)
    }
  }, [actions, focusCallId])

  if (!sessionId) {
    return <PaneEmptyState label={l.noSession} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-slot="live-pane">
      <RightSidebarSectionHeader>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <SidebarPanelLabel>{l.title}</SidebarPanelLabel>
          {actions.length ? (
            <span className="truncate text-[0.6875rem] text-(--ui-text-quaternary)">
              {running ? l.countRunning(actions.length, running) : l.count(actions.length)}
            </span>
          ) : null}
        </div>
        {!follow ? (
          <Tip label={l.followHint}>
            <Button
              className="h-5 gap-1 px-1.5 text-[0.6875rem]"
              onClick={() => $liveFollow.set(true)}
              size="xs"
              variant="ghost"
            >
              <Codicon name="arrow-down" size="0.7rem" />
              {l.follow}
            </Button>
          </Tip>
        ) : null}
      </RightSidebarSectionHeader>
      {actions.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <div className="grid max-w-64 gap-1.5">
            <Codicon className="mx-auto text-(--ui-text-quaternary)" name="pulse" size="1.1rem" />
            <div className="text-xs font-medium text-(--ui-text-secondary)">{l.emptyTitle}</div>
            <div className="text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)">{l.emptyBody}</div>
          </div>
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={event => {
            const el = event.currentTarget
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24

            if (atBottom !== $liveFollow.get()) {
              $liveFollow.set(atBottom)
            }
          }}
          ref={listRef}
        >
          <ol className="min-w-0">
            {actions.map(action => (
              <LiveActionRow action={action} key={action.id} now={now} />
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
