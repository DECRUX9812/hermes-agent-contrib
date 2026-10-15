import {
  Button,
  cn,
  type PluginTranslate,
  Skeleton as SkeletonBlock,
  StatusBadge,
  type StatusState
} from '@hermes/plugin-sdk'

import { errorText, type OfficeKind, type WorkstreamStatus } from './api'
import { useDeskI18n } from './i18n'

/** The Desk's one status vocabulary, drawn on the app's shared StatusBadge:
 *  running (accent pulse), queued (muted), needs you (amber), done (green),
 *  error (red). */
const STATUS_STATE: Record<WorkstreamStatus, StatusState> = {
  done: 'done',
  error: 'error',
  needs_you: 'needs-approval',
  queued: 'queued',
  running: 'running'
}

export function statusState(status: string | undefined): StatusState | null {
  if (!status) {
    return null
  }

  return status in STATUS_STATE ? STATUS_STATE[status as WorkstreamStatus] : null
}

export function StatusPill({ status }: { status: string }) {
  const t = useDeskI18n()
  const state = statusState(status)

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-surface-sunken px-2 py-0.5 text-ui-2xs font-medium text-fg-secondary',
        state === 'running' && 'text-brand',
        state === 'needs-approval' && 'text-warning',
        state === 'done' && 'text-success',
        state === 'error' && 'text-danger'
      )}
    >
      {state ? <StatusBadge state={state} /> : null}
      {state
        ? {
            done: t('statusDone'),
            error: t('statusError'),
            'needs-approval': t('statusNeedsYou'),
            queued: t('statusQueued'),
            running: t('statusRunning')
          }[state]
        : t('statusUnknown', status)}
    </span>
  )
}

function toMillis(ts: number | string | null | undefined): number | null {
  if (ts === null || ts === undefined || ts === '') {
    return null
  }

  if (typeof ts === 'number') {
    // Backend mtimes are epoch seconds; event timestamps are ISO strings.
    return ts < 1e12 ? ts * 1000 : ts
  }

  const ms = Date.parse(ts)

  return Number.isNaN(ms) ? null : ms
}

export function timeAgo(ts: number | string | null | undefined, t: PluginTranslate): string {
  const ms = toMillis(ts)

  if (ms === null) {
    return ''
  }

  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000))

  if (seconds < 45) {
    return t('justNow')
  }

  const minutes = Math.round(seconds / 60)

  if (minutes < 60) {
    return t('minAgo', minutes)
  }

  const hours = Math.round(minutes / 60)

  if (hours < 24) {
    return t('hoursAgo', hours)
  }

  const days = Math.round(hours / 24)

  return days < 30 ? t('daysAgo', days) : new Date(ms).toLocaleDateString()
}

export function clockTime(ts: number | string | null | undefined): string {
  const ms = toMillis(ts)

  return ms === null ? '' : new Date(ms).toLocaleString()
}

const KIND_LABELS: Record<string, string> = { docx: 'DOCX', pptx: 'PPTX', xlsx: 'XLSX' }

export function KindMark({ kind }: { kind: string }) {
  const known = kind in KIND_LABELS

  return (
    <span
      className={cn(
        'inline-block min-w-8 rounded-control px-1 text-center text-ui-2xs font-semibold tracking-wide',
        known && kind === 'docx' && 'bg-info/10 text-info',
        known && kind === 'xlsx' && 'bg-success/10 text-success',
        known && kind === 'pptx' && 'bg-warning/10 text-warning',
        !known && 'bg-surface-sunken text-fg-muted'
      )}
    >
      {KIND_LABELS[kind] ?? 'FILE'}
    </span>
  )
}

export function baseName(path: string | undefined): string {
  return (
    String(path ?? '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() ?? ''
  )
}

export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-2 py-1">
      {Array.from({ length: lines }, (_, index) => (
        <SkeletonBlock className={cn('h-3 w-full', index % 2 === 1 && 'w-2/3')} key={index} />
      ))}
    </div>
  )
}

export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useDeskI18n()

  return (
    <div className="flex items-center gap-2 rounded-row bg-danger/10 px-2.5 py-2 text-ui-xs text-danger" role="alert">
      <span className="min-w-0 flex-1 break-words">{errorText(error)}</span>
      {onRetry ? (
        <Button onClick={() => onRetry()} size="xs" variant="outline">
          {t('retry')}
        </Button>
      ) : null}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-row bg-surface-sunken px-3 py-3 text-ui-xs text-fg-muted">{children}</div>
}

export function InlineError({ message }: { message: string }) {
  return message ? (
    <div className="break-words text-ui-xs text-danger" role="alert">
      {message}
    </div>
  ) : null
}

export function officeKind(kind: string): OfficeKind | null {
  return kind === 'docx' || kind === 'pptx' || kind === 'xlsx' ? kind : null
}
