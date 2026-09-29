import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { CopyButton } from '@/components/ui/copy-button'
import { getMessagingPlatforms, type MessagingPlatformInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { openExternalLink } from '@/lib/external-link'
import { cn } from '@/lib/utils'

import { hasPhoneParity, parityLinks } from './phone-parity'
import { renderQr } from './telegram-qr-setup'

export interface ReachTarget {
  id: string
  name: string
  openLink: string
  qrLink: string
}

/** The addresses a profile can be reached at from a phone right now: enabled
 *  platforms whose adapter has published a link a camera can open. A platform
 *  that is enabled but not yet connected has no link and is left out — the
 *  card then offers setup instead of a QR that goes nowhere. */
export function reachTargets(platforms: readonly MessagingPlatformInfo[]): ReachTarget[] {
  return platforms.filter(hasPhoneParity).flatMap(platform => {
    const { openLink, qrLink } = parityLinks(platform)

    return qrLink ? [{ id: platform.id, name: platform.name, openLink, qrLink }] : []
  })
}

/** A profile's phone-reachable addresses; [] when none, or the bridge is absent.
 *  Deferred so a missing API bridge (web host, tests) resolves instead of throwing. */
export function fetchReachTargets(profile: string): Promise<ReachTarget[]> {
  return Promise.resolve()
    .then(() => getMessagingPlatforms(profile))
    .then(result => reachTargets(result.platforms))
    .catch(() => [])
}

/**
 * "Every agent, a QR code": the profile's own messaging address, scannable.
 * The pairing and deep links already live on the Messaging page's platform
 * cards; this lifts them next to the agent itself (a bot's profile rail), so
 * reaching it from a phone — or handing it to someone — is one scan, and an
 * agent with no address yet shows the one step that gives it one.
 */
export function ReachCard({
  className,
  name,
  onManage,
  profile
}: {
  className?: string
  /** Display name used in the copy ("Scan to chat with Atlas…"). */
  name: string
  /** Opens the Messaging page scoped to this profile (setup + management). */
  onManage?: () => void
  profile: string
}) {
  const { t } = useI18n()
  const r = t.messaging.reach
  const p = t.messaging.phoneParity
  const [targets, setTargets] = useState<null | ReachTarget[]>(null)
  const [activeId, setActiveId] = useState<null | string>(null)
  const [qr, setQr] = useState('')

  useEffect(() => {
    let live = true

    void fetchReachTargets(profile).then(next => live && setTargets(next))

    return () => {
      live = false
    }
  }, [profile])

  const active = targets?.find(target => target.id === activeId) ?? targets?.[0] ?? null

  useEffect(() => {
    let live = true
    setQr('')

    if (active) {
      void renderQr(active.qrLink).then(url => live && setQr(url))
    }

    return () => {
      live = false
    }
  }, [active])

  if (targets === null) {
    return null
  }

  if (!active) {
    return (
      <div
        className={cn('flex items-start gap-2.5 rounded-xl bg-(--ui-widget-surface-background) p-3', className)}
        data-slot="reach-card"
        data-state="unreachable"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-(--ui-bg-tertiary) text-(--ui-text-secondary)">
          <Codicon name="device-mobile" size="0.875rem" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <p className="text-[0.8125rem] font-medium text-foreground">{r.title(name)}</p>
          <p className="text-[0.75rem] leading-snug text-(--ui-text-tertiary)">{r.empty(name)}</p>
          {onManage && (
            <Button className="mt-1" onClick={onManage} size="xs" variant="secondary">
              <Codicon name="plug" />
              {r.connect}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-xl bg-(--ui-widget-surface-background) p-3', className)}
      data-slot="reach-card"
      data-state="reachable"
    >
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-foreground">{r.title(name)}</p>
        {targets && targets.length > 1 && (
          <div className="flex shrink-0 gap-0.5">
            {targets.map(target => (
              <button
                aria-pressed={target.id === active.id}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[0.6875rem] transition-colors',
                  target.id === active.id
                    ? 'bg-(--ui-accent)/12 text-(--ui-accent)'
                    : 'text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background)'
                )}
                key={target.id}
                onClick={() => setActiveId(target.id)}
                type="button"
              >
                {target.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {/* White tile in both themes: phone cameras want dark-on-light. */}
        <div className="grid size-24 shrink-0 place-items-center rounded-lg bg-white p-1">
          {qr ? <img alt={r.scan(name)} className="size-full" src={qr} /> : null}
        </div>
        <p className="min-w-0 flex-1 text-[0.75rem] leading-snug text-(--ui-text-tertiary)">{r.scan(name)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button onClick={() => openExternalLink(active.openLink)} size="xs" variant="secondary">
          <Codicon name="link-external" />
          {p.openLink}
        </Button>
        <CopyButton
          appearance="button"
          buttonSize="xs"
          errorMessage={p.copyFailed}
          iconClassName="size-3"
          label={p.copyLink}
          onCopyError={() => undefined}
          text={active.openLink}
        />
        {onManage && (
          <Button className="ml-auto" onClick={onManage} size="xs" variant="ghost">
            {r.manage}
          </Button>
        )}
      </div>
    </div>
  )
}
