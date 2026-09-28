/** Goals outline for the Team page: mission-first hierarchy, per-goal roll-up bars, owners,
 *  and Kanban task links. */

import { Badge, Button, cn, Codicon, host, Input } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { goalOutline, type GoalProgress, mutateTeam, progressLabel, seatName, type Team, type TeamGoal } from './team'
import { type TeamText } from './team-i18n'

const STATUS_ORDER = ['open', 'active', 'blocked', 'done', 'cancelled'] as const

function GoalRow({ depth, goal, progress, t, team }: { depth: number; goal: TeamGoal; progress?: GoalProgress; t: TeamText; team: Team }) {
  const [adding, setAdding] = useState<'' | 'sub' | 'task' | 'work'>('')
  const hired = team.members.filter(m => m.profile)
  const [assignee, setAssignee] = useState(goal.owner ?? hired[0]?.slot ?? '')
  const [draft, setDraft] = useState('')
  const settled = goal.status === 'done' || goal.status === 'cancelled'
  const owner = team.members.find(m => m.slot === goal.owner)

  const run = async (method: string, params: Record<string, unknown>) => {
    try {
      await mutateTeam(method, { team_id: team.id, ...params })
      setAdding('')
      setDraft('')
    } catch (err) {
      host.notifyError(err, 'Team')
    }
  }

  const percent = progress?.total ? progress.percent : goal.status === 'done' ? 100 : 0

  return (
    <li data-slot="team-goal" style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
      <div className="group/goal rounded-md px-2 py-2 hover:bg-(--ui-control-hover-background)">
        <div className="flex items-center gap-2">
          <select
            aria-label={t.goalStatus[goal.status as keyof typeof t.goalStatus] ?? goal.status}
            className="h-6 rounded border border-transparent bg-transparent text-[0.6875rem] text-(--ui-text-tertiary) hover:border-(--ui-stroke-tertiary)"
            onChange={e => void run('bots_team.goal.upsert', { goal_id: goal.id, status: e.target.value })}
            value={goal.status}
          >
            {STATUS_ORDER.map(s => (
              <option key={s} value={s}>
                {t.goalStatus[s]}
              </option>
            ))}
          </select>
          <span className={cn('min-w-0 flex-1 truncate text-[0.8125rem] text-(--ui-text-primary)', settled && 'line-through opacity-60')}>{goal.title}</span>
          {progress?.blocked && <Badge variant="muted">{t.goalStatus.blocked}</Badge>}
          {owner && <span className="hidden max-w-28 truncate text-[0.6875rem] text-(--ui-text-tertiary) sm:inline">{seatName(owner, t.openSeat)}</span>}
          <span className="w-24 shrink-0 text-right text-[0.6875rem] tabular-nums text-(--ui-text-tertiary)">{progressLabel(progress, t.goalNone)}</span>
          <span className="hidden gap-0.5 group-hover/goal:flex">
            <Button aria-label={t.subGoal} className="size-6" onClick={() => setAdding('sub')} size="icon" variant="ghost">
              <Codicon name="add" size="0.75rem" />
            </Button>
            <Button aria-label={t.assignWork} className="size-6" onClick={() => setAdding('work')} size="icon" variant="ghost">
              <Codicon name="rocket" size="0.75rem" />
            </Button>
            <Button aria-label={t.linkTask} className="size-6" onClick={() => setAdding('task')} size="icon" variant="ghost">
              <Codicon name="link" size="0.75rem" />
            </Button>
          </span>
        </div>
        <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-(--ui-control-background)">
          <div className="h-full rounded-full bg-(--ui-accent) transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
        {adding && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={e => {
              e.preventDefault()
              const value = draft.trim()

              if (value) {
                void (adding === 'sub'
                  ? run('bots_team.goal.upsert', { title: value, parent_id: goal.id })
                  : adding === 'work'
                    ? run('bots_team.goal.spawn_task', { assignee, goal_id: goal.id, title: value })
                    : run('bots_team.goal.link_task', { goal_id: goal.id, task_id: value }))
              }
            }}
          >
            {adding === 'work' && (
              <select
                aria-label={t.assignTo}
                className="h-8 max-w-40 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-control-background) px-2 text-[0.8125rem]"
                onChange={e => setAssignee(e.target.value)}
                value={assignee}
              >
                {hired.map(m => (
                  <option key={m.slot} value={m.slot}>
                    {seatName(m, t.openSeat)}
                  </option>
                ))}
              </select>
            )}
            <Input
              autoFocus
              onChange={e => setDraft(e.target.value)}
              placeholder={adding === 'sub' ? t.goalTitlePlaceholder : adding === 'work' ? t.assignWorkPlaceholder : t.taskId}
              value={draft}
            />
            <Button size="sm" type="submit">
              {t.save}
            </Button>
          </form>
        )}
      </div>
    </li>
  )
}

export function GoalsSection({ progress, t, team }: { progress: Record<string, GoalProgress>; t: TeamText; team: Team }) {
  const [title, setTitle] = useState('')
  const outline = goalOutline(team.goals)

  const add = async () => {
    const value = title.trim()

    if (!value) {
      return
    }

    try {
      await mutateTeam('bots_team.goal.upsert', { team_id: team.id, title: value })
      setTitle('')
    } catch (err) {
      host.notifyError(err, 'Team')
    }
  }

  return (
    <section aria-label={t.section.goals} data-slot="team-goals">
      <h3 className="mb-2 text-[0.8125rem] font-semibold text-(--ui-text-primary)">{t.section.goals}</h3>
      {team.mission && <p className="mb-2 px-2 text-[0.75rem] text-(--ui-text-tertiary)">{team.mission}</p>}
      <ul className="grid gap-0.5">
        {outline.map(({ depth, goal }) => (
          <GoalRow depth={depth} goal={goal} key={goal.id} progress={progress[goal.id]} t={t} team={team} />
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2 px-2"
        onSubmit={e => {
          e.preventDefault()
          void add()
        }}
      >
        <Input onChange={e => setTitle(e.target.value)} placeholder={t.goalTitlePlaceholder} value={title} />
        <Button size="sm" type="submit" variant="outline">
          {t.addGoal}
        </Button>
      </form>
    </section>
  )
}
