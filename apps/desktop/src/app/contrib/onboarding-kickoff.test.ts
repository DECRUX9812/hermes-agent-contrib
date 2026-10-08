import { afterEach, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import { $setupSession } from '@/components/onboarding-chat/setup-session'
import { assistantTextPart } from '@/lib/chat-messages'
import { $activeGatewayProfile } from '@/store/profile'
import { $activeSessionId, $messages, $selectedStoredSessionId } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { adoptGuideSession } from './onboarding-kickoff'

const messages = [{ id: 'greeting', role: 'assistant' as const, parts: [assistantTextPart('Welcome back')] }]
const setupProfile = 'setup-provisioned'

function publishGuide(storedSessionId: string, visible = true) {
  const state: ClientSessionState = {
    storedSessionId,
    messages,
    branch: '',
    cwd: '',
    model: '',
    provider: '',
    reasoningEffort: '',
    serviceTier: '',
    fast: false,
    yolo: false,
    personality: '',
    skills: {},
    busy: false,
    awaitingResponse: false,
    streamId: null,
    sawAssistantPayload: false,
    adoptedRunningTurn: false,
    pendingBranchGroup: null,
    interrupted: false,
    interimBoundaryPending: false,
    needsInput: false,
    runtimeStartedAt: Date.now(),
    turnStartedAt: null,
    turnLive: false,
    usage: null
  }

  $sessionStates.set({ 'runtime-guide': state })
  $activeSessionId.set('runtime-guide')
  $selectedStoredSessionId.set(storedSessionId)
  $activeGatewayProfile.set(setupProfile)
  $messages.set(visible ? messages : [])
}

afterEach(() => {
  $sessionStates.set({})
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $activeGatewayProfile.set('default')
  $messages.set([])
  $setupSession.set(null)
})

it('adopts the resumed runtime once its transcript is the selected one', async () => {
  const request = vi.fn(async () => {
    throw new Error('Unexpected configuration request')
  })

  await adoptGuideSession(
    setupProfile,
    'guide',
    false,
    async () => {
      publishGuide('guide')
    },
    request
  )
  expect($setupSession.get()).toMatchObject({ storedId: 'guide', runtimeId: 'runtime-guide', profile: setupProfile })
  expect(request).not.toHaveBeenCalled()
  expect($messages.get()).toEqual(messages)
})

it('routes a free-tier setup through the reasoning config request', async () => {
  const request = vi.fn(async () => undefined as never)

  const runtimeId = await adoptGuideSession(
    setupProfile,
    'guide',
    true,
    async () => {
      publishGuide('guide')
    },
    request
  )
  expect(runtimeId).toBe('runtime-guide')
  expect(request).toHaveBeenCalledWith('config.set', {
    session_id: 'runtime-guide',
    key: 'reasoning',
    value: 'minimal'
  })
})

it.each(['no-runtime', 'no-state', 'not-selected', 'wrong-profile'])(
  'rejects a settled resume with %s instead of releasing startup',
  async failure => {
    const request = vi.fn(async () => {
      throw new Error('Unexpected configuration request')
    })

    await expect(
      adoptGuideSession(
        setupProfile,
        'guide',
        false,
        async () => {
          if (failure === 'no-runtime') {
            publishGuide('guide')
            $activeSessionId.set(null)
            return
          }

          if (failure === 'no-state') {
            $activeSessionId.set('runtime-guide')
            $selectedStoredSessionId.set('guide')
            $activeGatewayProfile.set(setupProfile)
            return
          }

          publishGuide('guide')

          if (failure === 'not-selected') {
            $selectedStoredSessionId.set('other')
          }

          if (failure === 'wrong-profile') {
            $activeGatewayProfile.set('default')
          }
        },
        request
      )
    ).rejects.toThrow('could not be loaded')
    expect($setupSession.get()).toBeNull()
    expect(request).not.toHaveBeenCalled()
  }
)
