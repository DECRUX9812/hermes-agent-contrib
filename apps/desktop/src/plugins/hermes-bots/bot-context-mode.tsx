/**
 * Bot Context mode — the unified bots + sessions surface.
 *
 * The right rail answers "what is this bot doing?" for ONE bot. This page is
 * the doorway into that rail: every bot in the roster, every session under its
 * bot, one search field, and the selected bot's context beside it. It is a
 * navigation mode, not a dashboard: no charts, no tiles, no second activity
 * model — the rail owns the activity/approval truth.
 */

import { Button, cn, Codicon, host, Input, Tip, useQuery, useValue } from '@hermes/plugin-sdk'
import { useMemo, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { BotContextPanel } from './bot-context-panel'
import { $selectedBot } from './bot-state'
import { $botMeta, $lastRoster, botRosterKey, botSelectionKey } from './data'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botConnectionRoute, botRosterMeta } from './routing'
import { ID } from './shared'
import type { RosterRow, SessionPreview } from './types'

interface BotSessions {
  error?: string
  sessions: SessionPreview[]
}

const EMPTY: BotSessions = { sessions: [] }

function sessionTitle(session: SessionPreview): string {
  return String(session.title || session.preview || session.id || 'Untitled session').trim()
}

function relativeSeconds(session: SessionPreview): number {
  return Number(session.last_active ?? 0) * 1000
}

/** Open a session in the bot's own workspace; the rail then follows focus. */
export function openContextSession(bot: RosterRow, session: SessionPreview) {
  $selectedBot.set(botSelectionKey(bot) || bot.name)

  if (typeof host.openSession !== 'function') {
    return
  }

  void host.openSession(String(session.id), {
    profile: bot.name,
    intent: 'tab'
  })
}

export function BotContextMode() {
  const b = useBots()
  const m = b.mode
  const roster = useValue($lastRoster)
  const allMeta = useValue($botMeta)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const bots = useMemo(
    () => [...roster].filter(bot => !bot.ghost && !bot.sourceMissing).sort((a, b) => a.name.localeCompare(b.name)),
    [roster]
  )

  const sessions = useQuery({
    enabled: bots.length > 0,
    queryFn: async () => {
      const out: Record<string, BotSessions> = {}

      for (const bot of bots) {
        const route = botConnectionRoute(bot)

        try {
          if (typeof host.listPersistedSessions !== 'function') {
            out[botRosterKey(bot)] = EMPTY

            continue
          }

          const page = await host.listPersistedSessions(route, { limit: 12, profile: bot.name })
          out[botRosterKey(bot)] = {
            sessions: ((page?.sessions || []) as SessionPreview[]).filter(session =>
              Boolean(String(session?.id || '').trim())
            )
          }
        } catch (error) {
          out[botRosterKey(bot)] = { error: error instanceof Error ? error.message : String(error), sessions: [] }
        }
      }

      return out
    },
    queryKey: ['bot-context-mode-sessions', bots.map(bot => botRosterKey(bot)).join('|')],
    refetchInterval: 30000,
    staleTime: 8000
  })

  const needle = query.trim().toLowerCase()

  const visible = bots
    .map(bot => {
      const key = botRosterKey(bot)
      const entry = sessions.data?.[key] || EMPTY
      const meta = botRosterMeta(bot, allMeta)
      const label = displayName(bot, meta)

      return {
        bot,
        entry,
        key,
        label,
        sessions: entry.sessions.filter(session => {
          if (!needle) {
            return true
          }

          return `${label} ${bot.name} ${sessionTitle(session)}`.toLowerCase().includes(needle)
        })
      }
    })
    .filter(
      row =>
        row.sessions.length > 0 ||
        row.label.toLowerCase().includes(needle) ||
        row.bot.name.toLowerCase().includes(needle)
    )

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-(--ui-sidebar-surface-background) text-(--ui-text-primary)">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-(--ui-stroke-quaternary)">
        <header className="border-b border-(--ui-stroke-quaternary) px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-10 font-semibold uppercase tracking-[0.12em] text-(--ui-text-tertiary)">
                {m.title}
              </div>
              <h1 className="mt-1 text-base font-semibold leading-tight">{m.heading}</h1>
            </div>
            <Tip label={m.openBotMode}>
              <Button
                aria-label={m.openBotMode}
                onClick={() => {
                  try {
                    host.revealPane?.(`${ID}:pane`)
                  } catch {
                    host.navigate?.('/')
                  }
                }}
                size="icon-xs"
                variant="ghost"
              >
                <Codicon name="robot" />
              </Button>
            </Tip>
          </div>
          <Input
            aria-label={m.searchLabel}
            className="mt-3 h-8 text-xs"
            onChange={event => setQuery(event.target.value)}
            placeholder={m.searchPlaceholder}
            value={query}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {sessions.isLoading && !sessions.data ? (
            <div className="grid gap-1.5 px-1 py-2" data-testid="bot-context-mode-loading">
              <div className="h-8 animate-pulse rounded-md bg-(--ui-control-active-background)" />
              <div className="h-8 animate-pulse rounded-md bg-(--ui-control-active-background)" />
              <div className="h-8 w-2/3 animate-pulse rounded-md bg-(--ui-control-active-background)" />
            </div>
          ) : visible.length === 0 ? (
            <div className="grid place-items-center px-4 py-10 text-center text-11 leading-relaxed text-(--ui-text-tertiary)">
              {m.noMatch(query)}
            </div>
          ) : (
            visible.map(({ bot, entry, key, label, sessions: rows }) => {
              const isOpen = open[key] ?? true
              const appearance = botAppearance(bot.name, botRosterMeta(bot, allMeta))

              return (
                <section className="mb-1" key={key}>
                  <button
                    aria-expanded={isOpen}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
                    onClick={() => setOpen(current => ({ ...current, [key]: !isOpen }))}
                    type="button"
                  >
                    <BotFace
                      color={avatarColor(appearance.color, bot.name)}
                      image={appearance.image}
                      name={bot.name}
                      shape={appearance.shape}
                      size={24}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="truncate text-xs font-semibold">{label}</span>
                      <span className="ml-1.5 text-10 text-(--ui-text-tertiary)">{entry.sessions.length}</span>
                    </span>
                    <Codicon
                      className={cn('shrink-0 text-(--ui-text-quaternary) transition-transform', isOpen && 'rotate-90')}
                      name="chevron-right"
                      size="0.7rem"
                    />
                  </button>
                  {isOpen ? (
                    <div className="ml-3 border-l border-(--ui-stroke-tertiary) pl-1.5">
                      {rows.length ? (
                        rows.map(session => (
                          <button
                            className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
                            key={session.id}
                            onClick={() => openContextSession(bot, session)}
                            type="button"
                          >
                            <Codicon
                              className="mt-0.5 shrink-0 text-(--ui-text-quaternary)"
                              name="comment"
                              size="0.7rem"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-1 block text-11 font-medium text-(--ui-text-primary)">
                                {sessionTitle(session)}
                              </span>
                              <span className="text-10 text-(--ui-text-tertiary)">
                                {session.last_active ? `${session.message_count ?? 0} messages` : 'No messages'}
                              </span>
                            </span>
                          </button>
                        ))
                      ) : entry.error ? (
                        <div className="px-2 py-1 text-10 text-destructive">{entry.error}</div>
                      ) : (
                        <div className="px-2 py-1 text-10 text-(--ui-text-tertiary)">{m.noSessions}</div>
                      )}
                    </div>
                  ) : null}
                </section>
              )
            })
          )}
        </div>
      </aside>

      <main className="grid min-w-0 flex-1 place-items-center bg-(--ui-chat-surface-background) px-8 text-center">
        <div className="max-w-sm">
          <Codicon className="mx-auto text-(--ui-text-quaternary)" name="hubot" size="1.5rem" />
          <h2 className="mt-3 text-sm font-semibold">{m.introTitle}</h2>
          <p className="mt-1 text-11 leading-relaxed text-(--ui-text-tertiary)">{m.introBody}</p>
        </div>
      </main>

      <aside className="w-[420px] shrink-0 border-l border-(--ui-stroke-quaternary) bg-(--ui-raised-background)">
        <BotContextPanel />
      </aside>
    </div>
  )
}
