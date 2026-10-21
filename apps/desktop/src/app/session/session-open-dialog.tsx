import { useStore } from '@nanostores/react'

import { sessionRoute, SETTINGS_ROUTE } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { selectConnection } from '@/store/connections'
import { $sessionOpenRequest, closeSessionOpenRequest } from '@/store/session-open-request'

import type { OpenSessionNavigate } from '../open-session'

/**
 * Inbound `hermes://session/open?…` deep link (#50). The handler in
 * use-desktop-integrations opens the session directly when the link resolves
 * to the ALREADY-ACTIVE connection/profile; everything else waits here for an
 * explicit yes:
 *
 *  - a known-but-inactive connection gets a confirm — accepting re-homes the
 *    whole window to that source (`selectConnection`) before navigating;
 *  - no matching connection means the device can't reach the session's home
 *    backend — the dialog says where it lives and routes to Gateways settings
 *    rather than inventing a connection on the spot.
 */
export function SessionOpenDialog({ navigate }: { navigate: OpenSessionNavigate }) {
  const { t } = useI18n()
  const request = useStore($sessionOpenRequest)

  if (!request) {
    return null
  }

  const { connection, endpoint, profile, sessionId, title } = request

  if (!connection) {
    return (
      <Dialog onOpenChange={open => !open && closeSessionOpenRequest()} open>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.sidebar.row.openDeviceIncomingMissingTitle}</DialogTitle>
            <DialogDescription className="whitespace-pre-line">
              {t.sidebar.row.openDeviceIncomingMissingDesc(title ?? sessionId, endpoint ?? '')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={closeSessionOpenRequest} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => {
                closeSessionOpenRequest()
                navigate(`${SETTINGS_ROUTE}?tab=gateway`)
              }}
              type="button"
            >
              {t.sidebar.row.openDeviceOpenConnections}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <ConfirmDialog
      busyLabel={t.sidebar.row.openDeviceSwitching}
      confirmLabel={t.sidebar.row.openDeviceSwitchAndOpen}
      description={t.sidebar.row.openDeviceIncomingDesc(
        title ?? sessionId,
        profile && profile !== 'default' ? `${connection.label} · ${profile}` : connection.label
      )}
      onClose={closeSessionOpenRequest}
      onConfirm={async () => {
        // Re-home the window to the session's connection/profile, then let the
        // session route's resume machinery fetch the row once the new backend
        // is live. The link is a VIEW move — the session's home never changes.
        await selectConnection(connection.id, { profile: profile ?? null })
        navigate(sessionRoute(sessionId))
      }}
      open
      title={t.sidebar.row.openDeviceIncomingTitle}
    />
  )
}
