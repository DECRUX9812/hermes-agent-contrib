import type { FeedEntry, PaneCard } from './store'

/** The activity feed keeps at most this many entries (§8.5). */
export const FEED_CAP = 50

/** Newest first, capped — the feed's one write path. */
export function appendFeed(entries: FeedEntry[], entry: FeedEntry, cap = FEED_CAP): FeedEntry[] {
  return [entry, ...entries].slice(0, cap)
}

/** The feed record a settled notification card collapses into (§8.5). */
export function notificationFeedEntry(card: PaneCard, at: number): FeedEntry {
  return {
    at,
    avatar: card.avatar,
    id: card.id,
    kind: 'notify',
    source: card.request.source ?? 'live',
    text: card.request.title
  }
}

/** Compact relative time for the card and the feed panel. */
export function relativeTime(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))

  if (seconds < 10) {
    return 'just now'
  }

  if (seconds < 60) {
    return `${seconds}s ago`
  }

  const minutes = Math.round(seconds / 60)

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.round(minutes / 60)

  if (hours < 24) {
    return `${hours}h ago`
  }

  return `${Math.round(hours / 24)}d ago`
}
