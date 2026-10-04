import { hermesApi } from '@/api/client'
import { translateNow } from '@/i18n'
import { notify, notifyError } from '@/store/notifications'

interface ShareCreateResult {
  expires_at: null | number
  path: string
  profile: string
  token: string
  url: string
}

/** Mint a read-only share link for a session and put it on the clipboard.
 *  The grant lives on the backend that owns the session (profile-scoped);
 *  `url` is the server-reported absolute link — a remote gateway's URL points
 *  at that host, not a guessed loopback origin. */
export async function shareSessionLink(sessionId: string, profile?: null | string): Promise<string | null> {
  if (!sessionId) {
    return null
  }

  try {
    const result = await hermesApi<ShareCreateResult>({
      body: { session_id: sessionId, ...(profile ? { profile } : {}) },
      method: 'POST',
      path: '/api/share/create'
    })

    await navigator.clipboard.writeText(result.url)
    notify({ durationMs: 2_000, kind: 'success', message: translateNow('desktop.shareLinkCopied') })

    return result.url
  } catch (err) {
    notifyError(err, translateNow('desktop.shareLinkFailed'))

    return null
  }
}
