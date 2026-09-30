import type { MutableRefObject } from 'react'
import type { NavigateFunction } from 'react-router'

import type { AgentProfileRoute } from '@/store/profile'
import type { NewChatWorkspaceTarget } from '@/store/session'
import type { SessionOwnerRoute, SessionProfileRoute } from '@/store/session-request-router'
import type { SessionTileWorkspaceScope, TileDock } from '@/store/session-states'

import type { ClientSessionState, SidebarNavItem } from '../../../types'

import type { SessionCreateOverrides, SessionSeedMessage } from './create-overrides'
import type { BranchMessage } from './utils'

export interface SessionActionsOptions {
  activeSessionId: string | null
  activeSessionIdRef: MutableRefObject<string | null>
  busyRef: MutableRefObject<boolean>
  creatingSessionRef: MutableRefObject<boolean>
  ensureSessionState: (sessionId: string, storedSessionId?: string | null) => ClientSessionState
  getRouteToken: () => string
  getRoutedStoredSessionId: () => null | string
  holdSessionTranscriptView?: (runtimeId: string) => () => void
  navigate: NavigateFunction
  onFreshDraftRouteIntent?: () => void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  resetViewSync: () => void
  runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>>
  selectedStoredSessionId: string | null
  selectedStoredSessionIdRef: MutableRefObject<string | null>
  sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>>
  syncSessionStateToView: (sessionId: string, state: ClientSessionState) => void
  updateSessionState: (
    sessionId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    storedSessionId?: string | null
  ) => ClientSessionState
}

export interface FreshSessionDraftOptions {
  preserveRoute?: boolean
  replaceRoute?: boolean
  rotateFreshDraftKey?: boolean
  workspaceTarget?: NewChatWorkspaceTarget
}

export interface OpenSessionTileOptions {
  anchor?: string
  before?: null | string
  cwd?: null | string
  listed?: boolean
  profile?: string
  route?: AgentProfileRoute | null
  workspaceScope?: SessionTileWorkspaceScope
}

/**
 * The actions the domain sub-hooks hand each other. Keeping one type here
 * (instead of ReturnType chains between sibling files) is what lets the
 * create → tile/open/resume/gone/archive/fork layering stay acyclic.
 */
export interface SessionActionHandles {
  startFreshSessionDraft: (options?: boolean | FreshSessionDraftOptions) => void
  createBackendSessionForSend: (
    preview?: string | null,
    seedMessages?: SessionSeedMessage[],
    createOverrides?: SessionCreateOverrides
  ) => Promise<string | null>
  openNewSessionTile: (
    dir?: TileDock,
    options?: OpenSessionTileOptions
  ) => Promise<{ runtimeId: string; storedSessionId: string } | undefined>
  resumeSession: (
    storedSessionId: string,
    replaceRoute?: boolean,
    capturedOwner?: SessionProfileRoute
  ) => Promise<unknown>
  removeSession: (storedSessionId: string) => Promise<unknown>
  archiveSession: (storedSessionId: string) => Promise<unknown>
  unarchiveSession: (storedSessionId: string) => Promise<unknown>
  selectSidebarItem: (item: SidebarNavItem) => void
  openSettings: () => void
  closeSettings: () => void
  forkBranch: (
    branchMessages: BranchMessage[],
    sourceSessionId: null | string,
    parentStoredId: null | string,
    cwd?: string,
    profile?: null | string,
    branchCount?: number,
    ownerRoute?: SessionOwnerRoute
  ) => Promise<boolean>
  branchCurrentSession: (messageId?: string) => Promise<boolean>
  branchStoredSession: (storedSessionId: string, sessionProfile?: string | null) => Promise<boolean>
}
