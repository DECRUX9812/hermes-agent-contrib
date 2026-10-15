import {
  Button,
  cn,
  EmptyState,
  host,
  Input,
  isMissingRestEndpoint,
  type PluginTranslate,
  queryClient,
  Textarea,
  useQuery
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { api, type DeskFolder, type DeskWorkstream, errorText, keys } from './api'
import { useDeskI18n } from './i18n'
import { startWorkstream } from './session'
import { $selectedWorkstream } from './state'
import { Empty, InlineError, QueryError, SkeletonLines, StatusPill, timeAgo } from './ui'

const openWorkstream = (id: string) => $selectedWorkstream.set(id)

function HealthLine() {
  const t = useDeskI18n()
  const { data, error, isLoading } = useQuery({ queryFn: api.health, queryKey: keys.health, refetchInterval: 60_000 })

  if (isLoading) {
    return <div className="min-h-4 text-ui-xs text-fg-subtle">{t('checkingEngines')}</div>
  }

  if (error) {
    return <div className="min-h-4 text-ui-xs text-danger">{t('backendUnreachable')}: {errorText(error)}</div>
  }

  const engines = data?.engines ?? {}
  const missing = ['docx', 'pptx', 'xlsx'].filter(name => !engines[name])

  return (
    <div className="flex min-h-4 flex-wrap gap-1.5 text-ui-xs text-fg-muted tabular-nums">
      <span className={cn(missing.length ? 'text-danger' : 'text-fg-secondary')}>
        {missing.length ? t('enginesMissing', missing.join(', ')) : t('enginesOk')}
      </span>
      <span>·</span>
      <span>{data?.libreoffice ? t('libreofficeYes') : t('libreofficeNo')}</span>
      {data?.version ? (
        <>
          <span>·</span>
          <span>v{data.version}</span>
        </>
      ) : null}
    </div>
  )
}

function NeedsYou({ folderName, items, t }: { folderName: (id: string) => string; items: DeskWorkstream[]; t: PluginTranslate }) {
  if (!items.length) {
    return null
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-ui-xs font-semibold text-warning">{t('needsYou')}</h2>
      <ul className="flex flex-col gap-0.5">
        {items.map(ws => (
          <li className="flex min-h-10 items-center gap-3 rounded-row bg-surface-raised px-2 py-1.5" key={ws.id}>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="truncate text-ui-sm font-medium text-fg">{ws.title}</div>
              <div className="flex flex-wrap gap-1.5 text-ui-xs text-fg-muted">
                <span>{folderName(ws.folder_id)}</span>
                {ws.note ? (
                  <>
                    <span>·</span>
                    <span className="max-w-md truncate">{ws.note}</span>
                  </>
                ) : null}
                <span>·</span>
                <span>{timeAgo(ws.updated_at, t)}</span>
              </div>
            </div>
            <Button onClick={() => openWorkstream(ws.id)} size="sm" variant="secondary">
              {t('review')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AddFolder({ t }: { t: PluginTranslate }) {
  const client = queryClient
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canPick = typeof host.pickOpenPaths === 'function'

  const add = async (candidate: string) => {
    const trimmed = candidate.trim()

    if (!trimmed) {
      setError(t('folderPathNeeded'))

      return
    }

    setBusy(true)
    setError('')

    try {
      await api.addFolder(trimmed)
      setPath('')
      await client.invalidateQueries({ queryKey: keys.desk })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const pick = async () => {
    setError('')

    try {
      const picked = await host.pickOpenPaths({ directories: true, title: t('addFolderTitle') })

      if (picked?.[0]) {
        await add(picked[0])
      }
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={event => {
        event.preventDefault()
        void add(path)
      }}
    >
      <Input
        aria-label={t('addFolder')}
        className="min-w-56 flex-1"
        disabled={busy}
        onChange={event => setPath(event.currentTarget.value)}
        placeholder={t('openFolderPlaceholder')}
        spellCheck={false}
        value={path}
      />
      <Button disabled={busy} size="sm" type="submit" variant="secondary">
        {t('addFolder')}
      </Button>
      {canPick ? (
        <Button disabled={busy} onClick={() => void pick()} size="sm" type="button" variant="ghost">
          {t('browse')}
        </Button>
      ) : null}
      <InlineError message={error} />
    </form>
  )
}

function Composer({ folder, onClose, t }: { folder: DeskFolder; onClose: () => void; t: PluginTranslate }) {
  const client = queryClient
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    const request = text.trim()

    if (!request) {
      setError(t('requestNeeded'))

      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await startWorkstream(folder, request)
      await client.invalidateQueries({ queryKey: keys.desk })

      if (result.error) {
        setError(`${result.error} ${t('queuedSaved')}`)
        setText('')
      } else {
        onClose()
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <Textarea
        aria-label={t('newRequestFor', folder.name)}
        disabled={busy}
        onChange={event => setText(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder={t('requestExample')}
        rows={3}
        value={text}
      />
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <InlineError message={error} />
        <Button disabled={busy} onClick={onClose} size="sm" variant="ghost">
          {t('cancel')}
        </Button>
        <Button disabled={busy} onClick={() => void submit()} size="sm">
          {busy ? t('starting') : t('startRequest')}
        </Button>
      </div>
    </div>
  )
}

function FolderCard({ folder, t }: { folder: DeskFolder; t: PluginTranslate }) {
  const [composing, setComposing] = useState(false)
  const counts = folder.counts ?? {}

  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-card border border-line bg-surface-raised p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="truncate font-semibold text-fg">{folder.name}</div>
        {counts.needs_you ? <span className="shrink-0 text-ui-2xs font-semibold text-warning tabular-nums">{t('needsYouCount', counts.needs_you)}</span> : null}
      </div>
      <div className="truncate text-ui-2xs text-fg-muted" title={folder.path}>
        {folder.path}
      </div>
      <div className="flex gap-1.5 text-ui-xs text-fg-secondary tabular-nums">
        <span>{t('filesCount', counts.files ?? 0)}</span>
        <span>·</span>
        <span>{t('requestsCount', counts.workstreams ?? 0)}</span>
      </div>
      {composing ? (
        <Composer folder={folder} onClose={() => setComposing(false)} t={t} />
      ) : (
        <div className="flex gap-2 pt-1">
          <Button onClick={() => setComposing(true)} size="sm" variant="secondary">
            {t('newRequest')}
          </Button>
        </div>
      )}
    </li>
  )
}

function Recent({ folderName, items, t }: { folderName: (id: string) => string; items: DeskWorkstream[]; t: PluginTranslate }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-ui-xs font-semibold text-fg-muted">{t('recent')}</h2>
      {items.length ? (
        <ul className="flex flex-col gap-0.5">
          {items.map(ws => (
            <li key={ws.id}>
              <button
                className="focus-ring flex min-h-10 w-full items-center gap-3 rounded-row px-2 py-1.5 text-left transition-colors duration-(--dur-fast) ease-standard hover:bg-hover"
                onClick={() => openWorkstream(ws.id)}
                type="button"
              >
                <StatusPill status={ws.status} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="truncate text-ui-sm font-medium text-fg">{ws.title}</div>
                  <div className="flex flex-wrap gap-1.5 text-ui-xs text-fg-muted">
                    <span>{folderName(ws.folder_id)}</span>
                    {ws.last_event?.summary ? (
                      <>
                        <span>·</span>
                        <span className="max-w-md truncate">{ws.last_event.summary}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col items-end whitespace-nowrap text-ui-2xs text-fg-muted tabular-nums">
                  {ws.files_changed ? <span>{t('filesChanged', ws.files_changed)}</span> : null}
                  <span>{timeAgo(ws.updated_at, t)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t('noRequests')}</Empty>
      )}
    </section>
  )
}

export function DeskHome() {
  const t = useDeskI18n()
  const { data, error, isLoading, refetch } = useQuery({ queryFn: api.desk, queryKey: keys.desk, refetchInterval: 15_000 })
  const folders = data?.folders ?? []
  const folderName = (id: string) => folders.find(folder => folder.id === id)?.name ?? t('unknownFolder')

  if (error && isMissingRestEndpoint(error)) {
    // The hermes-office backend is not on this gateway: say so honestly. The
    // same honesty rule as the bots plugin's older-gateway state — never fake
    // a populated Desk.
    return (
      <div className="mx-auto w-full max-w-3xl p-6" data-slot="desk-unavailable">
        <EmptyState description={t('unavailableBody')} icon="briefcase" title={t('unavailableTitle')} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-5 pb-8" data-slot="desk-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-ui-xl font-semibold text-fg">{t('nav')}</h1>
        <HealthLine />
      </header>

      {isLoading ? <SkeletonLines lines={4} /> : null}
      {error ? <QueryError error={error} onRetry={refetch} /> : null}

      {data ? (
        <>
          <NeedsYou folderName={folderName} items={data.needs_you ?? []} t={t} />

          <section className="flex flex-col gap-2">
            <h2 className="text-ui-xs font-semibold text-fg-muted">{t('onYourDesk')}</h2>
            <AddFolder t={t} />
            {folders.length ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
                {folders.map(folder => (
                  <FolderCard folder={folder} key={folder.id} t={t} />
                ))}
              </ul>
            ) : (
              <Empty>{t('noFolders')}</Empty>
            )}
          </section>

          <Recent folderName={folderName} items={data.recent ?? []} t={t} />
        </>
      ) : null}
    </div>
  )
}
