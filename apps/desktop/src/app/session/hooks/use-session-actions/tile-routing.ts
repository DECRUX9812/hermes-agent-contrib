import { useCallback } from 'react'

import { defaultNewSessionTarget } from '@/app/session/new-session-route'
import { useI18n } from '@/i18n'
import { requestGatewayForAgent, retainGatewayForAgent } from '@/store/gateway'
import { notify, notifyError } from '@/store/notifications'
import {
  $activeGatewayProfile,
  $newChatProfile,
  $profiles,
  type AgentProfileRoute,
  normalizeProfileKey,
  resolveActiveSourceOwnerRoute,
  resolveNewChatOwnerRoute
} from '@/store/profile'
import { projectProfile, resolveNewSessionCwd } from '@/store/projects'
import {
  $connection,
  setCurrentCwdExplicit,
  setCurrentCwdTransient,
  setSessionOwnerHint,
  setWorkspaceCwdOwner
} from '@/store/session'
import {
  focusOpenSession,
  holdSessionOwnerUntilForeground,
  openSessionTile,
  patchSessionTile,
  type SessionTileWorkspaceScope,
  type TileDock
} from '@/store/session-states'
import { broadcastSessionsChanged } from '@/store/session-sync'
import type { SessionCreateResponse } from '@/types/hermes'

import { createdThisRun, desktopSessionCreateParams } from './create'
import type { SessionActionsOptions } from './options'
import { applyRuntimeInfo, upsertOptimisticSession, upsertUnlistedSessionOwner } from './utils'

export function useTileRoutingActions({ requestGateway, updateSessionState }: SessionActionsOptions) {
  const { t } = useI18n()
  const copy = t.desktop

  /** Create a fresh session and open it as a tile — leaves the primary chat alone.
   *  Used by the New session row's "Open in split" menu and the tab-strip "+".
   *
   *  `listed` (default true) controls sidebar visibility. A brand-new backend
   *  session is IN-MEMORY only until its first turn persists a row, so
   *  `listSessions(min_messages=1)` already hides an unused one — the sidebar
   *  pollution comes solely from the optimistic upsert here. The tab-strip "+"
   *  passes `listed: false` so an unused new tab never clutters the session
   *  list (Cursor-style draft tab); it surfaces on the next refresh once the
   *  first message persists a turn. "Open in split" keeps the listed behavior. */
  const openNewSessionTile = useCallback(
    async (
      dir: TileDock = 'right',
      options?: {
        anchor?: string
        before?: null | string
        cwd?: null | string
        listed?: boolean
        profile?: string
        route?: AgentProfileRoute | null
        workspaceScope?: SessionTileWorkspaceScope
      }
      // The created ids so a caller (parallel fan-out) can drive the fresh
      // session itself — e.g. submit the shared prompt into each new tile.
    ): Promise<{ runtimeId: string; storedSessionId: string } | undefined> => {
      const listed = options?.listed ?? true

      try {
        // A tile anchored at a project path belongs to the profile the project
        // tree is rendered under — the same owner the fresh-draft "+" pins
        // (#79005). The occupied-chat "+" and project-row drags reach this
        // path instead, where a stale $newChatProfile pin would otherwise win
        // and land the session in the wrong profile (#124265). All-profiles
        // view has no owner and keeps the ordinary fallback.
        const projectOwnerProfile =
          options?.profile === undefined && typeof options?.cwd === 'string'
            ? (projectProfile() ?? undefined)
            : undefined

        const optionProfile = options?.profile ?? projectOwnerProfile

        // Fresh tile → the caller's workspace when one was named (the sidebar
        // "+" on a project/worktree lane), explicit null means Home/detached,
        // else the resolved new-session cwd (project scope → configured default).
        // `options?.cwd || resolve…` is wrong for Home: null is falsy and used
        // to fall through into the last project folder while main chat was
        // occupied (openTab path for "New session in Home").
        const explicitTarget =
          optionProfile !== undefined || options?.cwd !== undefined || options?.workspaceScope?.ownerRoute !== undefined

        const defaultTarget = options?.route === undefined && !explicitTarget ? defaultNewSessionTarget() : null

        // The project tree is rendered by the ACTIVE source: its profile pairs
        // with that source, never with the source a stale new-chat pin captured
        // on another connection (right profile, wrong host).
        const capturedRoute =
          options?.route !== undefined
            ? options.route
            : (options?.workspaceScope?.ownerRoute ??
              (defaultTarget
                ? defaultTarget.route
                : projectOwnerProfile
                  ? resolveActiveSourceOwnerRoute(projectOwnerProfile)
                  : resolveNewChatOwnerRoute(optionProfile)))

        // A named local profile uses the legacy profile-only transport (no
        // connectionId). Tab-strip "+" omits `options.profile`; the draft or
        // active profile is still the owner. Unique non-default local roster
        // names stay authoritative; default/remote/duplicate stay unresolved.
        const requestedProfile = normalizeProfileKey(
          optionProfile || defaultTarget?.profile || $newChatProfile.get() || $activeGatewayProfile.get()
        )

        const legacyOwnerProfile =
          options?.route === undefined &&
          !capturedRoute &&
          requestedProfile !== null &&
          requestedProfile !== 'default' &&
          $connection.get()?.mode !== 'remote' &&
          $profiles.get().filter(profile => normalizeProfileKey(profile.name) === requestedProfile).length === 1
            ? requestedProfile
            : undefined

        const workspaceScope: SessionTileWorkspaceScope = {
          ...(options?.workspaceScope ?? { workspaceMode: 'sessions' }),
          ...(legacyOwnerProfile ? { ownerProfile: legacyOwnerProfile } : {})
        }

        const cwd =
          options?.cwd === null ? '' : typeof options?.cwd === 'string' ? options.cwd.trim() : resolveNewSessionCwd()

        // #52589 provenance for the tile path: an explicitly-passed cwd is a
        // deliberate workspace pick; a resolved default is inherited.
        setCurrentCwdExplicit(typeof options?.cwd === 'string')

        // Bot-workspace tabs target an agent profile without switching the
        // window's ambient composer. Do not leak that unrelated session's
        // composer selection (manual model/provider, reasoning effort, fast
        // flag) into the bot's chat; omitting them lets the selected profile
        // supply its configured defaults. Ordinary Sessions tiles keep the
        // sticky composer override.
        //
        // No `hidden` here, in either mode. Only Bot Mode's PLUMBING sessions
        // are born hidden, and each mints its own row: the canonical Bot Chat
        // (`hermes-bots/canonical-chat.ts`) and group member sessions
        // (`hermes-bots/group-turns.ts`). Every session this path creates is a
        // side chat the user asked for by hand — "New chat with this bot" and
        // the Bot Mode tab-strip "+" / ⌘T — so it is an ordinary conversation
        // in the bot's profile and stays listed, exactly as
        // `apps/desktop/src/AGENTS.md` and the hide sweep's title allow-list
        // (`hermes-bots/session-sweep.ts`) already promise. Blanket-hiding the
        // mode stranded them: unlisted in the Sessions sidebar, skipped by
        // `/resume`, and reachable only while their tab stayed open, since the
        // bot row opens the canonical chat and "Open recent session" reads
        // `last_session`, which never reports a hidden row.
        const params = await desktopSessionCreateParams(
          cwd,
          capturedRoute,
          requestedProfile,
          options?.route === null || defaultTarget?.route === null,
          workspaceScope.workspaceMode !== 'bots'
        )

        // Bots-workspace mints are bot topics: mark the session once at create so
        // the gateway keeps it bot-powered (message_agent, update_task, teammate
        // protocol) for its whole life. Only this path mints them — the canonical
        // Bot Chat and plain chats on a bot profile are created elsewhere and
        // carry no marker.
        if (workspaceScope.workspaceMode === 'bots') {
          Object.assign(params, { bot_topic: true })
        }

        // Same lease chain as createBackendSessionForSend: owner socket held
        // across the create, then the foreground hold carries it until the
        // tile is mounted ($sessionTiles names the owner from then on). Same
        // 'foreground' spawn priority too: "New session" / tab-strip "+" is a
        // direct user click, not background hydration.
        const releaseCreateLease = capturedRoute
          ? await retainGatewayForAgent(capturedRoute.connectionId, capturedRoute.profile, {
              spawnPriority: 'foreground'
            })
          : () => undefined

        let created: SessionCreateResponse
        let stored: string | undefined

        try {
          created = capturedRoute
            ? await requestGatewayForAgent<SessionCreateResponse>(
                capturedRoute.connectionId,
                capturedRoute.profile,
                'session.create',
                params,
                undefined,
                undefined,
                { spawnPriority: 'foreground' }
              )
            : await requestGateway<SessionCreateResponse>('session.create', params)

          stored = created.stored_session_id

          if (stored && capturedRoute) {
            // Same ownership transition as createBackendSessionForSend: the
            // route that minted the session is its exact owner from this
            // moment on, and its socket stays pinned until the tile mounts.
            setSessionOwnerHint(stored, capturedRoute)
            holdSessionOwnerUntilForeground(stored, capturedRoute)
          } else if (stored && legacyOwnerProfile) {
            // The tile below persists this bare owner as the stored-id hint;
            // bridge the create-to-mount gap with the same profile pool.
            holdSessionOwnerUntilForeground(stored, legacyOwnerProfile)
          }
        } finally {
          releaseCreateLease()
        }

        if (!stored) {
          const closeCreated = capturedRoute
            ? requestGatewayForAgent(capturedRoute.connectionId, capturedRoute.profile, 'session.close', {
                session_id: created.session_id
              })
            : requestGateway('session.close', { session_id: created.session_id })

          await closeCreated.catch(() => undefined)
          notify({ kind: 'error', title: copy.sessionUnavailable, message: copy.createSessionFailed })

          return
        }

        createdThisRun.add(stored)

        // Seed the per-runtime cache so the tile renders immediately without a
        // redundant resume. Only add the row to the SIDEBAR when `listed` — an
        // unlisted (draft) tab stays out of the session list until its first
        // turn persists and a refresh surfaces it. An unlisted draft still
        // records an ownership stub (same stamps, off-list atom): without it a
        // draft minted on the legacy ambient route (null route) owns NOTHING
        // the ladder reads — no tile route, no hint, no row — and its
        // immediate session.resume fails closed on multi-profile installs
        // (#102792).
        if (listed) {
          upsertOptimisticSession(created, stored, null, null, null, undefined, capturedRoute)
        } else {
          upsertUnlistedSessionOwner(created, stored, capturedRoute)
        }

        // A tile lives in its OWN worktree, so it must not run the full
        // foreground composer publish. A CENTER tile is the focused surface,
        // though, and the Files pane still keys off the global `$currentCwd` —
        // so the right rail kept showing the previous session's tree when a
        // Project "+" created a session while the main chat was occupied
        // (#76696). Split/side tiles deliberately stay isolated.
        const runtimeInfo = applyRuntimeInfo(created.info, { foreground: false })
        updateSessionState(created.session_id, state => (runtimeInfo ? { ...state, ...runtimeInfo } : state), stored)

        openSessionTile(stored, dir, options?.anchor, options?.before, workspaceScope)
        patchSessionTile(stored, { runtimeId: created.session_id })

        const createdIds = { runtimeId: created.session_id, storedSessionId: stored }

        if (dir === 'center' && runtimeInfo?.cwd) {
          setCurrentCwdTransient(runtimeInfo.cwd)
          setWorkspaceCwdOwner(stored)
        }

        focusOpenSession(stored, workspaceScope)

        if (listed) {
          broadcastSessionsChanged()
        }

        return createdIds
      } catch (error) {
        notifyError(error, copy.createSessionFailed)
      }
    },
    [copy, requestGateway, updateSessionState]
  )

  return {
    openNewSessionTile
  }
}
