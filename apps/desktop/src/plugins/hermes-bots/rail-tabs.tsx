import { cn, Codicon } from '@hermes/plugin-sdk'
import { useRef } from 'react'

import { useBots } from './i18n'
import { RAIL_TAB_IDS, type RailTabId } from './rail-state'

const TAB_ICONS: Record<RailTabId, string> = {
  activity: 'list-unordered',
  approvals: 'shield',
  scheduled: 'history',
  bot: 'hubot'
}

interface RailTabsProps {
  badges: Partial<Record<RailTabId, number>>
  onChange: (id: RailTabId) => void
  value: RailTabId
}

/** Labeled tabs remain discoverable without a tooltip or a pointer. */
export function RailTabs({ badges, onChange, value }: RailTabsProps) {
  const b = useBots()
  const buttons = useRef<Partial<Record<RailTabId, HTMLButtonElement | null>>>({})

  return (
    <div
      aria-label={b.rail.title}
      className="mx-3 grid grid-cols-2 gap-1 rounded-lg bg-(--ui-inline-code-background) p-1"
      role="tablist"
    >
      {RAIL_TAB_IDS.map((id, index) => {
        const active = id === value
        const badge = badges[id] ?? 0

        return (
          <button
            aria-controls={`rail-panel-${id}`}
            aria-label={badge ? `${b.activity.tabs[id]} (${badge})` : b.activity.tabs[id]}
            aria-selected={active}
            className={cn(
              'flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)',
              active
                ? 'bg-(--ui-chat-bubble-background) text-foreground shadow-sm'
                : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'
            )}
            data-testid={`rail-tab:${id}`}
            id={`rail-tab-${id}`}
            key={id}
            onClick={() => onChange(id)}
            onKeyDown={event => {
              const offsets: Record<string, number> = { ArrowDown: 2, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2 }
              const offset = offsets[event.key]

              const next =
                event.key === 'Home'
                  ? RAIL_TAB_IDS[0]
                  : event.key === 'End'
                    ? RAIL_TAB_IDS.at(-1)
                    : offset !== undefined
                      ? RAIL_TAB_IDS[(index + offset + RAIL_TAB_IDS.length) % RAIL_TAB_IDS.length]
                      : undefined

              if (!next) {
                return
              }

              event.preventDefault()
              onChange(next)
              buttons.current[next]?.focus()
            }}
            ref={element => {
              buttons.current[id] = element
            }}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
          >
            <Codicon aria-hidden name={TAB_ICONS[id]} size="0.875rem" />
            <span className="truncate">{b.activity.tabs[id]}</span>
            {badge > 0 ? (
              <span className="rounded bg-(--ui-accent)/12 px-1 text-xs tabular-nums text-(--ui-text-primary)">
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
