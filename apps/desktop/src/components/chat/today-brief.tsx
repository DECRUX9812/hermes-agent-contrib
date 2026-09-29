import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router'

import { openSession } from '@/app/open-session'
import { CRON_ROUTE } from '@/app/routes'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { relativeTime } from '@/lib/time'
import { type BriefCardId, deriveTodayBrief } from '@/lib/today-brief'
import { cn } from '@/lib/utils'
import { $cronJobs } from '@/store/cron'
import { $sessions } from '@/store/session'
import { $sessionDotStateById } from '@/store/session-dot-state'
import type { CronJob, SessionInfo } from '@/types/hermes'

/** Card chrome per concern: the glyph and the tone its count badge wears. */
const CARD_STYLE: Record<BriefCardId, { icon: string; tone: string }> = {
  needsYou: { icon: 'bell-dot', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  running: { icon: 'loading', tone: 'bg-(--ui-accent)/12 text-(--ui-accent)' },
  finished: { icon: 'check-all', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  scheduled: { icon: 'calendar', tone: 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary)' },
  recent: { icon: 'history', tone: 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary)' }
}

function BriefCard({
  children,
  count,
  id,
  title
}: {
  children: React.ReactNode
  count: number
  id: BriefCardId
  title: string
}) {
  const style = CARD_STYLE[id]

  return (
    <section
      className="flex min-w-0 flex-col gap-1 rounded-xl bg-(--ui-widget-surface-background) p-2 text-left animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
      data-brief-card={id}
    >
      <header className="flex items-center gap-2 px-1.5 pt-0.5 pb-1">
        <span className={cn('grid size-6 shrink-0 place-items-center rounded-lg', style.tone)}>
          <Codicon name={style.icon} size="0.8rem" spinning={id === 'running'} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-foreground">{title}</span>
        <span className="text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)">{count}</span>
      </header>
      {children}
    </section>
  )
}

function BriefRow({ meta, onOpen, title }: { meta: string; onOpen: () => void; title: string }) {
  return (
    <button
      className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[0.8125rem] text-(--ui-text-secondary) transition-colors hover:bg-(--ui-control-hover-background) hover:text-foreground"
      onClick={() => {
        triggerHaptic('selection')
        onOpen()
      }}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">{meta}</span>
    </button>
  )
}

const sessionMs = (session: SessionInfo) => (session.last_active || session.started_at || 0) * 1000

/**
 * The empty chat's "Today": what needs you, what is running, what finished
 * while you were away, and what runs next — a handful of cards over the
 * signals the sidebar already tracks (lib/today-brief.ts). Cards with nothing
 * to say are not drawn; an entirely quiet day shows where you left off.
 */
export function TodayBrief() {
  const { t } = useI18n()
  const b = t.todayBrief
  const navigate = useNavigate()
  const sessions = useStore($sessions)
  const dotById = useStore($sessionDotStateById)
  const cronJobs = useStore($cronJobs)
  const brief = deriveTodayBrief({ cronJobs, dotById, sessions })

  const sessionTitle = (session: SessionInfo) =>
    session.title || session.preview || t.sidebar.row.untitledChat(session.id.slice(0, 8))

  const sessionRows = (list: SessionInfo[]) =>
    list.map(session => (
      <BriefRow
        key={session.id}
        meta={relativeTime(sessionMs(session))}
        onOpen={() => openSession(session.id, navigate, 'in-place')}
        title={sessionTitle(session)}
      />
    ))

  const jobRows = (list: CronJob[]) =>
    list.map(job => (
      <BriefRow
        key={job.id}
        meta={job.next_run_at ? relativeTime(Date.parse(job.next_run_at)) : ''}
        onOpen={() => navigate(CRON_ROUTE)}
        title={job.name || job.prompt || job.id}
      />
    ))

  const cards: { id: BriefCardId; rows: React.ReactNode[]; title: string }[] = [
    { id: 'needsYou', rows: sessionRows(brief.needsYou), title: b.needsYou },
    { id: 'running', rows: sessionRows(brief.running), title: b.running },
    { id: 'finished', rows: sessionRows(brief.finished), title: b.finished },
    { id: 'scheduled', rows: jobRows(brief.scheduled), title: b.scheduled },
    { id: 'recent', rows: sessionRows(brief.recent), title: b.recent }
  ]

  const shown = cards.filter(card => card.rows.length > 0)

  if (!shown.length) {
    return null
  }

  return (
    <div className={cn('mt-6 grid w-full gap-2', shown.length > 1 && 'sm:grid-cols-2')} data-slot="today-brief">
      {shown.map(card => (
        <BriefCard count={brief.totals[card.id]} id={card.id} key={card.id} title={card.title}>
          {card.rows}
        </BriefCard>
      ))}
    </div>
  )
}
