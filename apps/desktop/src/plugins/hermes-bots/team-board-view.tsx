/**
 * The goal-first team board (DESIGN.md rule 8): a goal bar ("what should the team do?",
 * totals, the Needs-you filter) over four columns — Queued, In progress, Needs approval,
 * Done — fed by `fork.team.board`. Selecting a template applies it through
 * `fork.team.templates.apply` with a per-click idempotency key. Inspect opens the card's
 * run stream and its computer in a right drawer without leaving the board.
 *
 * Pure SDK UI: no Electron APIs, so the same page mounts in a web-hosted client.
 */

import {
  Button,
  cn,
  Codicon,
  EmptyState,
  ErrorState,
  host,
  Input,
  isMissingRpcMethod,
  Loader,
  queryClient,
  StatusBadge,
  type StatusState,
  Tip,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useRef, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { $botMeta, useRoster } from './data'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import { BotComputerPanel } from './screen-panel'
import {
  applyTemplate,
  BOARD_COLUMNS,
  type BoardColumn,
  boardKey,
  columnState,
  countNeedsYou,
  fetchTemplates,
  filterNeedsYou,
  formatElapsed,
  formatMoney,
  formatTokens,
  newRequestId,
  resumeCard,
  startGoal,
  stopCard,
  takeOverCard,
  type TeamBoardCard,
  type TeamBoardResult,
  type TeamTemplate,
  toolState,
  useBoard
} from './team-board'
import { type TeamText } from './team-i18n'
import type { RosterRow } from './types'

const fail = (err: unknown) => host.notifyError(err, 'Team')

// ── faces ────────────────────────────────────────────────────────────────────────────────────

interface CardBot {
  color: null | string
  image: null | string
  label: string
  row: RosterRow
  shape: string
}

/** The bot behind a seat: real face, colour and friendly name when the roster knows it;
 *  a deterministic fallback look when it doesn't (fresh template profiles before a
 *  roster refresh). */
function useCardBot(profile: null | string | undefined): CardBot | null {
  const { data } = useRoster()
  const allMeta = useValue($botMeta)

  if (!profile) {
    return null
  }

  const bot = (data?.profiles ?? []).find((row: RosterRow) => row.name === profile) as RosterRow | undefined

  if (!bot) {
    const look = botAppearance(profile, null)

    return { color: look.color, image: look.image, label: profile, row: { name: profile }, shape: look.shape }
  }

  const meta = botRosterMeta(bot, allMeta)
  const look = botAppearance(bot.name, meta)

  return { color: look.color, image: look.image, label: displayName(bot, meta), row: bot, shape: look.shape }
}

function BotFaceInline({ profile, size = 20 }: { profile: null | string | undefined; size?: number }) {
  const face = useCardBot(profile)

  if (!face) {
    return null
  }

  return (
    <span aria-hidden="true" className="shrink-0">
      <BotFace
        color={avatarColor(face.color, profile ?? '')}
        image={face.image}
        name={profile ?? ''}
        shape={face.shape}
        size={size}
      />
    </span>
  )
}

// ── template picker (the empty state) ────────────────────────────────────────────────────────

function TemplateCard({
  onApplied,
  t,
  template
}: {
  onApplied: (teamId: string) => void
  t: TeamText
  template: TeamTemplate
}) {
  // The idempotency key is minted on the first click and reused until the apply
  // succeeds, so a retry after a failure can never create a second team.
  const requestId = useRef<null | string>(null)
  const [mapping, setMapping] = useState(false)
  const [assign, setAssign] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const { data: roster } = useRoster()

  const existing = (roster?.profiles ?? []).map((row: RosterRow) => row.name)

  const apply = async () => {
    setBusy(true)

    try {
      const mapped = Object.fromEntries(Object.entries(assign).filter(([, p]) => p))

      // Same request id on retry → the backend returns the team it already made.
      const res = await applyTemplate({
        assign: Object.keys(mapped).length ? mapped : undefined,
        request_id: (requestId.current ??= newRequestId()),
        template_id: template.template_id
      })

      requestId.current = null
      onApplied(res.team.id)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface p-4" data-slot="team-template">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-base font-semibold text-fg">{template.name}</h4>
        <span className="text-ui-xs text-fg-muted">{t.templateSeats(template.seats.length)}</span>
      </div>
      <p className="mt-1 text-ui-sm leading-relaxed text-fg-secondary">{template.description}</p>
      <ul className="mt-3 grid gap-1">
        {template.seats.map(seat => (
          <li className="flex items-center gap-2 text-ui-xs" key={seat.role}>
            {seat.lead ? (
              <span className="shrink-0 rounded-pill border border-line px-1.5 text-[0.625rem] font-medium text-fg-secondary">
                {t.lead}
              </span>
            ) : (
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-fg-subtle" />
            )}
            <span className="min-w-0 flex-1 truncate text-fg-secondary">{seat.title}</span>
          </li>
        ))}
      </ul>
      <Button className="mt-3 w-full" disabled={busy} onClick={() => void apply()}>
        <Codicon name="add" size="0.75rem" />
        {t.create}
      </Button>
      <button
        aria-expanded={mapping}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-row py-1 text-ui-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg-secondary"
        onClick={() => setMapping(m => !m)}
        type="button"
      >
        <Codicon name={mapping ? 'chevron-down' : 'chevron-right'} size="0.75rem" />
        {t.useExistingBots}
      </button>
      <div className="motion-collapse" data-open={mapping}>
        <div className="grid gap-2 pt-2">
          {template.seats.map(seat => (
            <label
              className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-2 text-ui-xs"
              key={seat.role}
            >
              <span className="truncate text-fg-muted">{seat.title}</span>
              <select
                aria-label={seat.title}
                className="h-7 rounded-control border border-line bg-surface px-1.5 text-ui-xs text-fg"
                onChange={e => setAssign(a => ({ ...a, [seat.role]: e.target.value }))}
                value={assign[seat.role] ?? ''}
              >
                <option value="">{t.newBot}</option>
                {existing.map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

export function TemplateCards({ onApplied, t }: { onApplied: (teamId: string) => void; t: TeamText }) {
  const {
    data,
    isPending,
    error,
    refetch
  } = useQuery({ queryFn: fetchTemplates, queryKey: ['hermes-bots', 'team-templates'] })

  if (isPending) {
    return <Loader />
  }

  if (error || !data?.length) {
    return (
      <ErrorState className="place-items-center p-6" description={t.templatesFailedBody} title={t.templatesFailed}>
        <Button onClick={() => void refetch()} size="sm" variant="secondary">
          {t.retry}
        </Button>
      </ErrorState>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4 p-6 sm:grid-cols-2" data-slot="team-templates">
      <div className="sm:col-span-2">
        <h3 className="text-lg font-semibold text-fg">{t.templatesTitle}</h3>
        <p className="mt-1 text-ui-sm leading-relaxed text-fg-secondary">{t.templatesBody}</p>
      </div>
      {data.map(tpl => (
        <TemplateCard key={tpl.template_id} onApplied={onApplied} t={t} template={tpl} />
      ))}
    </div>
  )
}

// ── the board ────────────────────────────────────────────────────────────────────────────────

function ToolPill({ tool }: { tool: { name: string; status: string } }) {
  const state: StatusState = toolState(tool.status)

  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-pill border border-line bg-surface px-2 py-0.5 text-ui-xs text-fg-secondary"
      data-slot="team-tool-pill"
    >
      <StatusBadge
        aria-label={tool.name}
        className={cn(state === 'running' && 'motion-ring text-(--ui-accent)')}
        state={state}
      />
      <span className="truncate">{tool.name}</span>
    </span>
  )
}

function BoardCard({
  card,
  handbackTo,
  onInspect,
  onResume,
  onStop,
  onTakeOver,
  t
}: {
  card: TeamBoardCard
  /** undefined: never taken over (Take over shows); null/string: taken over (Hand back shows). */
  handbackTo?: null | string
  onInspect: (card: TeamBoardCard) => void
  onResume: (card: TeamBoardCard) => void
  onStop: (card: TeamBoardCard) => void
  onTakeOver: (card: TeamBoardCard) => void
  t: TeamText
}) {
  const reason = card.needs_you ? t.reason[card.needs_you as keyof typeof t.reason] : undefined
  const state = columnState(card.column)

  return (
    <div className="rounded-card border border-line bg-surface p-2.5" data-slot="team-card" data-task-id={card.task_id}>
      <div className="flex items-start gap-1.5">
        <StatusBadge
          aria-label={t.column[card.column as keyof typeof t.column] ?? card.column}
          className={cn('mt-1.5', state === 'running' && 'motion-ring text-(--ui-accent)')}
          state={state}
        />
        <p className="min-w-0 flex-1 text-ui-sm font-medium leading-snug text-fg">{card.title}</p>
      </div>
      {card.assignee && (
        <p className="mt-1.5 flex items-center gap-1.5 text-ui-xs text-fg-secondary">
          <BotFaceInline profile={card.assignee.profile} />
          <span className="min-w-0 truncate">{card.assignee.title || card.assignee.profile}</span>
        </p>
      )}
      {(card.last_tool || reason) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {card.last_tool ? <ToolPill tool={card.last_tool} /> : null}
          {reason ? (
            <span
              className="inline-flex items-center rounded-pill bg-surface-raised px-2 py-0.5 text-ui-xs font-medium text-warning"
              data-slot="team-needs-you"
            >
              {reason}
            </span>
          ) : null}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 font-mono text-ui-2xs tabular-nums text-fg-muted">
        <span>{formatElapsed(card.elapsed_s)}</span>
        <span aria-hidden>·</span>
        <span>{formatTokens(card.tokens)}</span>
        <span aria-hidden>·</span>
        <span>{formatMoney(card.cost_usd)}</span>
      </div>
      <div className="mt-2 flex items-center gap-1">
        {card.stoppable && (
          <Button data-slot="team-card-stop" onClick={() => onStop(card)} size="xs" variant="ghost">
            {t.stop}
          </Button>
        )}
        {card.takeable && handbackTo === undefined && (
          <Button data-slot="team-card-takeover" onClick={() => onTakeOver(card)} size="xs" variant="ghost">
            {t.takeOver}
          </Button>
        )}
        {handbackTo !== undefined && (
          <Button data-slot="team-card-handback" onClick={() => onResume(card)} size="xs" variant="ghost">
            {t.handBack}
          </Button>
        )}
        <span className="flex-1" />
        <Tip label={t.inspect}>
          <Button aria-label={t.inspect} data-slot="team-card-inspect" onClick={() => onInspect(card)} size="icon-xs" variant="ghost">
            <Codicon name="inspect" size="0.875rem" />
          </Button>
        </Tip>
      </div>
    </div>
  )
}

function BoardColumns({
  board,
  handbacks,
  onInspect,
  onResume,
  onStop,
  onTakeOver,
  t
}: {
  board: TeamBoardResult
  handbacks: Record<string, null | string>
  onInspect: (card: TeamBoardCard) => void
  onResume: (card: TeamBoardCard) => void
  onStop: (card: TeamBoardCard) => void
  onTakeOver: (card: TeamBoardCard) => void
  t: TeamText
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" data-slot="team-board">
      {BOARD_COLUMNS.map((column: BoardColumn) => {
        const cards = board.cards.filter(c => c.column === column)

        return (
          <section
            aria-label={t.column[column]}
            className="min-w-0"
            data-column={column}
            data-slot="team-board-column"
            key={column}
          >
            <header className="mb-2 flex items-center gap-1.5 px-0.5">
              <StatusBadge state={columnState(column)} />
              <h4 className="text-ui-xs font-semibold text-fg-secondary">{t.column[column]}</h4>
              <span className="font-mono text-ui-2xs tabular-nums text-fg-subtle">{cards.length}</span>
            </header>
            <div className="grid gap-2">
              {cards.map(card => (
                <BoardCard
                  card={card}
                  handbackTo={card.task_id in handbacks ? handbacks[card.task_id] : undefined}
                  key={card.task_id}
                  onInspect={onInspect}
                  onResume={onResume}
                  onStop={onStop}
                  onTakeOver={onTakeOver}
                  t={t}
                />
              ))}
              {cards.length === 0 && (
                <div className="rounded-card border border-dashed border-line px-2.5 py-4 text-center text-ui-2xs text-fg-subtle">
                  {t.columnEmpty}
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function GoalBar({
  board,
  needsYouOnly,
  onNeedsYouToggle,
  onStart,
  t
}: {
  board: TeamBoardResult | undefined
  needsYouOnly: boolean
  onNeedsYouToggle: () => void
  onStart: (title: string) => void
  t: TeamText
}) {
  const [title, setTitle] = useState('')
  const totals = board?.totals
  const goal = board?.goal

  const submit = () => {
    const value = title.trim()

    if (value) {
      onStart(value)
      setTitle('')
    }
  }

  return (
    <header className="grid gap-2 border-b border-line px-4 py-3" data-slot="team-goal-bar">
      {goal?.title ? (
        <p className="text-ui-xs text-fg-muted" data-slot="team-goal-active">
          {t.goalLabel}: <span className="font-medium text-fg-secondary">{goal.title}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          <Input aria-label={t.goalAsk} onChange={e => setTitle(e.target.value)} placeholder={t.goalAsk} value={title} />
          <Button disabled={!title.trim()} size="sm" type="submit">
            {t.startGoal}
          </Button>
        </form>
        <span className="flex items-center gap-2 text-ui-xs text-fg-muted" data-slot="team-goal-totals">
          <span>{t.cost}</span>
          <span className="font-mono tabular-nums text-fg-secondary">{formatMoney(totals?.cost_usd)}</span>
          <span aria-hidden>·</span>
          <span>{t.tokens}</span>
          <span className="font-mono tabular-nums text-fg-secondary">{formatTokens(totals?.tokens)}</span>
        </span>
        <Button
          aria-pressed={needsYouOnly}
          onClick={onNeedsYouToggle}
          size="sm"
          variant={needsYouOnly ? 'default' : 'outline'}
        >
          {t.needsYouFilter(countNeedsYou(board?.cards ?? []))}
        </Button>
      </div>
    </header>
  )
}

// ── the inspect drawer ───────────────────────────────────────────────────────────────────────

interface StreamRow {
  role: string
  row_id: number | null
  text: null | string
}

/** The card's run transcript, read through the same `session.history` projection every
 *  renderer uses, addressed at the bot's own profile. Polls while the drawer is open. */
function CardStream({ card, t }: { card: TeamBoardCard; t: TeamText }) {
  const {
    data,
    isPending,
    error
  } = useQuery({
    enabled: Boolean(card.session_id),
    queryFn: () =>
      host.request<{ messages: StreamRow[] }>('session.history', {
        profile: card.assignee?.profile ?? null,
        session_id: card.session_id
      }),
    queryKey: ['hermes-bots', 'card-stream', card.assignee?.profile, card.session_id],
    refetchInterval: 3000
  })

  if (!card.session_id) {
    return <p className="px-3 py-2 text-ui-xs text-fg-muted">{t.streamNone}</p>
  }

  if (isPending) {
    return <Loader />
  }

  if (error) {
    return <p className="px-3 py-2 text-ui-xs text-danger">{t.streamFailed}</p>
  }

  const rows = (data?.messages ?? []).filter(m => m.text)

  if (!rows.length) {
    return <p className="px-3 py-2 text-ui-xs text-fg-muted">{t.streamEmpty}</p>
  }

  return (
    <ol className="grid gap-2 px-3 py-2" data-slot="team-card-stream">
      {rows.map((row, i) => (
        <li className="grid gap-0.5" key={row.row_id ?? i}>
          <span className="text-ui-2xs uppercase tracking-wide text-fg-subtle">{row.role}</span>
          <p className="wrap-anywhere text-ui-xs leading-relaxed text-fg-secondary">{row.text}</p>
        </li>
      ))}
    </ol>
  )
}

function InspectDrawer({ card, onClose, t }: { card: TeamBoardCard; onClose: () => void; t: TeamText }) {
  const face = useCardBot(card.assignee?.profile)

  return (
    <aside
      aria-label={t.inspect}
      className="flex w-[26rem] min-h-0 shrink-0 flex-col border-l border-line bg-surface"
      data-slot="team-inspect-drawer"
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <BotFaceInline profile={card.assignee?.profile} size={24} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui-sm font-medium text-fg">{face?.label ?? card.assignee?.profile}</p>
          <p className="truncate text-ui-xs text-fg-muted">{card.title}</p>
        </div>
        <Tip label={t.close}>
          <Button aria-label={t.close} onClick={onClose} size="icon-xs" variant="ghost">
            <Codicon name="close" size="0.875rem" />
          </Button>
        </Tip>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <h4 className="px-3 pb-1 pt-3 text-ui-2xs uppercase tracking-wide text-fg-subtle">{t.streamTitle}</h4>
        <CardStream card={card} t={t} />
        <h4 className="border-t border-line px-3 pb-1 pt-3 text-ui-2xs uppercase tracking-wide text-fg-subtle">
          {t.computer}
        </h4>
        <div className="p-2">
          <BotComputerPanel bot={face?.row ?? { name: card.assignee?.profile ?? '' }} />
        </div>
      </div>
    </aside>
  )
}

// ── the page body ────────────────────────────────────────────────────────────────────────────

/** The board lives on `fork.team.board` for one team; secondary surfaces pass through `more`. */
export function TeamBoard({ more, t, teamId }: { more?: React.ReactNode; t: TeamText; teamId: string }) {
  const [needsYouOnly, setNeedsYouOnly] = useState(false)
  const [inspectId, setInspectId] = useState<null | string>(null)
  // task_id → the profile to hand the card back to after a takeover.
  const [handbacks, setHandbacks] = useState<Record<string, null | string>>({})

  const {
    data: board,
    isPending,
    error,
    refetch
  } = useBoard(teamId)

  const refresh = () => {
    void queryClient?.invalidateQueries?.({ queryKey: boardKey(teamId) })?.catch?.(() => {})
  }

  const run = async (work: () => Promise<unknown>) => {
    try {
      await work()
    } catch (err) {
      fail(err)
    } finally {
      refresh()
    }
  }

  const onStop = (card: TeamBoardCard) => void run(() => stopCard(card.task_id))

  const onTakeOver = (card: TeamBoardCard) => {
    setHandbacks(h => ({ ...h, [card.task_id]: card.assignee?.profile ?? null }))
    setInspectId(card.task_id)
    void run(() => takeOverCard(card.task_id))
  }

  const onResume = (card: TeamBoardCard) => {
    const assignee = handbacks[card.task_id]

    setHandbacks(({ [card.task_id]: _dropped, ...rest }) => rest)

    return void run(() => resumeCard(card.task_id, assignee))
  }

  if (isPending) {
    return <Loader />
  }

  if (isMissingRpcMethod(error)) {
    return <EmptyState className="place-items-center p-6" description={t.boardUnavailableBody} title={t.boardUnavailable} />
  }

  if (error || !board) {
    return (
      <ErrorState className="place-items-center p-6" description={t.loadFailedBody} title={t.loadFailed}>
        <Button onClick={() => void refetch()} size="sm" variant="secondary">
          {t.retry}
        </Button>
      </ErrorState>
    )
  }

  const visible = filterNeedsYou(board.cards, needsYouOnly)
  const inspect = inspectId ? board.cards.find(c => c.task_id === inspectId) : undefined

  return (
    <div className="flex h-full min-h-0" data-slot="team-board-page">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GoalBar
          board={board}
          needsYouOnly={needsYouOnly}
          onNeedsYouToggle={() => setNeedsYouOnly(v => !v)}
          onStart={title => void run(() => startGoal(teamId, title))}
          t={t}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {board.cards.length === 0 ? (
            <div className="mx-auto max-w-xl">
              <EmptyState className="place-items-center p-6" description={t.boardEmptyBody} title={t.boardEmpty} />
            </div>
          ) : (
            <BoardColumns
              board={{ ...board, cards: visible }}
              handbacks={handbacks}
              onInspect={card => setInspectId(card.task_id)}
              onResume={onResume}
              onStop={onStop}
              onTakeOver={onTakeOver}
              t={t}
            />
          )}
          {more && (
            <section className="mt-6" data-slot="team-more">
              {more}
            </section>
          )}
        </div>
      </div>
      {inspect && <InspectDrawer card={inspect} onClose={() => setInspectId(null)} t={t} />}
    </div>
  )
}
