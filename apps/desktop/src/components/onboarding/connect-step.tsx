import { type ReactNode, useEffect, useRef, useState } from 'react'

import { useWebAccessAvailable } from '@/app/settings/web-access-settings'
import { Button } from '@/components/ui/button'
import {
  cancelGithubLogin,
  getGithubStatus,
  getTunnelStatus,
  type GithubStatus,
  startGithubLogin,
  startTunnel,
  stopTunnel,
  type TunnelStatus
} from '@/hermes'
import { useI18n } from '@/i18n'
import type { SetupConnectTranslations } from '@/i18n/types_setup_connect'
import { ExternalLink } from '@/lib/external-link'
import { Check, Globe, Loader2, Lock } from '@/lib/icons'
import { cn } from '@/lib/utils'

const GITHUB_POLL_MS = 2000
const GITHUB_DEVICE_URL = 'https://github.com/login/device'

export type SetupStep = 'connect' | 'identity' | 'model'

const STEP_ORDER: SetupStep[] = ['identity', 'model', 'connect']

/** The three first-run steps; earlier steps read as done. */
export function SetupStepper({ current }: { current: SetupStep }) {
  const { t } = useI18n()
  const at = STEP_ORDER.indexOf(current)

  return (
    <ol aria-label={t.setupConnect.title} className="flex items-center gap-2 px-5 pt-4 text-[0.6875rem] font-medium">
      {STEP_ORDER.map((step, index) => (
        <li
          aria-current={index === at ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5',
            index === at ? 'text-foreground' : index < at ? 'text-(--ui-text-secondary)' : 'text-(--ui-text-quaternary)'
          )}
          key={step}
        >
          <span
            className={cn(
              'grid size-4 place-items-center rounded-full border text-[0.5625rem]',
              index <= at ? 'border-primary bg-primary/10' : 'border-(--ui-stroke-tertiary)'
            )}
          >
            {index < at ? <Check className="size-2.5" /> : index + 1}
          </span>
          {t.setupConnect.steps[step]}
          {index < STEP_ORDER.length - 1 ? <span className="ml-1 h-px w-6 bg-(--ui-stroke-tertiary)" /> : null}
        </li>
      ))}
    </ol>
  )
}

/** Step 3: optional GitHub sign-in and remote access. Both cards are skippable; `onDone` opens the chat. */
export function ConnectStep({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const copy = t.setupConnect

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">{copy.title}</h2>
        <p className="mt-1 text-[0.8125rem] text-(--ui-text-tertiary)">{copy.intro}</p>
      </div>
      <GithubCard copy={copy} />
      <RemoteCard copy={copy} onOwnDomain={onDone} />
      <div className="flex items-center justify-between gap-3 pt-1">
        <Button className="font-medium" onClick={onDone} size="xs" type="button" variant="text">
          {copy.skip}
        </Button>
        <Button onClick={onDone} type="button">
          {copy.continue}
        </Button>
      </div>
    </div>
  )
}

function Card({ children, icon, title, desc }: { children: ReactNode; desc: string; icon: ReactNode; title: string }) {
  return (
    <section className="grid gap-3 rounded-2xl border border-(--ui-stroke-tertiary) bg-background/60 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-(--ui-text-secondary)">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function useMounted() {
  const mounted = useRef(true)

  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )

  return mounted
}

export function GithubCard({ copy }: { copy: SetupConnectTranslations }) {
  const g = copy.github
  const mounted = useMounted()
  const [status, setStatus] = useState<GithubStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)

  useEffect(() => {
    void getGithubStatus().then(
      next => mounted.current && setStatus(next),
      () => mounted.current && setStatus({ account: null, authenticated: false, available: false, login: null })
    )
  }, [mounted])

  const pending = status?.login?.state === 'pending' && !status.authenticated

  // gh finishes the device flow on its own; poll until it reports the account.
  useEffect(() => {
    if (!pending) {
      return
    }

    const timer = window.setInterval(() => {
      void getGithubStatus().then(next => mounted.current && setStatus(next), () => undefined)
    }, GITHUB_POLL_MS)

    return () => window.clearInterval(timer)
  }, [mounted, pending])

  const start = async () => {
    setBusy(true)
    setError(null)

    try {
      const login = await startGithubLogin()

      if (mounted.current) {
        setStatus(prev => ({ account: null, authenticated: false, available: true, ...prev, login }))
      }
    } catch (err) {
      mounted.current && setError(err instanceof Error ? err.message : g.failed)
    } finally {
      mounted.current && setBusy(false)
    }
  }

  const cancel = () => {
    void cancelGithubLogin().finally(() => mounted.current && setStatus(prev => (prev ? { ...prev, login: null } : prev)))
  }

  const failed = status?.login?.state === 'failed' && !status.authenticated

  return (
    <Card desc={g.desc} icon={<Lock className="size-4" />} title={g.title}>
      {status === null ? (
        <Loader2 aria-label={g.title} className="size-4 animate-spin text-muted-foreground" />
      ) : status.authenticated ? (
        <p className="flex items-center gap-1.5 text-sm" role="status">
          <Check className="size-3.5 text-emerald-500" />
          {status.account ? g.signedIn(status.account) : g.signedInNoName}
        </p>
      ) : !status.available ? (
        <p className="text-xs text-muted-foreground">{g.notInstalled}</p>
      ) : pending && status.login?.user_code ? (
        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">{g.codeLabel}</span>
          <code className="w-fit select-all rounded-lg bg-(--ui-bg-tertiary) px-3 py-1.5 font-mono text-lg tracking-[0.2em]">
            {status.login.user_code}
          </code>
          <div className="flex flex-wrap items-center gap-3">
            <ExternalLink className="text-sm" href={status.login.verification_url || GITHUB_DEVICE_URL} native showExternalIcon>
              {g.openPage}
            </ExternalLink>
            <Button onClick={cancel} size="xs" type="button" variant="text">
              {g.cancel}
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {g.waiting}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {failed || error ? <p className="text-xs text-destructive">{error ?? status.login?.detail ?? g.failed}</p> : null}
          <Button className="w-fit" disabled={busy} onClick={() => void start()} size="sm" type="button" variant="outline">
            {busy ? <Loader2 className="animate-spin" /> : null}
            {failed ? g.retry : g.signIn}
          </Button>
        </div>
      )}
    </Card>
  )
}

export function RemoteCard({ copy, onOwnDomain }: { copy: SetupConnectTranslations; onOwnDomain?: () => void }) {
  const r = copy.remote
  // The tunnel exposes the computer the gateway runs on: only the native app there may change it.
  const native = useWebAccessAvailable()
  const mounted = useMounted()
  const [status, setStatus] = useState<TunnelStatus | null>(null)
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null)
  const [error, setError] = useState<null | string>(null)

  useEffect(() => {
    if (!native) {
      return
    }

    void getTunnelStatus().then(
      next => mounted.current && setStatus(next),
      () => mounted.current && setStatus({ cloudflared: false, port: null, running: false, stale: false, url: null })
    )
  }, [mounted, native])

  const run = async (kind: 'start' | 'stop') => {
    setBusy(kind)
    setError(null)

    try {
      const { tunnel } = await (kind === 'start' ? startTunnel() : stopTunnel())

      if (mounted.current) {
        setStatus(prev => ({ cloudflared: true, port: null, stale: false, ...prev, ...tunnel }))
      }
    } catch (err) {
      mounted.current && setError(err instanceof Error ? `${r.failed}: ${err.message}` : r.failed)
    } finally {
      mounted.current && setBusy(null)
    }
  }

  return (
    <Card desc={r.desc} icon={<Globe className="size-4" />} title={r.title}>
      {!native ? (
        <p className="text-xs text-muted-foreground">{r.hostOnly}</p>
      ) : status === null ? (
        <Loader2 aria-label={r.title} className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid gap-2">
          {status.running && status.url ? (
            <p className="flex flex-wrap items-center gap-1.5 text-sm" role="status">
              <Check className="size-3.5 text-emerald-500" />
              {r.running}
              <ExternalLink className="font-mono text-xs" href={status.url} native showExternalIcon>
                {status.url}
              </ExternalLink>
            </p>
          ) : (
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{r.localOnly}</span> — {r.localOnlyDesc}
              </span>
              <span>
                <span className="font-medium text-foreground">{r.tunnel}</span> — {r.tunnelDesc}
              </span>
            </div>
          )}
          {status.stale && !status.running ? <p className="text-xs text-amber-600">{r.stale}</p> : null}
          {!status.cloudflared && !status.running ? <p className="text-xs text-muted-foreground">{r.noCloudflared}</p> : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            {status.running ? (
              <Button disabled={busy !== null} onClick={() => void run('stop')} size="sm" type="button" variant="outline">
                {busy === 'stop' ? <Loader2 className="animate-spin" /> : null}
                {r.stop}
              </Button>
            ) : (
              <Button
                disabled={busy !== null || !status.cloudflared}
                onClick={() => void run('start')}
                size="sm"
                type="button"
                variant="outline"
              >
                {busy === 'start' ? <Loader2 className="animate-spin" /> : null}
                {busy === 'start' ? r.starting : r.start}
              </Button>
            )}
            <a className="text-xs text-(--ui-text-secondary) underline-offset-2 hover:underline" href="#/settings?tab=web-access"
              onClick={onOwnDomain}
            >
              {r.ownDomain}
            </a>
          </div>
        </div>
      )}
    </Card>
  )
}
