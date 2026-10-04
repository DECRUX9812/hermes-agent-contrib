import { useEffect, useState } from 'react'

import { StatusDot, type StatusTone } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { type MessagingPlatformInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { openExternalLink } from '@/lib/external-link'
import { ExternalLink, Smartphone } from '@/lib/icons'

import { renderQr } from './telegram-qr-setup'

/** The link a phone should carry. `slack://…` opens the app but a camera can't
 *  scan it, so QRs prefer the vendor's https fallback; the Open button takes the
 *  native deep link first. */
export function parityLinks(platform: MessagingPlatformInfo): { openLink: string; qrLink: string } {
  const identity = platform.identity
  const deep = identity?.deep_link || ''
  const web = identity?.web_link || ''

  return {
    openLink: deep || web,
    qrLink: deep.startsWith('http') ? deep : web || deep
  }
}

/** Whether this platform can offer a "continue on your phone" surface at all —
 *  the adapters that publish an identity today (Telegram, Slack) plus any that
 *  start publishing one. A disabled platform never shows the card: there is no
 *  bot to reach yet, and pairing/setup already lives above it. */
export function hasPhoneParity(platform: MessagingPlatformInfo): boolean {
  return platform.enabled && (platform.id === 'telegram' || platform.id === 'slack' || Boolean(platform.identity))
}

export function PhoneParityCard({
  platform,
  stateLabel,
  tone
}: {
  platform: MessagingPlatformInfo
  stateLabel: string
  tone: StatusTone
}) {
  const { t } = useI18n()
  const p = t.messaging.phoneParity
  const { openLink, qrLink } = parityLinks(platform)
  const [qr, setQr] = useState('')

  useEffect(() => {
    let live = true

    if (qrLink) {
      void renderQr(qrLink).then(url => {
        if (live) {
          setQr(url)
        }
      })
    } else {
      setQr('')
    }

    return () => {
      live = false
    }
  }, [qrLink])

  return (
    <div className="mt-3 rounded-md border border-(--ui-border) p-3" data-phone-parity={platform.id}>
      <div className="flex items-center gap-2 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary)">
        <Smartphone className="size-3.5" />
        <span className="font-medium text-(--ui-text-primary)">{p.title}</span>
        <span className="ml-auto inline-flex items-center gap-1.5" title={p.presence}>
          <StatusDot tone={tone} />
          {stateLabel}
        </span>
      </div>
      <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {qrLink ? p.scanHint : p.linkPending}
      </p>
      {qr && <img alt={p.title} className="mt-2 rounded-sm" height={112} src={qr} width={112} />}
      <div className="mt-2 flex items-center gap-2">
        <Button disabled={!openLink} onClick={() => openExternalLink(openLink)} size="sm" variant="secondary">
          {p.openLink}
          <ExternalLink className="size-3.5" />
        </Button>
        <CopyButton
          appearance="button"
          buttonSize="sm"
          disabled={!openLink}
          errorMessage={p.copyFailed}
          iconClassName="size-3.5"
          label={p.copyLink}
          onCopyError={() => undefined}
          text={openLink}
        />
      </div>
    </div>
  )
}
