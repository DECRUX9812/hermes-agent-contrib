import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'

import { getAvatar } from '../avatars/registry'
import { PANE_COPY } from '../copy'
import { relativeTime } from '../director/feed'
import { $feed, $feedPanelOpen } from '../director/store'
import { DOCK_BUTTON, DOCK_MARGIN } from '../scene/projection'

import { DevBadge } from './dev-badge'

const PANEL_WIDTH = 300
const PANEL_MAX_HEIGHT = 320

/**
 * The shared activity feed (architecture §8.5/§8.6), toggled from the dock.
 * Newest first, one row per notify/chat/result entry, each with the speaker's
 * avatar dot, its text and a relative time. Harness-sourced entries are badged.
 */
export function FeedPanel() {
  const open = useStore($feedPanelOpen)
  const entries = useStore($feed)

  if (!open) {
    return null
  }

  return (
    <div
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border border-(--stroke-nous) bg-card text-foreground shadow-nous"
      data-pane-feed
      data-pane-hit
      style={{
        bottom: DOCK_MARGIN + DOCK_BUTTON + 10,
        maxHeight: PANEL_MAX_HEIGHT,
        right: DOCK_MARGIN,
        width: PANEL_WIDTH
      }}
    >
      <header className="flex items-center gap-2 border-b border-(--stroke-nous) px-3 py-2">
        <span className="text-[12px] font-medium text-(--ui-text-primary)">{PANE_COPY.feed}</span>
        <span className="ml-auto text-[11px] text-(--ui-text-tertiary)">{entries.length}</span>
        <Button
          aria-label={PANE_COPY.closeFeed}
          className="-my-1 -mr-1 text-(--ui-text-tertiary)"
          data-pane-hit
          onClick={() => $feedPanelOpen.set(false)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          ×
        </Button>
      </header>

      {entries.length === 0 ? (
        <p className="px-3 py-4 text-[12px] text-(--ui-text-tertiary)">{PANE_COPY.feedEmpty}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
          {entries.map(entry => (
            <li className="flex items-start gap-2 rounded-lg px-2 py-1.5" data-feed-kind={entry.kind} key={entry.id}>
              <span
                aria-hidden
                className="mt-1 size-2 shrink-0 rounded-full"
                style={{ background: getAvatar(entry.avatar).palette.primary }}
              />
              <span className="min-w-0 flex-1 text-[12px] leading-[1.4] text-(--ui-text-secondary)">{entry.text}</span>
              {entry.source === 'dev-harness' ? <DevBadge /> : null}
              <time
                className="shrink-0 text-[10px] text-(--ui-text-tertiary)"
                dateTime={new Date(entry.at).toISOString()}
              >
                {relativeTime(entry.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
