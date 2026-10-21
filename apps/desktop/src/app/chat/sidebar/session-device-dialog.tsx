import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { renderQr } from '@/app/messaging/telegram-qr-setup'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { connectionEndpoint } from '@/lib/connection-display'
import { buildSessionOpenLink } from '@/lib/session-device-link'
import { $connectionsRegistry } from '@/store/connection-registry-state'
import { $activeConnectionId } from '@/store/connections'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import { $sessions, sessionMatchesStoredId, sessionPinId } from '@/store/session'
import { sessionOwnerRouteFromRow } from '@/store/session-request-router'

interface SessionDeviceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  title: string
}

/**
 * Outbound half of cross-device handoff (#50): "Open on another device"
 * emits a `hermes://session/open?…` deep link (QR + copyable URL) that any
 * Hermes device with a connection to the session's home backend can open.
 * Nothing is transferred — the link carries the stored id, profile, and a
 * non-secret fingerprint of the home connection (install_id, endpoint), so
 * the session stays put and only the VIEW re-homes.
 */
export function SessionDeviceDialog({ open, onOpenChange, sessionId, title }: SessionDeviceDialogProps) {
  const { t } = useI18n()
  const registry = useStore($connectionsRegistry)
  const activeConnectionId = useStore($activeConnectionId)
  const activeProfile = useStore($activeGatewayProfile)
  const sessions = useStore($sessions)
  const [qr, setQr] = useState('')

  const { connection, link } = useMemo(() => {
    const row = sessions.find(candidate => sessionMatchesStoredId(candidate, sessionId))
    const owner = sessionOwnerRouteFromRow(row)

    const conn =
      registry?.connections.find(candidate => candidate.id === (owner?.connectionId ?? activeConnectionId)) ??
      registry?.connections.find(candidate => candidate.id === activeConnectionId)

    return {
      connection: conn,
      link: buildSessionOpenLink(
        { id: sessionPinId(row ?? { id: sessionId }), profile: row?.profile ?? activeProfile, title },
        conn
      )
    }
  }, [activeConnectionId, activeProfile, registry, sessionId, sessions, title])

  useEffect(() => {
    if (!open || !link) {
      return
    }

    let live = true

    void renderQr(link).then(url => {
      if (live) {
        setQr(url)
      }
    })

    return () => {
      live = false
      setQr('')
    }
  }, [link, open])

  const home = connection ? `${connection.label} (${connectionEndpoint(connection) ?? connection.kind})` : null

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.sidebar.row.openDeviceTitle}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            {t.sidebar.row.openDeviceDesc(home ?? t.sidebar.row.openDeviceHomeFallback)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3">
          {qr && <img alt={t.sidebar.row.openDeviceTitle} className="rounded-sm" height={128} src={qr} width={128} />}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Input readOnly value={link} />
            <CopyButton
              appearance="button"
              buttonSize="sm"
              errorMessage={t.common.copyFailed}
              iconClassName="size-3.5"
              label={t.common.copy}
              onCopyError={err => notifyError(err, t.common.copyFailed)}
              text={link}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
