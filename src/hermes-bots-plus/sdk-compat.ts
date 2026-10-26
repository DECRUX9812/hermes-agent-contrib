// Bridges the fork's Bot Mode 2.0 onto Nous main's plugin SDK. The fork's SDK
// exports helpers, components, atoms and contribution areas Nous main does not.
// Each one falls back here and records that it was hit, so the spike can
// report exactly which seams are missing. A native export always wins.
import { atom } from 'nanostores'

import * as real from '@hermes/plugin-sdk'

export * from '@hermes/plugin-sdk'

type AnyFn = (...args: never[]) => unknown

const sdk = real as unknown as Record<string, unknown>

export const compatReport = { hits: {} as Record<string, number>, stubbed: [] as string[] }

;(globalThis as { __hermesBotsPlusCompat?: typeof compatReport }).__hermesBotsPlusCompat = compatReport

function hit(name: string) {
  compatReport.hits[name] = (compatReport.hits[name] ?? 0) + 1
}

function pick<T>(name: string, fallback: T): T {
  if (name in sdk) {
    return sdk[name] as T
  }

  compatReport.stubbed.push(name)

  if (typeof fallback !== 'function') {
    return fallback
  }

  return ((...args: never[]) => {
    hit(name)

    return (fallback as AnyFn)(...args)
  }) as T
}

// The fork grew `host` with state atoms and methods Nous main lacks. Stubs
// keep the UI mounted; every stubbed method call is counted.
const realHost = (sdk.host ?? {}) as Record<string, unknown> & { state?: Record<string, unknown> }

const HOST_STATE_DEFAULTS: Record<string, unknown> = {
  attentionCountsByOwner: {},
  attentionItems: [],
  cronJobs: [],
  dotStateBySession: {},
  focusedActivity: [],
  focusedMessages: [],
  sessionWorkspaceScopes: {},
  showsAdvancedChrome: false,
  sidebarSearchQuery: '',
  statusItemsBySession: {},
  storedSessionByRuntimeId: {}
}

const HOST_METHOD_DEFAULTS: Record<string, AnyFn> = {
  exportProfileBundle: async () => {
    throw new Error('Profile export is not available on this Hermes build')
  },
  importProfileBundle: async () => {
    throw new Error('Profile import is not available on this Hermes build')
  },
  listCronJobRuns: async () => [],
  listProfileArtifacts: async () => [],
  pickOpenPaths: async () => null,
  pickSavePath: async () => null,
  sessionOwner: () => null
}

const hostState: Record<string, unknown> = { ...(realHost.state ?? {}) }

for (const [key, value] of Object.entries(HOST_STATE_DEFAULTS)) {
  if (!(key in hostState)) {
    compatReport.stubbed.push(`host.state.${key}`)
    hostState[key] = atom(value)
  }
}

const hostCompat: Record<string, unknown> = { ...realHost, state: hostState }

for (const [key, fallback] of Object.entries(HOST_METHOD_DEFAULTS)) {
  if (!(key in hostCompat)) {
    compatReport.stubbed.push(`host.${key}`)
    hostCompat[key] = (...args: never[]) => {
      hit(`host.${key}`)

      return fallback(...args)
    }
  }
}

export const host = hostCompat as unknown as typeof real.host

/** Contributions to an area Nous main's shell never renders: they register
 *  fine and simply never paint. The id prefix makes them easy to spot. */
function missingAreas(name: string): Record<string, string> {
  return new Proxy({} as Record<string, string>, {
    get: (_target, key) => (typeof key === 'string' ? `hbp-unrendered:${name}.${key}` : undefined)
  })
}

interface ChildrenProps {
  children?: unknown
}

const passthrough = (props: ChildrenProps) => props?.children ?? null
const nothing = () => null

interface MessageLike {
  parts?: readonly { text?: unknown; type?: string }[]
}

interface JobLike {
  enabled?: boolean
  state?: unknown
}

export const CHAT_HEADER_AREAS = pick('CHAT_HEADER_AREAS', missingAreas('CHAT_HEADER_AREAS'))
export const SIDEBAR_LIST_TOP_AREA = pick('SIDEBAR_LIST_TOP_AREA', 'hbp-unrendered:SIDEBAR_LIST_TOP_AREA')

export const $ownerNotifyModes = pick('$ownerNotifyModes', atom<Record<string, string>>({}))
export const $watchedSessionKeys = pick('$watchedSessionKeys', atom<readonly string[]>([]))

export const AskRulesCard = pick('AskRulesCard', nothing)
export const ReachCard = pick('ReachCard', nothing)
export const SidebarPanelLabel = pick('SidebarPanelLabel', passthrough)
export const SidebarSectionMeta = pick('SidebarSectionMeta', passthrough)
export const DropdownMenuCheckboxItem = pick('DropdownMenuCheckboxItem', passthrough)
export const DropdownMenuSub = pick('DropdownMenuSub', passthrough)
export const DropdownMenuSubContent = pick('DropdownMenuSubContent', nothing)
export const DropdownMenuSubTrigger = pick('DropdownMenuSubTrigger', passthrough)

export const chatMessageText = pick('chatMessageText', (message: MessageLike) =>
  (message?.parts ?? [])
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text as string)
    .join('')
)

export const jobState = pick('jobState', (job: JobLike) => {
  const state = typeof job?.state === 'string' ? job.state.trim() : ''

  return state || (job?.enabled === false ? 'disabled' : 'scheduled')
})

export const isMissingRpcMethod = pick('isMissingRpcMethod', (error: unknown) =>
  /method not found|unknown method|-32601/i.test(String((error as Error)?.message ?? error))
)

export const answeredAfter = pick('answeredAfter', () => false)
export const armTranscriptReplayJump = sdk.armTranscriptReplayJump as AnyFn | undefined
export const bopMascotMarkup = pick('bopMascotMarkup', () => '')
export const confirm = pick('confirm', async () => false)
export const currentStep = pick('currentStep', () => null)
export const fetchReachTargets = pick('fetchReachTargets', async () => [])
export const isWatchedSessionId = pick('isWatchedSessionId', () => false)
export const ownerNotifyKey = pick('ownerNotifyKey', (...parts: unknown[]) => parts.join(':'))
export const renderQr = pick('renderQr', () => '')
export const setOwnerNotifyMode = pick('setOwnerNotifyMode', () => undefined)
export const toggleSessionWatched = pick('toggleSessionWatched', () => undefined)
// Nous main has no per-surface session view. Approximate it with the focused
// session's atoms: right for the primary chat, but a tile reads the focused
// chat instead of its own, and the transcript is not exposed.
const emptyMessages = atom<readonly unknown[]>([])
const focusedView = {
  kind: 'primary' as const,
  $awaitingResponse: hostState.awaitingResponse ?? atom(false),
  $busy: hostState.busy ?? atom(false),
  $cwd: hostState.cwd ?? atom(''),
  $messages: emptyMessages,
  $messagesEmpty: atom(true),
  $model: hostState.model ?? atom(''),
  $runtimeId: hostState.focusedSessionId ?? atom(null),
  $storedId: hostState.focusedStoredSessionId ?? atom(null)
}

export const useSessionView = pick('useSessionView', () => focusedView)
