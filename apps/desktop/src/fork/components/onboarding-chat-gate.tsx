import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import type { OnboardingStateResult } from '@/fork/gateway-types'
import { isOnboardingEnabled } from '@/fork/lib/onboarding-enabled'
import { clearFreeTierIntro } from '@/fork/store/onboarding'
import {
  $onboardingGate,
  $setupProfileName,
  abandonGuide,
  beginOnboardingFlow,
  type GuideKickoffResult,
  markOnboardingStateRead,
  runGuideKickoff
} from '@/fork/store/onboarding-gate'
import { $introView } from '@/fork/store/onboarding-intro'
import { ackFreeTierNotice, type FreeTierRequester } from '@/store/free-tier'

import { failIntro, startIntro } from './onboarding-chat-intro'

interface OnboardingChatGateProps {
  enabled: boolean
  onKickoff: () => Promise<GuideKickoffResult>
  requestGateway: FreeTierRequester
  /** Only the main window runs the intro. Every window still reads the state: the provider picker,
   *  the free-tier introduction and the usage-stats offer wait on that read (afterOnboardingStateRead). */
  runsIntro: boolean
}

export function OnboardingChatGate({ enabled, onKickoff, requestGateway, runsIntro }: OnboardingChatGateProps) {
  const gate = useStore($onboardingGate)

  useEffect(() => {
    if (!enabled || !isOnboardingEnabled()) {
      return
    }

    void requestGateway<OnboardingStateResult>('onboarding.state')
      .then(
        state => {
          $setupProfileName.set(state.profile ?? null)

          if (!runsIntro) {
            return
          }

          beginOnboardingFlow(state)

          if ($onboardingGate.get().guideQueued) {
            startIntro()
          }
        },
        error => console.warn('[onboarding] state could not be read', error)
      )
      .finally(markOnboardingStateRead)
  }, [enabled, requestGateway, runsIntro])

  useEffect(() => {
    if (!enabled || !isOnboardingEnabled()) {
      return
    }

    const ack = () => {
      clearFreeTierIntro()
      void ackFreeTierNotice(requestGateway).then(acked => {
        if (acked) {
          clearFreeTierIntro()
        }
      })
    }

    return $introView.subscribe(view => {
      if (view === 'intro') {
        ack()
      }
    })
  }, [enabled, requestGateway])

  useEffect(() => {
    // No deadline here: the kickoff waits while the backend is known to be coming and settles itself on
    // the states it cannot wait out (onboarding-kickoff-machine.ts).
    if (enabled && gate.guideQueued) {
      const recover = (result: Exclude<GuideKickoffResult, 'started'>) => {
        failIntro()
        abandonGuide(result)
      }

      void runGuideKickoff(onKickoff).then(
        result => {
          if (result !== 'started') {
            recover(result)
          }
        },
        () => recover('failed')
      )
    }
  }, [enabled, gate.guideQueued, onKickoff])

  return null
}
