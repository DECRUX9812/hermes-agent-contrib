'use client'

import { useStore } from '@nanostores/react'
import { type FC, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { WIDGET_SHELL_CLASS } from '@/components/chat/widget-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { isMissingPendingPromptRequest } from '@/lib/gateway-rpc'
import { triggerHaptic } from '@/lib/haptics'
import { KeyRound, Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $gateway } from '@/store/gateway'
import { reconnectAction } from '@/store/gateway-reconnect'
import { notifyError } from '@/store/notifications'
import { clearSecretRequest, type SecretRequest, sessionSecretRequest } from '@/store/prompts'
import { respondToServerRequest } from '@/store/server-requests'

/** The session-bound `secret` server request, rendered as a masked input row at
 *  the transcript tail — the same place the approval stack parks. Sessionless
 *  requests (raised outside any chat) keep the modal `SecretDialog` overlay; a
 *  request parked on a background session waits here, surfaced by the sidebar
 *  "needs input" badge, exactly like an approval.
 *
 *  The value only ever leaves via the `respondToServerRequest` reply frame —
 *  the backend writes it to the profile's secrets/.env and the model never
 *  sees it. Nothing about the answer renders into the transcript. */
export const PendingSecretCard: FC = () => {
  const sessionId = useStore(useSessionView().$runtimeId)
  const request = useStore(useMemo(() => sessionSecretRequest(sessionId), [sessionId]))

  // Session-bound asks only — a sessionless request belongs to the modal
  // overlay (it has no transcript to sit in).
  if (!sessionId || !request || request.sessionId !== sessionId) {
    return null
  }

  return <SecretRequestCard request={request} />
}

const SecretRequestCard: FC<{ request: SecretRequest }> = ({ request }) => {
  const { t } = useI18n()
  const copy = t.prompts
  const gateway = useStore($gateway)
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setValue('')
    setSubmitting(false)
  }, [request.requestId])

  const send = useCallback(
    async (secret: string) => {
      if (!gateway) {
        notifyError(new Error(copy.gatewayDisconnected), copy.secretSendFailed, { action: reconnectAction() })

        return
      }

      setSubmitting(true)

      try {
        // False when the request already expired/cancelled backend-side — the
        // card is unanswerable either way, so drop it rather than wedge it.
        if (!respondToServerRequest(request.requestId, { value: secret })) {
          clearSecretRequest(request.sessionId, request.requestId)

          return
        }

        triggerHaptic('submit')
        clearSecretRequest(request.sessionId, request.requestId)
      } catch (error) {
        // The request was already cancelled/expired backend-side — treat the
        // late answer as answered and drop the card.
        if (isMissingPendingPromptRequest(error, 'value')) {
          clearSecretRequest(request.sessionId, request.requestId)

          return
        }

        notifyError(error, copy.secretSendFailed)
        setSubmitting(false)
      }
    },
    [copy.gatewayDisconnected, copy.secretSendFailed, gateway, request]
  )

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (value) {
        void send(value)
      }
    },
    [send, value]
  )

  // No autoFocus: this card can land mid-typing, and focus steal is banned.
  return (
    <section
      aria-label={request.envVar || copy.secretTitle}
      className={cn('my-1.5 w-full max-w-xl self-center', WIDGET_SHELL_CLASS)}
      data-secret-request=""
      data-slot="secret-request-card"
    >
      <form className="grid gap-2" onSubmit={onSubmit}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-(--conversation-line-height) text-(--ui-text-primary)">
              {request.envVar || copy.secretTitle}
            </p>
            <p className="leading-(--conversation-line-height) text-(--ui-text-secondary)">
              {request.prompt || copy.secretDesc}
            </p>
          </div>
          <KeyRound aria-hidden className="mt-px size-4 shrink-0 text-(--ui-text-tertiary)" />
        </div>
        <div className="flex items-center gap-2">
          <Input
            autoComplete="off"
            className="flex-1"
            disabled={submitting}
            onChange={event => setValue(event.target.value)}
            placeholder={request.envVar || copy.secretPlaceholder}
            type="password"
            value={value}
          />
          <Button disabled={submitting} onClick={() => void send('')} type="button" variant="ghost">
            {copy.secretCardSkip}
          </Button>
          <Button disabled={submitting || !value} type="submit">
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : copy.secretCardSave}
          </Button>
        </div>
        <p className="text-[0.6875rem] leading-4 text-(--ui-text-tertiary)">{copy.secretCardFootnote}</p>
      </form>
    </section>
  )
}
