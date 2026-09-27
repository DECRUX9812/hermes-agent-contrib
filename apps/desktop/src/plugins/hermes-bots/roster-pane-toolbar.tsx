import {
  Button,
  cn,
  Codicon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SearchField,
  Tip
} from '@hermes/plugin-sdk'

import { botSourceStatus } from './data'
import type { useBots } from './i18n'
import type { RosterSortMode } from './live-status'
import { setActivityToasts } from './roster-actions'
import { GatewayKindGlyph } from './roster-sections'
import type { rosterGatewayOptions } from './roster-sections'
import type { RosterActivityFilter, RosterKindFilter, RosterRow } from './types'

interface renderRosterToolbarProps {
  b: ReturnType<typeof useBots>
  activityToasts: boolean
  activeSourceRoster: RosterRow[]
  /** Full multi-source roster — the New Group Chat gate counts the same
   *  selectable set the dialog seats (bots from every registered connection). */
  roster: RosterRow[]
  setCreateOpen: (value: boolean) => void
  setGroupCreateOpen: (value: boolean) => void
  setSectionDialog: (
    value: null | { bot?: RosterRow; mode: 'create' } | { id: string; mode: 'rename'; name: string }
  ) => void
  showRosterTools: boolean
  showRosterSearch: boolean
  showRosterFilters: boolean
  query: string
  setQuery: (value: string) => void
  activeFilterCount: number
  gatewayOptions: ReturnType<typeof rosterGatewayOptions>
  rowKindFilter: RosterKindFilter
  setRowKindFilter: (value: RosterKindFilter) => void
  activityFilter: RosterActivityFilter
  setActivityFilter: (value: RosterActivityFilter) => void
  gatewayFilter: string
  setGatewayFilter: (value: string) => void
  /** A2 — the roster sort: 'recent' (default) or 'attention' first. */
  sortMode: RosterSortMode
  setSortMode: (value: RosterSortMode) => void
  /** D1/D3 — fleet surfaces open from the toolbar. */
  setBroadcastOpen: (value: boolean) => void
  setCalendarOpen: (value: boolean) => void
}

export function renderRosterToolbar({
  b,
  activityToasts,
  activeSourceRoster,
  roster,
  setCreateOpen,
  setGroupCreateOpen,
  setSectionDialog,
  showRosterTools,
  showRosterSearch,
  showRosterFilters,
  query,
  setQuery,
  activeFilterCount,
  gatewayOptions,
  rowKindFilter,
  setRowKindFilter,
  activityFilter,
  setActivityFilter,
  gatewayFilter,
  setGatewayFilter,
  sortMode,
  setSortMode,
  setBroadcastOpen,
  setCalendarOpen
}: renderRosterToolbarProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-2.5 pt-2.5 pb-1.5">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)">
          Bots
        </span>
        <div className="flex items-center gap-0.5">
          <Tip
            label={activityToasts ? 'Activity toasts on — click to silence' : 'Activity toasts off — click to enable'}
          >
            <Button
              className="rounded-md text-(--ui-text-tertiary) hover:text-foreground"
              onClick={() => setActivityToasts(!activityToasts)}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name={activityToasts ? 'bell' : 'bell-slash'} />
            </Button>
          </Tip>
          <DropdownMenu>
            <Tip label="New…">
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={b.roster.newBotOrGroup}
                  className="rounded-md text-(--ui-text-tertiary) hover:text-foreground"
                  size="icon-xs"
                  variant="ghost"
                >
                  <Codicon name="add" />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
                <Codicon className="mr-1.5" name="hubot" />
                {b.bot.newTitle}
              </DropdownMenuItem>
              {/* Same selectable set as CreateGroupChatDialog: one local bot plus a
                  remote-connection bot is a valid room (#101543). */}
              <DropdownMenuItem
                disabled={roster.filter(bot => !bot?.ghost).length < 2}
                onSelect={() => setGroupCreateOpen(true)}
              >
                <Codicon className="mr-1.5" name="organization" />
                {b.group.newTitle}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setSectionDialog({ mode: 'create' })}>
                <Codicon className="mr-1.5" name="new-folder" />
                {b.sections.newSection}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <Tip label={b.broadcast.title}>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={b.broadcast.title}
                  className="rounded-md text-(--ui-text-tertiary) hover:text-foreground"
                  size="icon-xs"
                  variant="ghost"
                >
                  <Codicon name="broadcast" />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!roster.filter(bot => !bot?.ghost).length}
                onSelect={() => setBroadcastOpen(true)}
              >
                <Codicon className="mr-1.5" name="broadcast" />
                {b.broadcast.menuItem}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!roster.filter(bot => !bot?.ghost).length}
                onSelect={() => setCalendarOpen(true)}
              >
                <Codicon className="mr-1.5" name="calendar" />
                {b.calendar.menuItem}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {showRosterTools ? (
        <div className="flex min-w-0 items-center gap-1 px-2.5 pb-1.5">
          {showRosterSearch ? (
            <SearchField
              aria-label={b.roster.search}
              containerClassName={cn('min-w-0 flex-1', query ? 'opacity-100!' : 'opacity-50 focus-within:opacity-100')}
              inputClassName="w-full text-[0.75rem] placeholder:text-(--ui-text-tertiary)"
              key={'roster-search'}
              onChange={setQuery}
              placeholder={b.roster.searchPlaceholder}
              value={query}
            />
          ) : (
            <span className="min-w-0 flex-1" key={'roster-search-spacer'} />
          )}
          {showRosterFilters ? (
            <DropdownMenu key={'roster-filters'}>
              <Tip label={activeFilterCount ? `Filters (${activeFilterCount} active)` : 'Filter roster'}>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={activeFilterCount ? `Filter roster, ${activeFilterCount} active` : 'Filter roster'}
                    className={cn(
                      'size-7 shrink-0 rounded-md text-(--ui-text-tertiary) hover:text-foreground',
                      activeFilterCount && 'text-(--ui-accent)'
                    )}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Codicon name="list-filter" />
                  </Button>
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent align="end">
                {(
                  [
                    ['all', b.roster.botsAndGroups],
                    ['bots', b.roster.botsOnly],
                    ['groups', b.roster.groupsOnly]
                  ] as [RosterKindFilter, string][]
                ).map(([value, label]) => (
                  <DropdownMenuItem key={`kind:${value}`} onSelect={() => setRowKindFilter(value)}>
                    <span className="min-w-0 flex-1">{label}</span>
                    {rowKindFilter === value ? <Codicon name="check" /> : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {(
                  [
                    ['all', b.roster.anyActivity],
                    ['active', b.roster.activeNow],
                    ['recent', b.roster.recentlyActive],
                    ['older', b.roster.older]
                  ] as [RosterActivityFilter, string][]
                ).map(([value, label]) => (
                  <DropdownMenuItem key={`activity:${value}`} onSelect={() => setActivityFilter(value)}>
                    <span className="min-w-0 flex-1">{label}</span>
                    {activityFilter === value ? <Codicon name="check" /> : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {(
                  [
                    ['recent', b.roster.sortRecent],
                    ['attention', b.roster.sortAttention],
                    ['alpha', b.roster.sortAlpha]
                  ] as [RosterSortMode, string][]
                ).map(([value, label]) => (
                  <DropdownMenuItem key={`sort:${value}`} onSelect={() => setSortMode(value)}>
                    <span className="min-w-0 flex-1">{label}</span>
                    {sortMode === value ? <Codicon name="check" /> : null}
                  </DropdownMenuItem>
                ))}
                {gatewayOptions.length > 1 ? <DropdownMenuSeparator /> : null}
                {gatewayOptions.length > 1 ? (
                  <DropdownMenuItem onSelect={() => setGatewayFilter('all')}>
                    <Codicon className="mr-1.5" name="globe" />
                    <span className="min-w-0 flex-1">All gateways</span>
                    {gatewayFilter === 'all' ? <Codicon name="check" /> : null}
                  </DropdownMenuItem>
                ) : null}
                {gatewayOptions.length > 1
                  ? gatewayOptions.map(option => {
                      const status = botSourceStatus({
                        sourceError: option.error,
                        sourceReachable: option.reachable
                      })

                      return (
                        <DropdownMenuItem
                          key={option.connectionId}
                          onSelect={() => setGatewayFilter(option.connectionId)}
                        >
                          <GatewayKindGlyph
                            className={cn('mr-1.5', !status.available && 'text-amber-600 dark:text-amber-300')}
                            kind={option.kind}
                          />
                          <span className="min-w-0 flex-1 truncate">{option.label || option.connectionId}</span>
                          <span className="text-[0.625rem] tabular-nums text-(--ui-text-quaternary)">
                            {option.count}
                          </span>
                          {gatewayFilter === option.connectionId ? <Codicon name="check" /> : null}
                        </DropdownMenuItem>
                      )
                    })
                  : []}
                {activeFilterCount ? <DropdownMenuSeparator /> : null}
                {activeFilterCount ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setRowKindFilter('all')
                      setActivityFilter('all')
                      setGatewayFilter('all')
                    }}
                  >
                    {b.roster.clearFilters}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
