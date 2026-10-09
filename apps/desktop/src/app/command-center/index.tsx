import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { LogSearchField, useLogSearch } from '@/components/chat/log-search'
import { LogTail } from '@/components/chat/log-tail'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { ResponsiveTabs } from '@/components/ui/tab-dropdown'
import { getActionStatus, getLogs, getStatus, restartGateway, updateHermes } from '@/hermes'
import type { ActionStatusResponse, SessionInfo, StatusResponse } from '@/hermes'
import { useI18n } from '@/i18n'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  type IconComponent,
  Info,
  Wrench
} from '@/lib/icons'
import { fmtDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { upsertDesktopActionTask } from '@/store/activity'
import { $notificationHistory, clearNotificationHistory, type NotificationKind, notify } from '@/store/notifications'
import { confirmSharedGatewayRestart } from '@/store/system-actions'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import { PAGE_INSET_X } from '../layout-constants'
import { OverlayBreadcrumbHeader } from '../overlays/overlay-breadcrumb-header'
import { OverlayMain, OverlayNav, OverlaySplitLayout } from '../overlays/overlay-split-layout'
import { OverlayView } from '../overlays/overlay-view'

import { MaintenancePanel } from './maintenance'

export type CommandCenterSection = 'maintenance' | 'notices' | 'system'

export const COMMAND_CENTER_SECTIONS = [
  'system',
  'maintenance',
  'notices'
] as const satisfies readonly CommandCenterSection[]

const SECTIONS = COMMAND_CENTER_SECTIONS

const LOG_FILES = ['agent', 'errors', 'gateway', 'desktop'] as const
const LOG_LEVELS = ['ALL', 'INFO', 'WARNING', 'ERROR'] as const

interface CommandCenterViewProps {
  initialSection?: CommandCenterSection
  onClose: () => void
  onDeleteSession?: (sessionId: string) => Promise<void>
  // Accepted for call-site parity; navigation lives in the global Cmd+K palette.
  onNavigateRoute?: (path: string) => void
  onOpenSession?: (sessionId: string, session?: SessionInfo) => void
  onLoadMoreSessions?: () => Promise<void> | void
}

function formatTimestamp(value?: number | null): string {
  if (!value) {
    return ''
  }

  const date = new Date(value * 1000)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return fmtDateTime.format(date)
}

function EmptyPanel({ description, title }: { description: string; title?: string }) {
  return (
    <div className="grid min-h-48 place-items-center px-6 text-center">
      <div>
        {title && (
          <div className="text-[length:var(--conversation-text-font-size)] font-medium text-foreground">{title}</div>
        )}
        <div className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {description}
        </div>
      </div>
    </div>
  )
}

export function CommandCenterView({
  initialSection,
  onClose
}: CommandCenterViewProps) {
  const { t } = useI18n()
  const cc = t.commandCenter
  const [section, setSection] = useRouteEnumParam('section', SECTIONS, initialSection ?? 'system')

  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [logFile, setLogFile] = useState<(typeof LOG_FILES)[number]>('agent')
  const [logLevel, setLogLevel] = useState<(typeof LOG_LEVELS)[number]>('ALL')
  const [logQuery, setLogQuery] = useState('')
  const [systemLoading, setSystemLoading] = useState(false)
  const [systemError, setSystemError] = useState('')
  const [systemAction, setSystemAction] = useState<ActionStatusResponse | null>(null)

  const refreshSystem = useCallback(async () => {
    setSystemLoading(true)
    setSystemError('')

    try {
      const [nextStatus, nextLogs] = await Promise.all([
        getStatus(),
        getLogs({
          file: logFile,
          level: logLevel,
          lines: 200
        })
      ])

      setStatus(nextStatus)
      setLogs(nextLogs.lines)
    } catch (error) {
      setSystemError(error instanceof Error ? error.message : String(error))
    } finally {
      setSystemLoading(false)
    }
  }, [logFile, logLevel])

  useEffect(() => {
    // Refetch when the panel opens and whenever the log file/level filters
    // change (refreshSystem's identity tracks them).
    if (section === 'system') {
      void refreshSystem()
    }
  }, [refreshSystem, section])

  useRefreshHotkey(() => {
    if (section === 'system') {
      void refreshSystem()
    }
  })

  const logSearch = useLogSearch(logs, logQuery)

  const runSystemAction = useCallback(
    async (kind: 'restart' | 'update') => {
      setSystemError('')

      // A profile served by the shared multiplexer restarts every bot on this device: ask first.
      const shared = kind === 'restart' ? await confirmSharedGatewayRestart() : null

      if (shared === false) {
        return
      }

      try {
        const started = kind === 'restart' ? await restartGateway() : await updateHermes()
        let nextStatus: ActionStatusResponse | null = null

        for (let attempt = 0; attempt < 18; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 1200))
          const polled = await getActionStatus(started.name, 180)
          nextStatus = polled
          setSystemAction(polled)
          upsertDesktopActionTask(polled)

          if (!polled.running) {
            break
          }
        }

        if (shared && nextStatus && !nextStatus.running && (nextStatus.exit_code ?? 0) === 0) {
          notify({ kind: 'success', message: cc.sharedGatewayRestarted(shared.length) })
        }

        if (!nextStatus) {
          const pendingStatus = {
            exit_code: null,
            lines: [cc.actionStartedWaiting],
            name: started.name,
            pid: started.pid,
            running: true
          }

          setSystemAction(pendingStatus)
          upsertDesktopActionTask(pendingStatus)
        }
      } catch (error) {
        setSystemError(error instanceof Error ? error.message : String(error))
      } finally {
        void refreshSystem()
      }
    },
    [cc, refreshSystem]
  )

  const navGroups = useMemo(
    () =>
      SECTIONS.map(value => ({
        active: section === value,
        icon:
          value === 'notices'
            ? Bell
            : value === 'system'
              ? Activity
              : Wrench,
        id: value,
        label: cc.sections[value],
        onSelect: () => setSection(value)
      })),
    [cc, section, setSection]
  )

  const activeGroup = navGroups.find(group => group.active)

  return (
    <OverlayView closeLabel={cc.close} onClose={onClose}>
      <OverlaySplitLayout>
        <OverlayNav groups={navGroups} />

        <OverlayMain className="px-0 pb-0">
          {activeGroup && (
            <OverlayBreadcrumbHeader
              group={activeGroup}
              rootLabel={cc.commandCenter}
            />
          )}
          <div className={cn('flex min-h-0 flex-1 flex-col', PAGE_INSET_X)}>
            {section === 'notices' ? (
              <NoticesPanel />
            ) : section === 'maintenance' ? (
              <MaintenancePanel />
            ) : (
              <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4">
                <div>
                  {status ? (
                    <div className="grid gap-2">
                      <div className="flex items-start justify-between gap-3 max-[47.5rem]:flex-col max-[47.5rem]:gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'size-2 shrink-0 rounded-full',
                                status.gateway_running ? 'bg-emerald-500' : 'bg-amber-500'
                              )}
                            />
                            <span className="text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
                              {status.gateway_running ? cc.gatewayRunning : cc.gatewayStopped}
                            </span>
                          </div>
                          <div className="mt-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                            {cc.hermesActiveSessions(status.version, status.active_sessions)}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap max-[47.5rem]:whitespace-normal">
                          <Button onClick={() => void runSystemAction('restart')} size="xs" variant="text">
                            {cc.restartGateway}
                          </Button>
                          <Button onClick={() => void runSystemAction('update')} size="xs" variant="textStrong">
                            {cc.updateHermes}
                          </Button>
                        </div>
                      </div>
                      {systemAction && (
                        <div className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                          {systemAction.name} ·{' '}
                          {systemAction.running
                            ? cc.actionRunning
                            : systemAction.exit_code === 0
                              ? cc.actionDone
                              : cc.actionFailed}
                        </div>
                      )}
                    </div>
                  ) : (
                    <PageLoader className="min-h-32" label={cc.loadingStatus} />
                  )}
                </div>

                <div className="flex min-h-0 flex-col pt-2">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="text-[0.625rem] font-medium uppercase tracking-[0.08em] text-(--ui-text-tertiary)">
                      {cc.recentLogs}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <ResponsiveTabs
                        align="end"
                        onChange={id => setLogFile(id as (typeof LOG_FILES)[number])}
                        tabs={LOG_FILES.map(value => ({ id: value, label: value }))}
                        value={logFile}
                      />
                      <ResponsiveTabs
                        align="end"
                        onChange={id => setLogLevel(id as (typeof LOG_LEVELS)[number])}
                        tabs={LOG_LEVELS.map(value => ({
                          id: value,
                          label: value === 'ALL' ? 'all' : value.toLowerCase()
                        }))}
                        value={logLevel}
                      />
                      <LogSearchField
                        containerClassName="w-44"
                        onChange={setLogQuery}
                        placeholder={cc.logSearchPlaceholder}
                        search={logSearch}
                        value={logQuery}
                      />
                    </div>
                    {systemError && (
                      <span className="inline-flex items-center gap-1 text-[length:var(--conversation-caption-font-size)] text-destructive">
                        <AlertCircle className="size-3.5" />
                        {systemError}
                      </span>
                    )}
                  </div>
                  <LogTail
                    className="flex-1 rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary)"
                    emptyLabel={cc.noLogs}
                    lines={systemLoading && logs.length === 0 ? null : logs}
                    search={logSearch}
                  />
                </div>
              </div>
            )}
          </div>
        </OverlayMain>
      </OverlaySplitLayout>
    </OverlayView>
  )
}

const NOTICE_KIND_ICONS: Record<NotificationKind, { icon: IconComponent; iconClass: string }> = {
  error: { icon: AlertCircle, iconClass: 'text-destructive' },
  warning: { icon: AlertTriangle, iconClass: 'text-primary' },
  info: { icon: Info, iconClass: 'text-muted-foreground' },
  success: { icon: CheckCircle2, iconClass: 'text-primary' }
}

function NoticesPanel() {
  const { t } = useI18n()
  const n = t.commandCenter.notices
  const history = useStore($notificationHistory)

  if (history.length === 0) {
    return <EmptyPanel description={n.empty} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul>
          {history.map(entry => {
            const tone = NOTICE_KIND_ICONS[entry.kind]
            const Icon = tone.icon

            return (
              <li
                className="flex items-start gap-2.5 border-b border-(--ui-stroke-tertiary) py-2.5 last:border-b-0"
                key={entry.id}
              >
                <Icon className={cn('mt-0.5 size-3.5 shrink-0', tone.iconClass)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
                      {entry.title ?? entry.message}
                    </span>
                    <span className="ml-auto shrink-0 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                      {formatTimestamp(entry.createdAt / 1000)}
                    </span>
                  </div>
                  {entry.title && (
                    <div className="truncate text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary)">
                      {entry.message}
                    </div>
                  )}
                  {entry.detail && (
                    <div className="truncate text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                      {entry.detail}
                    </div>
                  )}
                  {(entry.actionLabel ?? entry.suppressed) && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                      <span>
                        {entry.suppressed
                          ? n.mutedTag
                          : entry.placement === 'bottom-right'
                            ? n.destCorner
                            : n.destCenter}
                      </span>
                      {entry.actionLabel && (
                        <span className="rounded-sm border border-(--ui-stroke-tertiary) px-1 leading-4">
                          {entry.actionLabel}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="flex shrink-0 justify-end pt-2">
        <Button onClick={clearNotificationHistory} size="sm" type="button" variant="ghost">
          {n.clear}
        </Button>
      </div>
    </div>
  )
}
