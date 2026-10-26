import { useStore } from '@nanostores/react'
import { useEffect, useId, useMemo, useState } from 'react'

import { DocsLink } from '@/components/onboarding/flow'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  preventCloseButtonAutoFocus
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { ChevronDown } from '@/lib/icons'
import { $tourActive } from '@/lib/tour/tour-active'
import { cn } from '@/lib/utils'
import { dismissNotification, notify, notifyError } from '@/store/notifications'
import { $desktopOnboarding } from '@/store/onboarding'
import { $onboardingSurfaceClear } from '@/store/onboarding-presence'
import {
  $sharedMetricsConsent,
  $sharedMetricsDetailsOpen,
  answerSharedMetricsOffer,
  readSharedMetricsConsent,
  SHARED_METRICS_DOCS_URL,
  type SharedMetricsChoice,
  sharedMetricsOfferPending,
  sharedMetricsProfileRequester,
  type SharedMetricsRequester
} from '@/store/shared-metrics'

interface SharedMetricsConsentDialogProps {
  /** The focused gateway is open. */
  enabled: boolean
  /** Re-ask per profile: each profile keeps its own opt-ins and install ID. */
  profile: string
  requestGateway: SharedMetricsRequester
}

const CHOICE_ORDER: readonly SharedMetricsChoice[] = ['share', 'off']

/** The offer's toast id — one standing question, never stacked. */
export const SHARED_METRICS_OFFER_ID = 'shared-metrics-offer'

/**
 * Offer-notice state for this app session. `dismissed`: the user's ✕ means
 * "not now", so keep it away until the app reloads. `closing`: set while code
 * clears or answers the notice, so that close is not read as "not now".
 */
const offerState = { closing: false, dismissed: false }

/** Clear the offer notice from code (not the user's ✕). */
function closeOffer() {
  offerState.closing = true
  dismissNotification(SHARED_METRICS_OFFER_ID)
  offerState.closing = false
}

/**
 * Owner of the one-time shared-metrics question, the Desktop twin of `hermes
 * setup`'s Shared Metrics section. It reads the focused profile's answer once
 * first-run onboarding is out of the way; an unanswered profile gets an OFFER as
 * a quiet bottom-right notice (two equal answers plus Details), never a modal
 * and never a strip glued to the composer — a healthy install opens straight
 * to chat. Closing the notice with ✕ puts the question away for this session. An answer given in the CLI (or here,
 * or in Settings) is the same config keys, so nobody is asked twice. This host
 * also paints the "What is collected" details the strip opens on request:
 * two equal choices, neither preselected or focused, and closing it decides
 * nothing (the notice comes back until answered).
 */
export function SharedMetricsConsentDialog({ enabled, profile, requestGateway }: SharedMetricsConsentDialogProps) {
  const { t } = useI18n()
  const copy = t.sharedMetrics
  const onboarding = useStore($desktopOnboarding)
  const surfaceClear = useStore($onboardingSurfaceClear)
  const tourActive = useStore($tourActive)
  const detailsId = useId()
  const consent = useStore($sharedMetricsConsent)
  const detailsOpen = useStore($sharedMetricsDetailsOpen)
  const [expanded, setExpanded] = useState(true)
  const [saving, setSaving] = useState(false)

  const scopedRequest = useMemo(() => sharedMetricsProfileRequester(requestGateway, profile), [profile, requestGateway])

  // Never over the provider picker, the free-tier welcome, onboarding or a tour on screen:
  // the question belongs to the moment after setup.
  const onboardingSettled =
    (onboarding.configured === true || onboarding.firstRunSkipped) &&
    !onboarding.manual &&
    !onboarding.freeTierReady &&
    surfaceClear &&
    !tourActive

  const ready = enabled && onboardingSettled

  useEffect(() => {
    $sharedMetricsConsent.set(null)

    if (!ready) {
      return
    }

    let cancelled = false

    void readSharedMetricsConsent(scopedRequest).then(next => {
      if (!cancelled) {
        $sharedMetricsConsent.set(next)
      }
    })

    return () => void (cancelled = true)
  }, [ready, profile, scopedRequest])

  const offerPending = ready && sharedMetricsOfferPending(consent)
  const reask = consent?.reask === true

  useEffect(() => {
    if (!offerPending || detailsOpen || offerState.dismissed) {
      closeOffer()

      return
    }

    const answer = (choice: SharedMetricsChoice) => {
      offerState.closing = true
      void answerSharedMetricsOffer(scopedRequest, choice).catch(err => notifyError(err, copy.saveFailed))
    }

    notify({
      action: { label: copy.stripChoices.share, onClick: () => answer('share') },
      actionsEqual: true,
      icon: 'graph',
      id: SHARED_METRICS_OFFER_ID,
      kind: 'info',
      linkAction: { label: copy.stripDetails, onClick: () => $sharedMetricsDetailsOpen.set(true) },
      message: reask ? copy.stripReaskBody : copy.stripBody,
      onDismiss: () => {
        // Details / answers dismiss the notice too; only a bare close is "not now".
        if (offerState.closing || $sharedMetricsDetailsOpen.get()) {
          offerState.closing = false

          return
        }

        offerState.dismissed = true
      },
      persistent: true,
      placement: 'bottom-right',
      secondaryAction: { label: copy.stripChoices.off, onClick: () => answer('off') },
      title: copy.consentTitle
    })
  }, [copy, detailsOpen, offerPending, reask, scopedRequest])

  useEffect(() => () => closeOffer(), [])

  if (!ready || !detailsOpen || !sharedMetricsOfferPending(consent)) {
    return null
  }

  const choose = async (choice: SharedMetricsChoice) => {
    if (saving) {
      return
    }

    setSaving(true)

    try {
      await answerSharedMetricsOffer(scopedRequest, choice)
    } catch (err) {
      notifyError(err, copy.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={open => $sharedMetricsDetailsOpen.set(open)} open>
      <DialogContent className="max-w-md" onOpenAutoFocus={preventCloseButtonAutoFocus}>
        <DialogHeader>
          <DialogTitle>{copy.dialogTitle}</DialogTitle>
          <DialogDescription>{copy.consentBody}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <button
            aria-controls={detailsId}
            aria-expanded={expanded}
            className="flex w-fit items-center gap-1 text-sm font-medium text-(--ui-text-secondary) hover:text-(--ui-text-primary)"
            onClick={() => setExpanded(value => !value)}
            type="button"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', expanded ? 'rotate-0' : '-rotate-90')} />
            {copy.whatIsCollected}
          </button>
          {expanded ? (
            <div
              className="rounded-lg bg-(--ui-bg-tertiary)/40 px-3 py-2.5 text-[0.8125rem] leading-5 text-(--ui-text-secondary)"
              id={detailsId}
            >
              <ul className="list-disc space-y-0.5 pl-5">
                <li>{copy.collectedActivity}</li>
                <li>{copy.collectedModels}</li>
                <li>{copy.collectedNames}</li>
                <li>{copy.collectedUsage}</li>
                <li>{copy.collectedMilestones}</li>
                <li>{copy.collectedReliability}</li>
                <li>{copy.collectedMachine}</li>
              </ul>
            </div>
          ) : null}
        </div>

        <div className="grid gap-2 text-[0.8125rem] leading-5 text-(--ui-text-secondary)">
          <p>{copy.sending}</p>
          <div>
            <DocsLink href={SHARED_METRICS_DOCS_URL}>{copy.readDocs}</DocsLink>
          </div>
        </div>

        <div className="grid gap-2">
          {CHOICE_ORDER.map(choice => (
            <Button disabled={saving} key={choice} onClick={() => void choose(choice)} type="button" variant="outline">
              {copy[choice]}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
