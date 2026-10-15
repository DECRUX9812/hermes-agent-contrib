import {
  Button,
  cn,
  host,
  type PluginTranslate,
  useQuery,
  useQueryClient
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { ACTIVE_STATUSES, api, type DeskFile, type DeskReceipt, type DeskWorkstream, errorText, keys, osDoor, type WorkstreamDetail } from './api'
import { useDeskI18n } from './i18n'
import { changedCells, DiffSummary, hasTrackedRuns, PreviewPane } from './preview'
import { $selectedWorkstream } from './state'
import { baseName, clockTime, Empty, InlineError, KindMark, QueryError, SkeletonLines, StatusPill, timeAgo } from './ui'

function ActivityIsland({ events, now, t, workstream }: { events: WorkstreamDetail['events']; now: WorkstreamDetail['now']; t: PluginTranslate; workstream: DeskWorkstream }) {
  const last = workstream.last_event ?? events[events.length - 1] ?? null

  return (
    <div
      className={cn(
        'flex min-h-12 flex-wrap items-center gap-3 rounded-panel border border-line bg-surface-raised px-3.5 py-2.5 transition-[box-shadow] duration-(--dur-base) ease-standard',
        workstream.status === 'running' && 'border-brand/35',
        workstream.status === 'needs_you' && 'border-warning',
        workstream.status === 'error' && 'border-danger'
      )}
    >
      <StatusPill status={workstream.status} />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
        {now ? (
          <>
            <span className="font-medium text-fg">{now.label}</span>
            {now.tool ? <span className="font-mono text-ui-2xs text-fg-secondary">{now.tool}</span> : null}
            {now.path ? <span className="text-fg-secondary">{baseName(now.path)}</span> : null}
            {now.since ? <span className="text-fg-muted">{t('sinceAgo', timeAgo(now.since, t))}</span> : null}
          </>
        ) : last ? (
          <>
            <span className="font-medium text-fg">{last.summary || last.kind}</span>
            <span className="text-fg-muted">{timeAgo(last.ts, t)}</span>
          </>
        ) : (
          <span className="text-fg-muted">{t('noActivity')}</span>
        )}
      </div>
      {workstream.note ? <div className="basis-full text-ui-xs text-warning">{workstream.note}</div> : null}
    </div>
  )
}

function Conversation({ active, workstream, t }: { active: boolean; t: PluginTranslate; workstream: DeskWorkstream }) {
  const { data, error, isLoading, refetch } = useQuery({
    queryFn: () => api.conversation(workstream.id),
    queryKey: keys.conversation(workstream.id),
    refetchInterval: active ? 4000 : false
  })

  const [openError, setOpenError] = useState('')

  const continueInChat = async () => {
    setOpenError('')

    try {
      await host.openSession(workstream.session_id as string)
    } catch (err) {
      setOpenError(errorText(err))
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-panel border border-line p-3">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
        <h3 className="truncate text-ui-xs font-semibold text-fg-muted">{t('conversation')}</h3>
        {workstream.session_id && typeof host.openSession === 'function' ? (
          <Button onClick={() => void continueInChat()} size="xs" variant="outline">
            {t('continueInChat')}
          </Button>
        ) : null}
      </div>
      <InlineError message={openError} />
      <div className="flex max-h-96 flex-col gap-2 overflow-auto">
        {isLoading ? <SkeletonLines lines={5} /> : null}
        {error ? <QueryError error={error} onRetry={refetch} /> : null}
        {data && !data.available ? (
          <Empty>
            {data.reason === 'missing_session_id'
              ? t('noSessionYet')
              : data.reason || t('conversationUnavailable')}
          </Empty>
        ) : null}
        {data?.available
          ? (data.messages ?? []).map((message, index) => (
              <div
                className={cn(
                  'rounded-row bg-surface-sunken px-2 py-1.5',
                  message.role === 'user' && 'border border-line bg-surface-raised',
                  message.role === 'tool' && 'bg-transparent px-0.5 py-0.5 text-fg-muted'
                )}
                key={index}
              >
                <div className="text-ui-2xs capitalize text-fg-muted">
                  {message.role}
                  {message.ts ? ` · ${timeAgo(message.ts, t)}` : ''}
                </div>
                <div className="whitespace-pre-wrap break-words">{message.text}</div>
              </div>
            ))
          : null}
      </div>
    </section>
  )
}

function FileList({ files, onSelect, selected, t }: { files: DeskFile[]; onSelect: (path: string) => void; selected: string | null; t: PluginTranslate }) {
  const STATE_LABELS: Record<string, string> = {
    changed: t('stateChanged'),
    created: t('stateCreated'),
    working: t('stateWorking')
  }

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-panel border border-line p-3">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
        <h3 className="truncate text-ui-xs font-semibold text-fg-muted">{t('files')}</h3>
      </div>
      {files.length ? (
        <ul className="flex flex-col gap-0.5">
          {files.map(file => (
            <li key={file.path}>
              <button
                aria-pressed={file.path === selected}
                className={cn(
                  'focus-ring flex min-h-8 w-full items-center gap-2 rounded-row px-1.5 py-0.5 text-left transition-colors duration-(--dur-fast) ease-standard hover:bg-hover',
                  file.path === selected && 'bg-selected'
                )}
                onClick={() => onSelect(file.path)}
                title={file.path}
                type="button"
              >
                <KindMark kind={file.kind} />
                <span className="min-w-0 flex-1 truncate">{file.rel || baseName(file.path)}</span>
                <span className={cn('text-ui-2xs text-fg-muted', file.state === 'working' && 'text-brand', file.state === 'changed' && 'text-warning', file.state === 'created' && 'text-success')}>
                  {STATE_LABELS[file.state] ?? file.state}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t('noFiles')}</Empty>
      )}
    </section>
  )
}

function RedlineActions({ onDone, path, t, workstreamId }: { onDone: () => Promise<void>; path: string; t: PluginTranslate; workstreamId: string }) {
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const run = async (action: 'accept' | 'reject') => {
    setBusy(action)
    setError('')
    setMessage('')

    try {
      const result = await api.redline({ action, path, workstream_id: workstreamId })
      setMessage(action === 'accept' ? t('accepted', result.resolved ?? 0) : t('rejected', result.resolved ?? 0))
      await onDone()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <Button disabled={Boolean(busy)} onClick={() => void run('accept')} size="sm">
        {busy === 'accept' ? t('accepting') : t('acceptChanges')}
      </Button>
      <Button disabled={Boolean(busy)} onClick={() => void run('reject')} size="sm" variant="outline">
        {busy === 'reject' ? t('rejecting') : t('rejectChanges')}
      </Button>
      {message ? <span className="text-ui-xs text-success">{message}</span> : null}
      <InlineError message={error} />
    </>
  )
}

function OpenExternal({ file, t }: { file: DeskFile; t: PluginTranslate }) {
  const os = osDoor()
  const [error, setError] = useState('')

  if (!os || typeof os.openExternal !== 'function') {
    return null
  }

  const OPEN_LABELS: Record<string, string> = {
    docx: t('openInWord'),
    pptx: t('openPowerPoint'),
    xlsx: t('openExcel')
  }

  const open = async () => {
    setError('')
    const opened = await os.openExternal(file.path)

    if (!opened) {
      setError(t('cannotOpenExternal'))
    }
  }

  return (
    <>
      <Button onClick={() => void open()} size="sm" variant="ghost">
        {OPEN_LABELS[file.kind] ?? t('open')}
      </Button>
      <InlineError message={error} />
    </>
  )
}

function FileDetail({
  file,
  onChanged,
  receipts,
  t,
  version,
  workstream
}: {
  file: DeskFile
  onChanged: () => Promise<void>
  receipts: DeskReceipt[]
  t: PluginTranslate
  version: string
  workstream: DeskWorkstream
}) {
  const fileReceipts = receipts.filter(receipt => receipt.path === file.path)

  // Receipt ids are monotonic; the earliest one is the saved original every
  // later diff runs against. Number() normalizes the wire type (number today).
  const baseline = fileReceipts.reduce<DeskReceipt | null>(
    (first, receipt) => (first === null || Number(receipt.id) < Number(first.id) ? receipt : first),
    null
  )

  const baselineId = baseline?.id

  const diffQuery = useQuery({
    enabled: baselineId !== undefined,
    queryFn: () => api.diff(file.path, baselineId),
    queryKey: keys.diff(file.path, baselineId, version)
  })

  const afterQuery = useQuery({
    queryFn: () => api.preview(file.path),
    queryKey: keys.preview(file.path, undefined, version)
  })

  const changed = changedCells(diffQuery.data)

  const showRedline =
    file.kind === 'docx' && ((diffQuery.data?.revisions ?? []).length > 0 || hasTrackedRuns(afterQuery.data))

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-panel border border-line p-3">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
        <h3 className="truncate text-ui-xs font-semibold text-fg-muted" title={file.path}>
          {file.rel || baseName(file.path)}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {showRedline ? <RedlineActions onDone={onChanged} path={file.path} t={t} workstreamId={workstream.id} /> : null}
          <OpenExternal file={file} t={t} />
        </div>
      </div>
      {diffQuery.error ? <QueryError error={diffQuery.error} onRetry={diffQuery.refetch} /> : null}
      {diffQuery.data ? <DiffSummary diff={diffQuery.data} /> : null}
      <div className="grid grid-cols-2 gap-2">
        <PreviewPane
          changed={changed}
          emptyText={t('noOriginal')}
          enabled={baselineId !== undefined}
          label={t('before')}
          path={file.path}
          receiptId={baselineId}
          version={version}
        />
        <PreviewPane changed={changed} label={t('after')} path={file.path} version={version} />
      </div>
    </section>
  )
}

function ReceiptRow({ onChanged, receipt, t }: { onChanged: () => Promise<void>; receipt: DeskReceipt; t: PluginTranslate }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const revert = async () => {
    setBusy(true)
    setError('')

    try {
      await api.revert(receipt.id)
      setConfirming(false)
      await onChanged()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-row px-2 py-1.5 hover:bg-hover">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="truncate font-medium text-fg">
          {receipt.tool} · {baseName(receipt.path)}
        </div>
        <div className="flex flex-wrap gap-1.5 text-ui-xs text-fg-muted">
          <span>{receipt.op_summary}</span>
          <span>·</span>
          <span title={clockTime(receipt.created_at)}>{timeAgo(receipt.created_at, t)}</span>
          {receipt.reverted_at ? (
            <>
              <span>·</span>
              <span>{t('revertedAgo', timeAgo(receipt.reverted_at, t))}</span>
            </>
          ) : null}
        </div>
        <InlineError message={error} />
      </div>
      {receipt.reverted_at || !receipt.backup_path ? null : confirming ? (
        <div className="flex items-center gap-1.5">
          <span className="text-ui-xs text-fg-muted">{t('revertConfirm')}</span>
          <Button disabled={busy} onClick={() => void revert()} size="xs" variant="destructive">
            {busy ? t('reverting') : t('revert')}
          </Button>
          <Button disabled={busy} onClick={() => setConfirming(false)} size="xs" variant="ghost">
            {t('cancel')}
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)} size="xs" variant="outline">
          {t('revert')}
        </Button>
      )}
    </li>
  )
}

function Receipts({ onChanged, receipts, t }: { onChanged: () => Promise<void>; receipts: DeskReceipt[]; t: PluginTranslate }) {
  if (!receipts.length) {
    return null
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-ui-xs font-semibold text-fg-muted">{t('receipts')}</h3>
      <ul className="flex flex-col gap-0.5">
        {receipts.map(receipt => (
          <ReceiptRow key={receipt.id} onChanged={onChanged} receipt={receipt} t={t} />
        ))}
      </ul>
    </section>
  )
}

function Timeline({ events, t }: { events: WorkstreamDetail['events']; t: PluginTranslate }) {
  return (
    <details className="rounded-row bg-surface-sunken px-2.5 py-1.5">
      <summary className="cursor-pointer text-ui-xs text-fg-secondary">{t('events', events.length)}</summary>
      {events.length ? (
        <ul className="flex flex-col pt-1.5">
          {events.map(event => (
            <li
              className={cn(
                'grid grid-cols-[6rem_7rem_10rem_1fr] gap-2 py-0.5 text-ui-xs text-fg-secondary',
                event.kind === 'refused' && 'text-danger'
              )}
              key={event.id}
            >
              <span className="text-fg-muted" title={clockTime(event.ts)}>
                {timeAgo(event.ts, t)}
              </span>
              <span className={cn('text-fg-muted', event.kind === 'refused' && 'text-danger')}>{event.kind}</span>
              <span className="truncate font-mono text-ui-2xs">{event.tool ?? ''}</span>
              <span className="break-words">{event.summary}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t('noEvents')}</Empty>
      )}
    </details>
  )
}

export function WorkstreamView({ id }: { id: string }) {
  const t = useDeskI18n()
  const client = useQueryClient()
  const [activeHint, setActiveHint] = useState(true)

  const { data, error, isLoading, refetch } = useQuery({
    queryFn: () => api.workstream(id),
    queryKey: keys.workstream(id),
    refetchInterval: activeHint ? 4000 : false
  })

  const [selected, setSelected] = useState<null | string>(null)

  const workstream = data?.workstream
  const active = workstream ? ACTIVE_STATUSES.has(workstream.status) : false
  const files = data?.files ?? []
  const receipts = data?.receipts ?? []
  const events = data?.events ?? []
  const file = files.find(item => item.path === selected) ?? files[0] ?? null

  useEffect(() => {
    if (workstream) {
      setActiveHint(active)
    }
  }, [active, workstream])

  const refreshAll = () => client.invalidateQueries({ queryKey: keys.all })
  const version = `${workstream?.updated_at ?? ''}:${receipts.length}`

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-5 pb-8" data-slot="desk-page">
      <button
        className="focus-ring self-start rounded-control px-1.5 py-0.5 text-fg-secondary transition-colors duration-(--dur-fast) ease-standard hover:bg-hover hover:text-fg"
        onClick={() => $selectedWorkstream.set(null)}
        type="button"
      >
        ← {t('back')}
      </button>

      {isLoading ? <SkeletonLines lines={5} /> : null}
      {error ? <QueryError error={error} onRetry={refetch} /> : null}

      {workstream ? (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="text-ui-xl font-semibold text-fg">{workstream.title}</h1>
            <div className="flex flex-wrap gap-1.5 text-ui-xs text-fg-muted tabular-nums">
              <span>
                {t('started')} {timeAgo(workstream.created_at, t)}
              </span>
              <span>·</span>
              <span>{t('filesChanged', workstream.files_changed ?? 0)}</span>
            </div>
          </header>

          <ActivityIsland events={events} now={data?.now ?? null} t={t} workstream={workstream} />

          <div className="grid grid-cols-1 items-start gap-3 min-[980px]:grid-cols-[minmax(14rem,1fr)_minmax(12rem,0.8fr)_minmax(24rem,2.4fr)]">
            <Conversation active={active} t={t} workstream={workstream} />
            <FileList files={files} onSelect={setSelected} selected={file?.path ?? null} t={t} />
            {file ? (
              <FileDetail
                file={file}
                key={file.path}
                onChanged={refreshAll}
                receipts={receipts}
                t={t}
                version={version}
                workstream={workstream}
              />
            ) : (
              <section className="flex min-w-0 flex-col gap-2 rounded-panel border border-line p-3">
                <Empty>{t('selectFile')}</Empty>
              </section>
            )}
          </div>

          <Receipts onChanged={refreshAll} receipts={receipts} t={t} />
          <Timeline events={events} t={t} />
        </>
      ) : null}
    </div>
  )
}
