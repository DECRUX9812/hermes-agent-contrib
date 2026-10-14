import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import {
  $sharedMetricsConsent,
  $sharedMetricsDetailsOpen,
  answerSharedMetricsOffer,
  type SharedMetricsChoice,
  sharedMetricsProfileRequester
} from '@/store/shared-metrics'

const CHOICES: readonly SharedMetricsChoice[] = ['share', 'local', 'off']
// Keeping data on this machine is the default answer; sharing stays one click away, not louder.
const PRIMARY_CHOICE: SharedMetricsChoice = 'local'

/**
 * The first-run shared-metrics offer, a compact card above the composer: it
 * never blocks the composer or takes focus, and it stays until one of the
 * three answers is saved (the backend's `decided` is the only latch). "Details"
 * opens the full explainer the host paints.
 */
export function SharedMetricsConsentStrip() {
  const { requestGateway } = useGatewayRequest()
  const { t } = useI18n()
  const copy = t.sharedMetrics
  const profile = normalizeProfileKey(useStore($activeGatewayProfile))
  const reask = useStore($sharedMetricsConsent)?.reask === true
  const [saving, setSaving] = useState(false)

  const scopedRequest = useMemo(() => sharedMetricsProfileRequester(requestGateway, profile), [profile, requestGateway])

  const choose = async (choice: SharedMetricsChoice) => {
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
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-surface-raised px-3 py-2 text-ui-xs">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Codicon aria-hidden className="mt-0.5 shrink-0 text-fg-muted" name="graph" size="0.8rem" />
        <p className="m-0 min-w-0 text-fg-secondary">
          <span className="font-medium text-fg">{copy.consentTitle}</span>{' '}
          <span className="text-fg-muted">{reask ? copy.stripReaskBody : copy.stripBody}</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {CHOICES.map(choice => (
          <Button
            disabled={saving}
            key={choice}
            onClick={() => void choose(choice)}
            size="xs"
            type="button"
            variant={choice === PRIMARY_CHOICE ? 'default' : 'ghost'}
          >
            {copy.stripChoices[choice]}
          </Button>
        ))}
        <Button
          onClick={() => $sharedMetricsDetailsOpen.set(true)}
          size="xs"
          type="button"
          variant="ghost"
        >
          {copy.stripDetails}
        </Button>
      </div>
    </div>
  )
}
