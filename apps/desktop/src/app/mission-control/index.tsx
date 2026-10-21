import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { OverlayView } from '@/app/overlays/overlay-view'
import { Button } from '@/components/ui/button'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { triggerHaptic } from '@/lib/haptics'
import { AlertCircle } from '@/lib/icons'
import type { LiveAction } from '@/lib/live-actions'
import { activeGatewayProfileKey, requestGatewayForProfile } from '@/store/gateway'
import { $selectedStoredSessionId, $sessions } from '@/store/session'
import { $sessionStates, $sessionTiles, $workingSessionIds, openSessionTile } from '@/store/session-states'

import { collectMissionControlCards } from './collector'
import type { MissionControlCard } from './types'

export interface MissionControlViewProps {
  onClose: () => void
  /** Opens a stored session id (the wiring hands in `openSession`). */
  onOpenSession: (storedSessionId: string) => void
  /** Optional custom stop callback; defaults to gateway `session.interrupt`. */
  onStop?: (runtimeId: string) => Promise<void>
}

function formatActionLine(action: LiveAction): string {
  if (action.target) {
    return `${action.tool}: ${action.target}`
  }

  return action.tool
}

export function MissionControlView({
  onClose,
  onOpenSession,
  onStop
}: MissionControlViewProps) {
  const workingSessionIds = useStore($workingSessionIds)
  const sessions = useStore($sessions)
  const sessionStates = useStore($sessionStates)
  const selectedStoredSessionId = useStore($selectedStoredSessionId)
  const sessionTiles = useStore($sessionTiles)

  const [stoppingIds, setStoppingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [errorBySessionId, setErrorBySessionId] = useState<Record<string, string>>({})

  const cards: MissionControlCard[] = useMemo(() => {
    return collectMissionControlCards({
      sessionStates,
      sessions,
      workingSessionIds
    })
  }, [sessionStates, sessions, workingSessionIds])

  const tiledIds = useMemo(() => new Set(sessionTiles.map(t => t.storedSessionId)), [sessionTiles])

  // Sessions that can be tiled: other working sessions not currently in main and not already tiled
  const tileableOtherSessions = useMemo(() => {
    return cards.filter(
      card => card.storedSessionId !== selectedStoredSessionId && !tiledIds.has(card.storedSessionId)
    )
  }, [cards, selectedStoredSessionId, tiledIds])

  const canTileSideBySide = cards.length > 1 && tileableOtherSessions.length > 0

  const handleOpen = (storedSessionId: string) => {
    triggerHaptic('selection')
    onOpenSession(storedSessionId)
    onClose()
  }

  const handleOpenSideBySide = () => {
    if (!canTileSideBySide) {
      return
    }

    triggerHaptic('selection')

    for (const session of tileableOtherSessions) {
      openSessionTile(session.storedSessionId, 'right')
    }

    onClose()
  }

  const handleStop = async (runtimeId: string) => {
    triggerHaptic('cancel')
    setStoppingIds(prev => new Set([...prev, runtimeId]))

    setErrorBySessionId(prev => {
      const next = { ...prev }

      delete next[runtimeId]

      return next
    })

    try {
      if (onStop) {
        await onStop(runtimeId)
      } else {
        await requestGatewayForProfile(activeGatewayProfileKey(), 'session.interrupt', { session_id: runtimeId })
      }
    } catch (err) {
      setStoppingIds(prev => {
        const next = new Set(prev)

        next.delete(runtimeId)

        return next
      })

      const message = err instanceof Error ? err.message : 'Failed to stop session'

      setErrorBySessionId(prev => ({ ...prev, [runtimeId]: message }))
    }
  }

  const handleDismissError = (runtimeId: string) => {
    setErrorBySessionId(prev => {
      const next = { ...prev }

      delete next[runtimeId]

      return next
    })
  }

  return (
    <OverlayView onClose={onClose} rootClassName="mx-auto w-full max-w-xl">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-(--ui-stroke-tertiary) px-5 pt-[calc(var(--titlebar-height)+0.875rem)] pb-3">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[length:var(--conversation-text-font-size)] font-semibold text-foreground">
              Mission Control
            </h1>
            {cards.length > 0 && (
              <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                {cards.length}
              </span>
            )}
          </div>
          <Button
            disabled={!canTileSideBySide}
            onClick={handleOpenSideBySide}
            size="xs"
            variant="secondary"
          >
            Open side by side
          </Button>
        </div>

        {cards.length === 0 ? (
          <div className="grid min-h-48 flex-1 place-items-center px-6 pb-8 text-center">
            <div className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
              Nothing running.
            </div>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3">
            {cards.map(card => {
              const isStopping = stoppingIds.has(card.runtimeId)
              const errorMessage = errorBySessionId[card.runtimeId]

              return (
                <li key={card.runtimeId}>
                  <div className="flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-(--chrome-action-hover)/50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
                          {card.title}
                        </span>
                      </div>

                      {card.latestAction && (
                        <div className="mt-1 flex items-center gap-1.5 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary) min-w-0">
                          <span
                            aria-label="Working"
                            className="size-1.5 shrink-0 rounded-full bg-emerald-500 animate-pulse"
                            role="status"
                          />
                          <span className="truncate">{formatActionLine(card.latestAction)}</span>
                        </div>
                      )}

                      {isStopping && (
                        <div className="mt-1 flex items-center gap-1.5 text-[length:var(--conversation-caption-font-size)] text-amber-500 min-w-0">
                          <GlyphSpinner ariaLabel="Stopping" className="size-3 shrink-0" />
                          <span className="truncate">Stopping session...</span>
                        </div>
                      )}

                      {errorMessage && (
                        <div className="mt-1.5 flex items-center gap-2 text-[length:var(--conversation-caption-font-size)] text-destructive">
                          <AlertCircle className="size-3.5 shrink-0" />
                          <span className="truncate">{errorMessage}</span>
                          <Button
                            className="text-destructive hover:underline"
                            onClick={() => void handleStop(card.runtimeId)}
                            size="micro"
                            variant="text"
                          >
                            Retry
                          </Button>
                          <Button
                            className="text-(--ui-text-tertiary) hover:underline"
                            onClick={() => handleDismissError(card.runtimeId)}
                            size="micro"
                            variant="text"
                          >
                            Ignore
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        onClick={() => handleOpen(card.storedSessionId)}
                        size="xs"
                        variant="secondary"
                      >
                        Open
                      </Button>
                      <Button
                        className="text-destructive hover:bg-destructive/10"
                        disabled={isStopping}
                        onClick={() => void handleStop(card.runtimeId)}
                        size="xs"
                        variant="ghost"
                      >
                        {isStopping ? 'Stopping...' : 'Stop'}
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </OverlayView>
  )
}
