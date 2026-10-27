import { useValue } from '@hermes/plugin-sdk'
import { useContext, useEffect, useState } from 'react'

import { botForChat } from './chat-empty'
import { $lastRoster, cachedUnionRoster, primeRoster } from './data'
import { PreviewSessionContext } from './tool-card-session'
import type { RosterRow } from './types'

const RETRY_MS = 10_000

let priming: Promise<void> | null = null
let primedAt = 0

/** One roster fetch shared by every card that missed its bot, and at most one
 *  per ten seconds, so a chat full of cards never floods the gateway. */
function primeOnce(now = Date.now()): Promise<void> {
  if (priming) {
    return priming
  }

  if (now - primedAt < RETRY_MS) {
    return Promise.resolve()
  }

  primedAt = now
  priming = primeRoster().finally(() => {
    priming = null
  })

  return priming
}

export function resetCardBotPrime(): void {
  priming = null
  primedAt = 0
}

function cachedRows(): RosterRow[] {
  const rows = cachedUnionRoster()?.profiles

  return Array.isArray(rows) ? rows.filter(row => row && !row.ghost) : []
}

/** The bot whose chat this card sits in. The Bots pane publishes the roster
 *  only while it is mounted; a Bot Chat restored without it reads the shared
 *  roster cache and, on a miss, fetches the roster once. */
export function useCardBot(): null | RosterRow {
  const session = useContext(PreviewSessionContext)
  const live = useValue($lastRoster)
  const [cached, setCached] = useState<RosterRow[]>(() => (live.length ? [] : cachedRows()))
  const inChat = Boolean(session.storedId || session.runtimeId)
  const roster = live.length ? live : cached
  const bot = inChat ? botForChat(roster, session.storedId ?? '') : null
  const missing = inChat && !bot

  useEffect(() => {
    if (!missing) {
      return
    }

    let alive = true

    void primeOnce().then(() => {
      if (alive) {
        setCached(cachedRows())
      }
    })

    return () => {
      alive = false
    }
  }, [missing])

  return bot
}
