import { useEffect, useState } from 'react'

import { botRosterKey } from './data'
import { requestForBot } from './routing'
import type { RosterRow } from './types'

/** Where a bot's browser tasks draw: on its own desktop, somewhere else (a
 *  cloud provider, a CDP endpoint, a headless or real-profile browser), or
 *  not knowable from here. Only `desktop` may show the bot's screen. */
export type BrowserBackend = 'desktop' | 'elsewhere' | 'unknown'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function truthy(value: unknown): boolean {
  return typeof value === 'string' ? TRUTHY.has(value.trim().toLowerCase()) : Boolean(value)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Read the backend from a profile's config plus its live CDP override, the
 *  same precedence the browser tool uses: a CDP override first, then the
 *  provider, then the local engine. A local browser shows on the desktop only
 *  when it runs headed, and an absent provider key means the backend picks by
 *  credentials, which this side cannot see. */
export function browserBackendFrom(config: unknown, cdpUrl: unknown): BrowserBackend {
  const root = record(config)

  if (!root) {
    return 'unknown'
  }

  const browser = record(root.browser) ?? {}

  if (String(cdpUrl ?? '').trim() || String(browser.cdp_url ?? '').trim()) {
    return 'elsewhere'
  }

  if (!('cloud_provider' in browser)) {
    return 'unknown'
  }

  const provider = String(browser.cloud_provider ?? '').trim().toLowerCase()

  if (provider && provider !== 'local') {
    return 'elsewhere'
  }

  if (String(browser.engine ?? '').trim().toLowerCase() === 'lightpanda') {
    return 'elsewhere'
  }

  return truthy(browser.headed) ? 'desktop' : 'elsewhere'
}

const FRESH_MS = 30_000

interface Entry {
  at: number
  value: BrowserBackend
  pending?: Promise<BrowserBackend>
}

const verdicts = new Map<string, Entry>()

async function readBackend(bot: RosterRow): Promise<BrowserBackend> {
  try {
    const [config, status] = await Promise.all([
      requestForBot<{ config?: unknown }>(bot, 'config.get', { key: 'full' }),
      requestForBot<{ url?: unknown }>(bot, 'browser.manage', { action: 'status' })
    ])

    return browserBackendFrom(config?.config, status?.url)
  } catch {
    return 'unknown'
  }
}

/** The bot's backend, read once and kept fresh for half a minute. */
export function browserBackendFor(bot: RosterRow, now = Date.now()): Promise<BrowserBackend> {
  const key = botRosterKey(bot)
  const entry = verdicts.get(key)

  if (entry?.pending) {
    return entry.pending
  }

  if (entry && now - entry.at < FRESH_MS) {
    return Promise.resolve(entry.value)
  }

  const pending = readBackend(bot).then(value => {
    verdicts.set(key, { at: Date.now(), value })

    return value
  })

  verdicts.set(key, { at: entry?.at ?? 0, value: entry?.value ?? 'unknown', pending })

  return pending
}

export function forgetBrowserBackends(): void {
  verdicts.clear()
}

/** `unknown` until the read lands, so the screenshot holds the frame meanwhile. */
export function useBrowserBackend(bot: null | RosterRow): BrowserBackend {
  const key = bot ? botRosterKey(bot) : ''
  const [verdict, setVerdict] = useState<{ key: string; value: BrowserBackend }>({ key: '', value: 'unknown' })

  useEffect(() => {
    if (!bot) {
      return
    }

    let alive = true

    void browserBackendFor(bot).then(value => {
      if (alive) {
        setVerdict({ key, value })
      }
    })

    return () => {
      alive = false
    }
    // Keyed on the bot's identity: a fresh roster row for the same bot is the same backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return verdict.key === key ? verdict.value : 'unknown'
}
