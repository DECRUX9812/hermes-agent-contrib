import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router'

import { OverlayView } from '@/app/overlays/overlay-view'
import { NEW_CHAT_ROUTE } from '@/app/routes'
import { setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { EmptyState } from '@/components/ui/empty-state'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { $newChatProfile } from '@/store/profile'
import { $selectedStoredSessionId, $sessions, $unreadFinishedSessionIds } from '@/store/session'
import { $sessionDotStateById } from '@/store/session-dot-state'
import { SESSION_LIVE_GROUPS, type SessionLiveGroup } from '@/store/session-live'
import { $sessionTiles, $workingSessionIds } from '@/store/session-states'
import { $attentionSessionIds } from '@/store/session-states-live'

import { collectOverviewCards } from './collector'
import { OverviewCard } from './overview-card'

export interface MissionControlViewProps {
  onClose: () => void
  /** Opens a stored session id (the wiring hands in `openSession`). */
  onOpenSession: (storedSessionId: string) => void
  /** Optional custom stop callback; defaults to the tile delegate's interrupt. */
  onStop?: (runtimeId: string) => Promise<void>
}

/** Move focus across the grid's cards. Column count comes from the rendered
 *  grid (auto-fill), so up/down follow the visual columns at any width. */
function moveCardFocus(grid: HTMLElement, delta: number) {
  const cards = [...grid.querySelectorAll<HTMLElement>('[data-overview-card]')]
  const at = cards.indexOf(document.activeElement as HTMLElement)

  if (at < 0) {
    return
  }

  const next = at + delta

  if (next < 0 || next >= cards.length) {
    return
  }

  cards[next]?.focus()
}

export function MissionControlView({ onClose, onOpenSession, onStop }: MissionControlViewProps) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const gridRefs = useRef(new Map<string, HTMLDivElement>())

  const sessions = useStore($sessions)
  const dotStates = useStore($sessionDotStateById)
  const workingSessionIds = useStore($workingSessionIds)
  const attentionSessionIds = useStore($attentionSessionIds)
  const finishedSessionIds = useStore($unreadFinishedSessionIds)
  const sessionTiles = useStore($sessionTiles)
  const selectedStoredSessionId = useStore($selectedStoredSessionId)

  const cards = useMemo(
    () =>
      collectOverviewCards({
        attentionSessionIds,
        dotStates,
        finishedSessionIds,
        openSessionIds: [...sessionTiles.map(tile => tile.storedSessionId), selectedStoredSessionId],
        sessions,
        workingSessionIds
      }),
    [attentionSessionIds, dotStates, finishedSessionIds, selectedStoredSessionId, sessions, sessionTiles, workingSessionIds]
  )

  const liveCount = cards.filter(card => card.group !== 'done').length

  const groupLabel: Record<SessionLiveGroup, string> = {
    done: t.sidebar.statusDivider.done,
    'needs-you': t.sidebar.statusDivider.needsYou,
    working: t.sidebar.statusDivider.working
  }

  // The grid is opened by a direct action (statusbar, keybind), so landing
  // focus on the first card is a continuation of that gesture, not a steal.
  useEffect(() => {
    gridRefs.current.values().next().value?.querySelector<HTMLElement>('[data-overview-card]')?.focus()
  }, [])

  const handleOpen = (storedSessionId: string) => {
    triggerHaptic('selection')
    onOpenSession(storedSessionId)
    onClose()
  }

  const handleNewSession = () => {
    // Same door as the `session.new` keybind: target the sessions workspace
    // with the live profile, then land on a fresh chat.
    setWorkspaceScope('sessions')
    $newChatProfile.set(null)
    onClose()
    navigate(NEW_CHAT_ROUTE)
    window.dispatchEvent(new CustomEvent('hermes:new-session-shortcut'))
  }

  const handleGridKeyDown = (group: SessionLiveGroup, event: React.KeyboardEvent) => {
    const grid = gridRefs.current.get(group)

    if (!grid) {
      return
    }

    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        moveCardFocus(grid, 1)

        break

      case 'ArrowLeft':
        event.preventDefault()
        moveCardFocus(grid, -1)

        break

      case 'ArrowDown':
        event.preventDefault()
        moveCardFocus(grid, columns)

        break

      case 'ArrowUp':
        event.preventDefault()
        moveCardFocus(grid, -columns)

        break

      default:
        break
    }
  }

  return (
    <OverlayView onClose={onClose} rootClassName="mx-auto w-full max-w-3xl">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-(--ui-stroke-tertiary) px-5 pt-[calc(var(--titlebar-height)+0.875rem)] pb-3">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[length:var(--conversation-text-font-size)] font-semibold text-foreground">
              {t.sessionOverview.title}
            </h1>
            {liveCount > 0 && (
              <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                {liveCount}
              </span>
            )}
          </div>
        </div>

        {cards.length === 0 ? (
          <div className="grid min-h-48 flex-1 place-items-center px-6 pb-8">
            <EmptyState
              action={{ label: t.sessionOverview.newSession, onClick: handleNewSession }}
              title={t.sessionOverview.empty}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {SESSION_LIVE_GROUPS.map(group => {
              const groupCards = cards.filter(card => card.group === group)

              if (groupCards.length === 0) {
                return null
              }

              const section = (
                <section aria-label={groupLabel[group]} className="mb-5 last:mb-0" key={group}>
                  <h2 className="mb-2 flex items-baseline gap-1.5 text-ui-xs font-medium text-fg-muted">
                    {groupLabel[group]}
                    <span className="text-ui-2xs tabular-nums">{groupCards.length}</span>
                  </h2>
                  <div
                    className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3"
                    onKeyDown={event => handleGridKeyDown(group, event)}
                    ref={node => {
                      if (node) {
                        gridRefs.current.set(group, node)
                      } else {
                        gridRefs.current.delete(group)
                      }
                    }}
                    role="group"
                  >
                    {groupCards.map(card => (
                      <OverviewCard
                        card={card}
                        index={cards.indexOf(card)}
                        key={card.storedSessionId}
                        onOpen={handleOpen}
                        onStop={onStop}
                      />
                    ))}
                  </div>
                </section>
              )

              return section
            })}
          </div>
        )}
      </div>
    </OverlayView>
  )
}
