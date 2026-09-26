import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import { SessionTagChip } from '@/app/chat/session-tag'
import { SessionAskDialog } from '@/app/chat/sidebar/session-ask-dialog'
import { SessionDeviceDialog } from '@/app/chat/sidebar/session-device-dialog'
import { openSession } from '@/app/open-session'
import {
  closeAllTreeTabs,
  closeOtherTreeTabs,
  closeTreeTabsToRight,
  reloadTreePane,
  treeTabCloseTargets
} from '@/components/pane-shell/tree/store'
import {
  type ActionItemSpec,
  ActionsContextMenu,
  ActionsMenu,
  type MenuKit,
  renderActionItem
} from '@/components/ui/actions-menu'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ColorSwatches } from '@/components/ui/color-swatches'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getMessagingPlatforms, type MessagingPlatformInfo, renameSession } from '@/hermes'
import { useI18n } from '@/i18n'
import { desktopGit } from '@/lib/desktop-git'
import { triggerHaptic } from '@/lib/haptics'
import { ArchiveOff } from '@/lib/icons'
import { isSubmitEnter } from '@/lib/ime'
import { PROFILE_SWATCHES } from '@/lib/profile-color'
import { exportSessionDeliverable } from '@/lib/session-deliverable'
import { exportSession } from '@/lib/session-export'
import { handoffTargets, runSessionHandoff } from '@/lib/session-handoff'
import { exportSessionMarkdown, sessionMarkdownText } from '@/lib/session-markdown'
import { useSessionSlice } from '@/lib/use-session-slice'
import { revealArtifactsRail } from '@/store/artifact-rail'
import { activeGateway } from '@/store/gateway'
import { notify, notifyError } from '@/store/notifications'
import { $projectTree, moveSessionToProject, projectIdForCwd, projectRootCwd } from '@/store/projects'
import {
  $activeSessionId,
  $connection,
  $selectedStoredSessionId,
  $sessions,
  $unreadFinishedSessionIds,
  markSessionRead,
  sessionMatchesStoredId,
  sessionPinId,
  setSessions
} from '@/store/session'
import { $sessionColorOverrides, setSessionColorOverride } from '@/store/session-color'
import { $mutedSessionIds, isSessionMuted, toggleSessionMuted } from '@/store/session-mute'
import { $sessionTiles, closeAllOpenSessionTiles } from '@/store/session-states'
import { $sessionTags, addSessionTag, removeSessionTag, sessionTagKey } from '@/store/session-tags'
import { ackStoredSessionId } from '@/store/session-unread'
import { $watchedSessionKeys, isWatchedSessionId, toggleSessionWatched } from '@/store/session-watch'
import {
  isolateSessionToWorktree,
  mergeSessionWorktree,
  sessionWorktreeInfo
} from '@/store/session-worktree'
import { canOpenSessionInTerminal, canOpenSessionWindow, openSessionInTerminal } from '@/store/windows'

import type { SessionTitleResponse } from '../../types'

// Rename a session, preferring the gateway's session.title RPC over REST.
//
// A freshly *branched* session (and any brand-new chat) lives only in the
// gateway's in-memory _sessions map keyed by its RUNTIME id — no row is
// persisted to state.db until the first turn. REST PATCH /api/sessions/{id}
// resolves against the stored sessions table, so it 404s ("Session not found")
// on these runtime-only sessions. The session.title RPC resolves the live
// runtime session AND persists the row on demand, so it succeeds where REST
// cannot. This mirrors the /title slash command's fix (use-prompt-actions.ts).
//
// We only take the RPC path for the ACTIVE/selected session: its runtime id is
// known ($activeSessionId) and it lives on the active gateway, so there is no
// profile-routing ambiguity. Every other row (already persisted, possibly on a
// background profile) keeps the REST path, which handles profile scoping and a
// non-empty title is required by the RPC (it rejects clears), so clears stay on
// REST too.
export async function renameSessionPreferringRpc(
  storedSessionId: string,
  title: string,
  profile?: string
): Promise<{ title?: string }> {
  const isActiveRow = storedSessionId === $selectedStoredSessionId.get()
  const runtimeId = isActiveRow ? $activeSessionId.get() : null
  const gateway = activeGateway()

  if (title && runtimeId && gateway) {
    try {
      const result = await gateway.request<SessionTitleResponse>('session.title', {
        session_id: runtimeId,
        title
      })

      return { title: result?.title ?? title }
    } catch (err) {
      // Fall through to REST — e.g. the socket is mid-reconnect. REST still
      // works for any session that already has a persisted row. Log so a
      // genuine RPC-side failure (which then surfaces a REST 404 for the
      // runtime id) is at least diagnosable instead of silently swallowed.
      console.warn('session.title RPC rename failed; falling back to REST', err)
    }
  }

  return renameSession(storedSessionId, title, profile)
}

interface SessionActions {
  sessionId: string
  title: string
  pinned?: boolean
  /** Backend-derived read state — drives the Mark as unread/read label. */
  unread?: boolean
  /** The row is already archived (the sidebar's Archived view): the shared
   *  archive verb becomes Unarchive and restores the session (#98813). */
  archived?: boolean
  profile?: string
  onPin?: () => void
  /** Toggle the persisted read-state watermark for this row. */
  onToggleUnread?: () => void
  onBranch?: () => void
  onArchive?: () => void
  onDelete?: () => void
  /** Close this surface (a tile tab) — omitted where nothing closes (sidebar
   *  rows, the main tab). */
  onClose?: () => void
  /** TAB surfaces: the session is already a tab, so "Open in new tab" is
   *  nonsense there — sidebar rows/dropdowns keep it. */
  surface?: 'row' | 'tab'
  /** The tab's layout-tree pane id (`session-tile:<id>` or `workspace`) — enables
   *  the Close-others / to-the-right / all tab verbs. Tab surfaces only. */
  tabPaneId?: string
  /** The MAIN tab's escape hatch: hide the zone's tab bar (it sticky-shows
   *  once a tab is ever gained; this is the explicit off switch). */
  onHideTabBar?: () => void
}

// The color picker inside the session menu's Appearance submenu. Its own
// component so only an OPEN submenu subscribes to the stores (not every row's
// menu). Reads/writes the override keyed by the DURABLE id so a color survives
// compression; clearing falls back to the inherited project color.
function SessionColorSwatches({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const overrides = useStore($sessionColorOverrides)
  const session = useStore($sessions).find(s => sessionMatchesStoredId(s, sessionId))
  const durableId = session ? sessionPinId(session) : sessionId

  return (
    <ColorSwatches
      clearIcon="circle-slash"
      clearLabel={t.sidebar.projects.noColor}
      onChange={color => setSessionColorOverride(durableId, color)}
      swatches={PROFILE_SWATCHES}
      value={overrides[durableId] ?? null}
    />
  )
}

// The project list inside the session menu's "Move to project" submenu. Its own
// component so only an OPEN submenu subscribes to the stores (same reasoning as
// SessionColorSwatches). Re-homes the session's workspace at the target
// project's root — the fix for a chat created in the wrong folder. The current
// owner and folderless projects (the Home bucket) are excluded: there is
// nothing to move into.
function MoveToProjectItems({ kit, sessionId, profile }: { kit: MenuKit; sessionId: string; profile?: string }) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const tree = useStore($projectTree)
  const session = useStore($sessions).find(s => sessionMatchesStoredId(s, sessionId))
  const cwd = session?.cwd?.trim() || ''
  const currentProjectId = cwd ? projectIdForCwd(cwd) : null
  const targets = tree.filter(node => node.id !== currentProjectId && !node.isNoProject && projectRootCwd(node))

  if (targets.length === 0) {
    return <kit.Item disabled>{p.moveNoProjects}</kit.Item>
  }

  return (
    <>
      {targets.map(node => (
        <kit.Item
          key={node.id}
          onSelect={() => {
            triggerHaptic('selection')
            moveSessionToProject(sessionId, node.id, profile)
              .then(() => notify({ durationMs: 2_000, kind: 'success', message: p.movedTo(node.label) }))
              .catch(err => notifyError(err, p.moveFailed))
          }}
        >
          {node.label}
        </kit.Item>
      ))}
    </>
  )
}

// #47 worktree-per-session: the ⋯ menu's isolate / merge-back verbs. Its own
// component so only an OPEN menu reads the sessions store (same reasoning as
// MoveToProjectItems). Which verb shows is derived from the row's stored
// cwd/git meta — a session parked under <repo>/.worktrees/ gets "merge back",
// any other session with a workspace gets the opt-in "isolate".
function SessionWorktreeItems({
  kit,
  onMerge,
  sessionId
}: {
  kit: MenuKit
  onMerge: (branch: string, repo: string) => void
  sessionId: string
}) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const session = useStore($sessions).find(s => sessionMatchesStoredId(s, sessionId))

  // No cwd → nothing to isolate; no git bridge (browser preview) → the verb
  // would only toast an error, so stay out of the menu entirely.
  if (!session?.cwd?.trim() || !desktopGit()) {
    return null
  }

  const worktree = sessionWorktreeInfo(session)

  if (worktree) {
    const branch = worktree.branch || worktree.worktreePath.split('/').pop() || ''
    const repo = worktree.repoRoot.split(/[\\/]/).pop() || worktree.repoRoot

    return (
      <kit.Item
        onSelect={() => {
          triggerHaptic('selection')
          onMerge(branch, repo)
        }}
      >
        <Codicon name="git-merge" size="0.875rem" />
        <span>{r.mergeWorktree}</span>
      </kit.Item>
    )
  }

  return (
    <kit.Item
      onSelect={() => {
        triggerHaptic('selection')
        isolateSessionToWorktree(sessionId)
          .then(branch => notify({ durationMs: 3_000, kind: 'success', message: r.isolateWorktreeDone(branch) }))
          .catch(err => notifyError(err, r.worktreeUnavailable))
      }}
    >
      <Codicon name="git-branch" size="0.875rem" />
      <span>{r.isolateWorktree}</span>
    </kit.Item>
  )
}

// The "Continue on phone" submenu — the per-session door to the platform
// parity links (#40). Its own component so only an OPEN submenu fetches the
// platform list. Only rendered for the row that IS the open session: the
// handoff RPC needs a live runtime id, and the only runtime id this window
// knows for sure is the active one.
function HandoffPlatformItems({ kit, profile }: { kit: MenuKit; profile?: string }) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const [platforms, setPlatforms] = useState< MessagingPlatformInfo[] | null>(null)

  useEffect(() => {
    let live = true

    void getMessagingPlatforms(profile)
      .then(result => {
        if (live) {
          setPlatforms(handoffTargets(result.platforms))
        }
      })
      .catch(() => {
        if (live) {
          setPlatforms([])
        }
      })

    return () => {
      live = false
    }
  }, [profile])

  if (platforms === null) {
    return <kit.Item disabled>{t.common.loading}</kit.Item>
  }

  if (platforms.length === 0) {
    return <kit.Item disabled>{r.handoffNone}</kit.Item>
  }

  return (
    <>
      {platforms.map(platform => (
        <kit.Item
          key={platform.id}
          onSelect={() => {
            triggerHaptic('selection')
            void runSessionHandoff(platform.id, {
              failed: error => t.desktop.handoff.failed(error),
              queued: (name, home) => t.desktop.handoff.queued(name, home),
              sessionUnavailable: t.desktop.handoff.sessionUnavailable,
              startMessaging: t.desktop.handoff.startMessaging,
              success: name => t.desktop.handoff.success(name),
              timedOut: t.desktop.handoff.timedOut
            })
          }}
        >
          {platform.identity?.label || platform.name}
        </kit.Item>
      ))}
    </>
  )
}

function useSessionActions({
  sessionId,
  title,
  pinned = false,
  unread = false,
  archived = false,
  profile,
  onPin,
  onToggleUnread,
  onBranch,
  onArchive,
  onDelete,
  onClose,
  onHideTabBar,
  surface = 'row',
  tabPaneId
}: SessionActions) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const [renameOpen, setRenameOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [deviceOpen, setDeviceOpen] = useState(false)
  // The rename item opens a Dialog. When a menu closes, Radix restores focus to
  // its trigger — for a sidebar row that trigger is the row's own <button>, so
  // focus lands there instead of the dialog's input: Space then activates the
  // row (selecting the session) and the arrow keys move the list rather than
  // the caret. Suppress that one restore so the dialog keeps focus; every other
  // action leaves the restore alone (it's the correct behavior for them). Mirrors
  // the project menu's appearance-popover guard.
  const suppressCloseFocusRef = useRef(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Merge-back confirm (#47): the branch/repo pair the item captured when it
  // was clicked — the dialog must not re-derive it from a row that may have
  // re-filed under new git meta mid-dialog.
  const [mergeWorktreeTarget, setMergeWorktreeTarget] = useState<null | { branch: string; repo: string }>(null)
  const tiles = useStore($sessionTiles)
  const selectedStoredSessionId = useStore($selectedStoredSessionId)
  const isRemote = useStore($connection)?.mode === 'remote'
  // The row's finished-unread dot is cleared by opening the session (main or
  // tile) — this menu item is the explicit escape hatch for the rest.
  const isUnread = useStore($unreadFinishedSessionIds).includes(sessionId)
  // Subscribe for freshness; the check itself resolves through lineage
  // aliases (the row passes session.id, the store keys on the durable pin id).
  const mutedSessionIds = useStore($mutedSessionIds)
  const isMuted = mutedSessionIds.length > 0 && isSessionMuted(sessionId)
  // Watched sessions render as live chips at the top of the rail — same
  // lineage-safe lookup as mute (the row id resolves to the durable pin id).
  const watchedSessionKeys = useStore($watchedSessionKeys)
  const isWatched = Object.keys(watchedSessionKeys).length > 0 && isWatchedSessionId(sessionId)

  // Already showing as a tab somewhere (a tile, or loaded in main — main IS
  // a tab): offering "Open in new tab" again is noise.
  const alreadyTabbed = sessionId === selectedStoredSessionId || tiles.some(tile => tile.storedSessionId === sessionId)

  const spec = (partial: Omit<ActionItemSpec, 'onSelect'> & { onSelect: () => void }): ActionItemSpec => partial

  // OPEN — where else this session can go. A tab surface IS a tab already,
  // so it only offers the window hop (and its own Close, below).
  const openItems: ActionItemSpec[] = [
    ...(surface === 'row' && !alreadyTabbed
      ? [
          spec({
            disabled: !sessionId,
            icon: 'browser',
            label: r.openInNewTab,
            onSelect: () => {
              triggerHaptic('selection')
              // Stack into the MAIN zone as a tab (center dock; the strip
              // sticky-shows on gain) — the door to the tab bar. Focuses first
              // if the session is already on screen.
              openSession(sessionId, () => undefined, 'tab')
            }
          })
        ]
      : []),
    ...(canOpenSessionWindow()
      ? [
          spec({
            disabled: !sessionId,
            icon: 'link-external',
            label: r.newWindow,
            onSelect: () => {
              triggerHaptic('selection')
              openSession(sessionId, () => undefined, 'window')
            }
          })
        ]
      : []),
    // The user's OWN terminal, not the in-app pane: resumes the session in the
    // TUI. Hidden on a remote connection — the emulator we'd open runs on this
    // machine while the session (and its runtime) lives on the remote host.
    ...(canOpenSessionInTerminal() && !isRemote
      ? [
          spec({
            disabled: !sessionId,
            icon: 'terminal',
            label: r.openInTerminal,
            onSelect: () => {
              triggerHaptic('selection')

              // Read the row lazily: subscribing every row's menu to $sessions
              // would re-render the whole sidebar on each session update.
              const cwd =
                $sessions
                  .get()
                  .find(s => sessionMatchesStoredId(s, sessionId))
                  ?.cwd?.trim() || undefined

              void openSessionInTerminal(sessionId, { cwd, profile })
            }
          })
        ]
      : []),
    // Cross-device handoff (#50): a hermes://session/open deep link + QR that
    // another Hermes device opens as a VIEW — the session's home never moves.
    spec({
      disabled: !sessionId,
      icon: 'device-desktop',
      label: r.openOnDevice,
      onSelect: () => {
        triggerHaptic('selection')
        // Same dialog-open focus dance as rename: the row's trigger must not
        // steal the focus back when the menu closes.
        suppressCloseFocusRef.current = true
        setDeviceOpen(true)
      }
    })
  ]

  // IDENTITY — name/mark/reference the session.
  const identityItems: ActionItemSpec[] = [
    spec({
      disabled: !sessionId,
      icon: 'edit',
      label: r.rename,
      onSelect: () => {
        triggerHaptic('selection')
        // Keep focus off the row trigger so it lands in the dialog input.
        suppressCloseFocusRef.current = true
        setRenameOpen(true)
      }
    }),
    spec({
      disabled: !sessionId,
      icon: 'tag',
      label: r.tags,
      onSelect: () => {
        triggerHaptic('selection')
        suppressCloseFocusRef.current = true
        setTagsOpen(true)
      }
    }),
    spec({
      disabled: !onPin,
      icon: 'pin',
      label: pinned ? r.unpin : r.pin,
      onSelect: () => {
        triggerHaptic('selection')
        onPin?.()
      }
    }),
    // One read-state item, driven by BOTH unread sources: the transient
    // finished-unread dot (isUnread) and the backend watermark (unread).
    // "Mark as read" clears whichever is lit; "Mark as unread" arms the
    // persisted watermark so the dot survives restarts.
    spec({
      disabled: !sessionId || (!onToggleUnread && !isUnread),
      // Closed envelope = unread, open envelope = read (codicon has mail and
      // mail-read, but no mail-unread glyph — verified against the font css).
      icon: unread || isUnread ? 'mail-read' : 'mail',
      label: unread || isUnread ? r.markRead : r.markUnread,
      onSelect: () => {
        triggerHaptic('selection')

        if (unread || isUnread) {
          // Clear the transient family dot immediately (and ack the persisted
          // watermark/marker so a list refresh doesn't repaint it)…
          markSessionRead(sessionId)
          ackStoredSessionId(sessionId)

          // …and retire the persisted watermark when the row carries one.
          if (unread) {
            onToggleUnread?.()
          }
        } else {
          onToggleUnread?.()
        }
      }
    }),
    // Mute silences the session's toasts + OS notifications (turnDone,
    // backgroundDone, compress notices); the in-app record keeps them.
    spec({
      disabled: !sessionId,
      icon: isMuted ? 'bell' : 'bell-slash',
      label: isMuted ? r.unmuteNotifications : r.muteNotifications,
      onSelect: () => {
        triggerHaptic('selection')
        toggleSessionMuted(sessionId)
      }
    }),
    // Watch pins a live status chip to the top of the Sessions rail — the
    // quiet "keep an eye on it" counterpart to mute's "leave me alone".
    spec({
      disabled: !sessionId,
      icon: isWatched ? 'eye-closed' : 'eye',
      label: isWatched ? r.stopWatching : r.watch,
      onSelect: () => {
        triggerHaptic('selection')
        toggleSessionWatched(sessionId)
      }
    })
  ]

  // WORK — derive/extract from the session.
  const workItems: ActionItemSpec[] = [
    // Companion thread (#44): "ask about this session" answers from the stored
    // transcript in a side dialog — the live conversation is never touched.
    spec({
      disabled: !sessionId,
      icon: 'comment-discussion',
      label: r.askAbout,
      onSelect: () => {
        triggerHaptic('selection')
        suppressCloseFocusRef.current = true
        setAskOpen(true)
      }
    }),
    spec({
      disabled: !onBranch,
      // Fork glyph to match the inline message action's GitFork icon
      // (assistant-message.tsx). NB: this codicon font has no `git-fork`
      // glyph (only `git-fork-private`); `repo-forked` is the fork icon.
      icon: 'repo-forked',
      label: r.branchFrom,
      onSelect: () => {
        triggerHaptic('selection')
        onBranch?.()
      }
    }),
    spec({
      disabled: !sessionId,
      icon: 'cloud-download',
      label: r.export,
      onSelect: () => {
        triggerHaptic('selection')
        void exportSession(sessionId, { profile, title })
      }
    }),
    spec({
      disabled: !sessionId,
      icon: 'markdown',
      label: r.exportMarkdown,
      onSelect: () => {
        triggerHaptic('selection')
        void exportSessionMarkdown(sessionId, { profile, title })
      }
    }),
    // Per-session artifact rail (#32): open the chat (focus it if it's already
    // on screen), then front the rail — it follows the focused session.
    spec({
      disabled: !sessionId,
      icon: 'package',
      label: r.artifacts,
      onSelect: () => {
        triggerHaptic('selection')
        openSession(sessionId, () => undefined, 'in-place')
        revealArtifactsRail()
      }
    }),
    // One-file shareable outcome report (#35): summary + diff stat + artifacts
    // + PR link — a deliverable, not the raw transcript exports above.
    spec({
      disabled: !sessionId,
      icon: 'export',
      label: r.exportDeliverable,
      onSelect: () => {
        triggerHaptic('selection')
        void exportSessionDeliverable(sessionId, { profile, title })
      }
    })
  ]

  // TAB — verbs that act on the strip (tabs only; a row isn't a tab).
  const closeTargets = surface === 'tab' && tabPaneId ? treeTabCloseTargets(tabPaneId) : null

  const tabItems: ActionItemSpec[] =
    surface === 'tab'
      ? [
          ...(tabPaneId
            ? [
                spec({
                  icon: 'refresh',
                  label: t.zones.reload,
                  onSelect: () => {
                    triggerHaptic('selection')
                    reloadTreePane(tabPaneId)
                  }
                })
              ]
            : []),
          ...(onClose
            ? [
                spec({
                  disabled: false,
                  icon: 'close',
                  label: t.common.close,
                  onSelect: () => {
                    triggerHaptic('selection')
                    onClose()
                  }
                })
              ]
            : []),
          ...(tabPaneId
            ? [
                spec({
                  disabled: !closeTargets?.others,
                  icon: 'close-all',
                  label: t.zones.closeOthers,
                  onSelect: () => {
                    triggerHaptic('selection')
                    closeOtherTreeTabs(tabPaneId)
                  }
                }),
                spec({
                  disabled: !closeTargets?.right,
                  icon: 'arrow-right',
                  label: t.zones.closeToRight,
                  onSelect: () => {
                    triggerHaptic('selection')
                    closeTreeTabsToRight(tabPaneId)
                  }
                }),
                spec({
                  disabled: !closeTargets?.all,
                  icon: 'clear-all',
                  label: t.zones.closeAll,
                  onSelect: () => {
                    triggerHaptic('selection')
                    // Persist-close session tiles before dismissing the
                    // remaining tree panes, or Bot Mode rehydrates them
                    // from the shared tile bucket (#94137).
                    closeAllOpenSessionTiles(tabPaneId)
                    closeAllTreeTabs(tabPaneId)
                  }
                })
              ]
            : [])
        ]
      : []

  // DANGER — put it away / destroy it (delete stays last, destructive-red).
  const dangerItems: ActionItemSpec[] = [
    spec({
      disabled: !onArchive,
      // Already archived (the Archived view): the same verb restores the row
      // instead of re-archiving it (#98813). The wiring dispatches the shared
      // onArchive callback to the restore path based on the row's state. No
      // unarchive codicon exists, so the restore item carries the ArchiveOff
      // glyph the Settings → Archived Chats restore button already uses.
      icon: archived ? undefined : 'archive',
      iconNode: archived ? <ArchiveOff className="size-3.5" /> : undefined,
      label: archived ? r.unarchive : r.archive,
      onSelect: () => {
        triggerHaptic('selection')
        onArchive?.()
      }
    }),
    {
      className: 'text-destructive focus:text-destructive',
      disabled: !onDelete,
      icon: 'trash',
      label: t.common.delete,
      onSelect: () => {
        triggerHaptic('warning')

        // Deleting is irreversible (the CLI path asks y/N; the desktop used to
        // fire instantly on click). Gate it behind an explicit confirm — see
        // #61470. The dialog owns the delete call, so every surface that routes
        // through this menu (sidebar rows, tab menus, the chat header) gets the
        // guard for free.
        if (onDelete) {
          setDeleteOpen(true)
        }
      },
      variant: 'destructive'
    }
  ]

  const renderItems = (kit: MenuKit) => (
    <>
      {openItems.map(item => renderActionItem(kit, item))}
      {openItems.length > 0 && <kit.Separator />}
      {identityItems.map(item => renderActionItem(kit, item))}
      <kit.Sub>
        <kit.SubTrigger disabled={!sessionId}>
          <Codicon name="symbol-color" size="0.875rem" />
          <span>{t.sidebar.projects.menuAppearance}</span>
        </kit.SubTrigger>
        <kit.SubContent className="p-2">
          <SessionColorSwatches sessionId={sessionId} />
        </kit.SubContent>
      </kit.Sub>
      <CopyButton
        appearance={kit.copyAppearance}
        disabled={!sessionId}
        errorMessage={r.copyIdFailed}
        iconClassName="size-3.5 text-current"
        key={r.copyId}
        label={r.copyId}
        onCopyError={err => notifyError(err, r.copyIdFailed)}
        text={sessionId}
      />
      <kit.Separator />
      {workItems.map(item => renderActionItem(kit, item))}
      <CopyButton
        appearance={kit.copyAppearance}
        disabled={!sessionId}
        iconClassName="size-3.5 text-current"
        key={r.copyMarkdown}
        label={r.copyMarkdown}
        onCopyError={err => notifyError(err, t.common.copyFailed)}
        text={async () => sessionMarkdownText(sessionId, { profile, title })}
      />
      <kit.Sub>
        <kit.SubTrigger disabled={!sessionId}>
          <Codicon name="folder" size="0.875rem" />
          <span>{t.sidebar.projects.moveToProject}</span>
        </kit.SubTrigger>
        <kit.SubContent>
          <MoveToProjectItems kit={kit} profile={profile} sessionId={sessionId} />
        </kit.SubContent>
      </kit.Sub>
      <SessionWorktreeItems
        kit={kit}
        onMerge={(branch, repo) => setMergeWorktreeTarget({ branch, repo })}
        sessionId={sessionId}
      />
      {/* Only the open session has a runtime id this window can hand off. */}
      {sessionId === selectedStoredSessionId && (
        <kit.Sub>
          <kit.SubTrigger disabled={!sessionId}>
            <Codicon name="device-mobile" size="0.875rem" />
            <span>{r.continueOnPhone}</span>
          </kit.SubTrigger>
          <kit.SubContent>
            <HandoffPlatformItems kit={kit} profile={profile} />
          </kit.SubContent>
        </kit.Sub>
      )}
      {tabItems.length > 0 && (
        <>
          <kit.Separator />
          {tabItems.map(item => renderActionItem(kit, item))}
        </>
      )}
      <kit.Separator />
      {dangerItems.map(item => renderActionItem(kit, item))}
      {onHideTabBar && (
        <>
          <kit.Separator />
          {renderActionItem(kit, {
            disabled: false,
            icon: 'eye-closed',
            label: r.hideTabBar,
            onSelect: () => {
              triggerHaptic('selection')
              onHideTabBar()
            }
          })}
        </>
      )}
    </>
  )

  const renameDialog = (
    <RenameSessionDialog
      currentTitle={title}
      onOpenChange={setRenameOpen}
      open={renameOpen}
      profile={profile}
      sessionId={sessionId}
    />
  )

  // Consumed once per close: when rename was the action that closed the menu,
  // block Radix's focus-restore to the trigger so the dialog input keeps focus.
  const onCloseAutoFocus = (event: Event) => {
    if (suppressCloseFocusRef.current) {
      suppressCloseFocusRef.current = false
      event.preventDefault()
    }
  }

  const deleteDialog = (
    <DeleteSessionDialog
      onConfirm={() => {
        onDelete?.()
      }}
      onOpenChange={setDeleteOpen}
      open={deleteOpen}
      sessionTitle={title}
    />
  )

  const mergeWorktreeDialog = mergeWorktreeTarget && (
    <MergeWorktreeDialog
      branch={mergeWorktreeTarget.branch}
      onConfirm={async () => {
        const into = await mergeSessionWorktree(sessionId)
        notify({ durationMs: 3_000, kind: 'success', message: r.mergedWorktree(into) })
      }}
      onOpenChange={open => {
        if (!open) {
          setMergeWorktreeTarget(null)
        }
      }}
      open
      repo={mergeWorktreeTarget.repo}
    />
  )

  const tagsDialog = (
    <SessionTagsDialog onOpenChange={setTagsOpen} open={tagsOpen} profile={profile} sessionId={sessionId} />
  )

  const askDialog = (
    <SessionAskDialog
      onOpenChange={setAskOpen}
      open={askOpen}
      profile={profile}
      sessionId={sessionId}
      title={title}
    />
  )

  const deviceDialog = <SessionDeviceDialog onOpenChange={setDeviceOpen} open={deviceOpen} sessionId={sessionId} title={title} />

  return { askDialog, deleteDialog, deviceDialog, mergeWorktreeDialog, onCloseAutoFocus, renameDialog, renderItems, tagsDialog }
}

interface MergeWorktreeDialogProps {
  branch: string
  onConfirm: () => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  repo: string
}

// Confirm before folding a worktree branch into the repo's main checkout —
// a merge writes merge commits and can leave the main tree in conflict state,
// so the row chip's affordance asks once (same guard shape as delete).
function MergeWorktreeDialog({ branch, onConfirm, onOpenChange, open, repo }: MergeWorktreeDialogProps) {
  const { t } = useI18n()
  const r = t.sidebar.row

  return (
    <ConfirmDialog
      busyLabel={r.mergingWorktree}
      confirmLabel={r.mergeWorktree}
      description={r.mergeWorktreeDesc(branch, repo)}
      onClose={() => onOpenChange(false)}
      onConfirm={onConfirm}
      open={open}
      title={r.mergeWorktreeTitle}
    />
  )
}

interface DeleteSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  sessionTitle: string
}

// Thin wrapper over ConfirmDialog — the single choke point for every session
// delete entry point (sidebar rows, tab menus, the chat header). Deleting a
// session is irreversible and the desktop used to fire it instantly on click
// (#61470); this mirrors the CLI's y/N guard. onConfirm is the fire-and-forget
// delete call; ConfirmDialog owns the busy/done beat and Enter-to-confirm.
function DeleteSessionDialog({ open, onOpenChange, onConfirm, sessionTitle }: DeleteSessionDialogProps) {
  const { t } = useI18n()
  const r = t.sidebar.row

  return (
    <ConfirmDialog
      busyLabel={r.deleting}
      confirmLabel={t.common.delete}
      description={r.deleteDesc(sessionTitle)}
      destructive
      doneLabel={r.deleted}
      onClose={() => onOpenChange(false)}
      onConfirm={onConfirm}
      open={open}
      title={r.deleteTitle}
    />
  )
}

interface SessionActionsMenuProps
  extends SessionActions, Pick<React.ComponentProps<typeof ActionsMenu>, 'align' | 'sideOffset'> {
  children: React.ReactNode
}

export function SessionActionsMenu({ children, align = 'end', sideOffset = 6, ...actions }: SessionActionsMenuProps) {
  const { t } = useI18n()

  const { askDialog, deleteDialog, deviceDialog, mergeWorktreeDialog, onCloseAutoFocus, renameDialog, renderItems, tagsDialog } =
    useSessionActions(actions)

  return (
    <>
      <ActionsMenu
        align={align}
        ariaLabel={t.sidebar.row.sessionActions}
        contentClassName="w-40"
        items={renderItems}
        onCloseAutoFocus={onCloseAutoFocus}
        sideOffset={sideOffset}
      >
        {children}
      </ActionsMenu>
      {renameDialog}
      {tagsDialog}
      {askDialog}
      {deviceDialog}
      {deleteDialog}
      {mergeWorktreeDialog}
    </>
  )
}

interface SessionContextMenuProps extends SessionActions {
  children: React.ReactNode
}

export function SessionContextMenu({ children, ...actions }: SessionContextMenuProps) {
  const { t } = useI18n()

  const { askDialog, deleteDialog, deviceDialog, mergeWorktreeDialog, onCloseAutoFocus, renameDialog, renderItems, tagsDialog } =
    useSessionActions(actions)

  return (
    <>
      <ActionsContextMenu
        ariaLabel={t.sidebar.row.sessionActions}
        contentClassName="w-40"
        items={renderItems}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {children}
      </ActionsContextMenu>
      {renameDialog}
      {tagsDialog}
      {askDialog}
      {deviceDialog}
      {deleteDialog}
      {mergeWorktreeDialog}
    </>
  )
}

interface RenameSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  currentTitle: string
  profile?: string
}

function RenameSessionDialog({ open, onOpenChange, sessionId, currentTitle, profile }: RenameSessionDialogProps) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const [value, setValue] = useState(currentTitle)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(currentTitle)
      window.setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [currentTitle, open])

  const submit = async () => {
    const next = value.trim()

    if (!sessionId || submitting) {
      return
    }

    if (next === currentTitle.trim()) {
      onOpenChange(false)

      return
    }

    setSubmitting(true)

    try {
      const result = await renameSessionPreferringRpc(sessionId, next, profile)
      const finalTitle = result.title || next || ''
      setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title: finalTitle || null } : s)))
      notify({ durationMs: 2_000, kind: 'success', message: r.renamed })
      onOpenChange(false)
    } catch (err) {
      notifyError(err, r.renameFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{r.renameTitle}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          disabled={submitting}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (isSubmitEnter(event)) {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              onOpenChange(false)
            }
          }}
          placeholder={r.untitledPlaceholder}
          ref={inputRef}
          value={value}
        />
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={submitting} onClick={() => void submit()} type="button">
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface SessionTagsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  profile?: string
}

// The tag editor behind the menu's Tags item — the desktop's Linear-labels
// analogue. Add/remove mutate the store immediately (there is nothing to
// submit), so the dialog only closes on Done/Escape. Tags key on the durable
// lineage id under the row's owning profile, so they ride out compression and
// stay inside their island; deleting the session leaves an orphaned entry the
// next delete sweep or profile migration drops.
function SessionTagsDialog({ open, onOpenChange, sessionId, profile }: SessionTagsDialogProps) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const session = useStore($sessions).find(s => sessionMatchesStoredId(s, sessionId))
  const durableId = session ? sessionPinId(session) : sessionId
  const ownerProfile = session?.profile ?? profile
  const tags = useSessionSlice($sessionTags, sessionTagKey(ownerProfile, durableId))
  const [label, setLabel] = useState('')
  const [color, setColor] = useState<null | string>(PROFILE_SWATCHES[0] ?? null)

  useEffect(() => {
    if (open) {
      setLabel('')
      setColor(PROFILE_SWATCHES[0] ?? null)
    }
  }, [open])

  const add = () => {
    const trimmed = label.trim()

    if (!trimmed || !color || !durableId) {
      return
    }

    addSessionTag(ownerProfile, durableId, { color, label: trimmed })
    setLabel('')
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{r.tagsDialogTitle}</DialogTitle>
          <DialogDescription>{r.tagsDialogDesc}</DialogDescription>
        </DialogHeader>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map(tag => (
              <span
                className="inline-flex items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-0.5"
                key={tag.label}
              >
                <SessionTagChip tag={tag} />
                <button
                  aria-label={r.tagsRemoveLabel(tag.label)}
                  className="grid size-3.5 place-items-center rounded-full text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
                  onClick={() => removeSessionTag(ownerProfile, durableId, tag.label)}
                  type="button"
                >
                  <Codicon name="close" size="0.625rem" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <ColorSwatches
              clearLabel={t.sidebar.projects.noColor}
              onChange={setColor}
              swatches={PROFILE_SWATCHES}
              value={color}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            autoFocus
            onChange={event => setLabel(event.target.value)}
            onKeyDown={event => {
              if (isSubmitEnter(event)) {
                event.preventDefault()
                add()
              } else if (event.key === 'Escape') {
                onOpenChange(false)
              }
            }}
            placeholder={r.tagsAddPlaceholder}
            value={label}
          />
          <Button disabled={!label.trim() || !color} onClick={add} type="button">
            {r.tagsAdd}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
