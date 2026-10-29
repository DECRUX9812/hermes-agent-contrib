import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'

import { $composerPredictions, clearComposerPrediction, requestComposerPrediction } from '@/store/composer-prediction'

/** Tab on an empty composer takes the prediction; with any text typed, a
 *  modifier held, or a completion popover open, Tab keeps its usual job. */
export function takesPrediction(
  event: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  { draft, prediction, triggerOpen }: { draft: string; prediction: string; triggerOpen: boolean }
): boolean {
  const bareTab = event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey

  return bareTab && Boolean(prediction) && !triggerOpen && !draft.trim()
}

/**
 * The composer's ghost-text prediction for this session. Asked for once each
 * time a turn settles (busy → idle) and dropped the moment the next one starts,
 * so the suggestion always follows the reply on screen.
 */
export function useComposerPrediction({
  busy,
  disabled,
  sessionId
}: {
  busy: boolean
  disabled: boolean
  sessionId: null | string | undefined
}): string {
  const prediction = useStore($composerPredictions)[sessionId ?? ''] ?? ''
  const wasBusyRef = useRef(busy)

  // eslint-disable-next-line no-restricted-syntax -- busy → idle edge tracker; lagging a render IS the contract
  useEffect(() => {
    const wasBusy = wasBusyRef.current
    wasBusyRef.current = busy

    if (busy && !wasBusy) {
      clearComposerPrediction(sessionId)
    } else if (!busy && wasBusy && !disabled) {
      void requestComposerPrediction(sessionId)
    }
  }, [busy, disabled, sessionId])

  return disabled ? '' : prediction
}
