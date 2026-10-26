/**
 * Squads — role-staffed runs on this board (`hermes kanban squad`). The panel
 * shows the team, starts a squad from a playbook, and follows each run as
 * lanes: one per step, live from the step's own card. Every lane IS a kanban
 * task, so a click opens the normal task modal; nothing here bypasses the board.
 */

import {
  Badge,
  Button,
  cn,
  Codicon,
  host,
  isSubmitEnter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useMutation,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import {
  $boardSlug,
  fetchSquadRoles,
  fetchSquadRun,
  fetchSquadRuns,
  fetchSquadTemplates,
  postSquadNote,
  setUpSquadRole,
  squadRolesKey,
  squadRunKey,
  squadRunsKey,
  squadsKeyPrefix,
  squadTemplatesKey,
  startSquad,
  useKanbanScope
} from './api'
import type { SquadLane, SquadRole, SquadRun, SquadRunSummary, SquadState, SquadTemplate } from './types'
import { columnMeta } from './types'
import { ago, columnLabel, errText, FIELD_LABEL, useKanban } from './ui'

const STATE_VARIANT: Record<SquadState, 'default' | 'muted' | 'success' | 'warn'> = {
  attention: 'warn',
  done: 'success',
  queued: 'muted',
  running: 'default'
}

type RoleMap = Record<string, SquadRole>

function useRoles(): RoleMap {
  const scope = useKanbanScope()
  const { data } = useQuery({ queryKey: squadRolesKey(scope), queryFn: fetchSquadRoles, staleTime: 30_000 })

  return Object.fromEntries((data?.roles ?? []).map(role => [role.id, role]))
}

function useInvalidateSquads() {
  const qc = useQueryClient()
  const scope = useKanbanScope()

  return () => void qc.invalidateQueries({ queryKey: squadsKeyPrefix(scope) })
}

function StateBadge({ state }: { state: SquadState }) {
  const k = useKanban()

  return (
    <Badge size="xs" variant={STATE_VARIANT[state]}>
      {k.squads.state[state]}
    </Badge>
  )
}

// ── team ─────────────────────────────────────────────────────────────────────

function RoleChip({ role }: { role: SquadRole }) {
  const k = useKanban()
  const invalidate = useInvalidateSquads()

  const setUp = useMutation({
    mutationFn: () => setUpSquadRole(role.id),
    onError: err => host.notify({ kind: 'error', message: errText(err) }),
    onSuccess: result => {
      host.notify({ kind: 'success', message: k.squads.setUpDone(result.profile) })
      invalidate()
    }
  })

  return (
    <li
      className="flex min-w-0 items-center gap-1.5 rounded-md bg-(--ui-bg-quaternary) px-2 py-1 text-[0.71875rem]"
      title={role.summary}
    >
      <span aria-hidden>{role.emoji}</span>
      <span className="truncate font-medium text-foreground">{role.name}</span>
      {role.bot_exists ? (
        <span className="text-[0.625rem] text-(--ui-text-quaternary)">{k.squads.ready}</span>
      ) : (
        <Button disabled={setUp.isPending} onClick={() => setUp.mutate()} size="xs" variant="ghost">
          {k.squads.setUp}
        </Button>
      )}
    </li>
  )
}

function Team({ roles }: { roles: SquadRole[] }) {
  const k = useKanban()

  return (
    <section className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL}>{k.squads.team}</span>
      <ul aria-label={k.squads.team} className="flex flex-wrap gap-1.5">
        {roles.map(role => (
          <RoleChip key={role.id} role={role} />
        ))}
      </ul>
    </section>
  )
}

// ── start ────────────────────────────────────────────────────────────────────

function StepChain({ roles, template }: { roles: RoleMap; template: SquadTemplate }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[0.6875rem] text-(--ui-text-tertiary)">
      {template.steps.map((step, index) => (
        <li className="flex items-center gap-1" key={step.key}>
          {index > 0 && <Codicon name="arrow-right" size="0.6rem" />}
          <span aria-hidden>{roles[step.role]?.emoji}</span>
          <span>{step.title}</span>
        </li>
      ))}
    </ol>
  )
}

function StartSquad({ onStarted, roles }: { onStarted: (id: string) => void; roles: RoleMap }) {
  const k = useKanban()
  const scope = useKanbanScope()
  const invalidate = useInvalidateSquads()
  const { data } = useQuery({ queryKey: squadTemplatesKey(scope), queryFn: fetchSquadTemplates, staleTime: 60_000 })
  const templates = data?.templates ?? []
  const [picked, setPicked] = useState('')
  const [goal, setGoal] = useState('')
  const template = templates.find(item => item.id === picked) ?? templates[0]

  const start = useMutation({
    mutationFn: () => startSquad(template!.id, goal.trim()),
    onError: err => host.notify({ kind: 'error', message: errText(err) }),
    onSuccess: ({ run }) => {
      host.notify({ kind: 'success', message: k.squads.started(run.template_name) })
      setGoal('')
      invalidate()
      onStarted(run.id)
    }
  })

  const canStart = Boolean(template) && goal.trim().length > 0 && !start.isPending

  const submit = () => {
    if (canStart) {
      start.mutate()
    }
  }

  return (
    <section aria-label={k.squads.start} className="flex flex-col gap-2">
      <span className={FIELD_LABEL}>{k.squads.start}</span>
      <div className="flex flex-wrap items-start gap-2">
        <Select onValueChange={setPicked} value={template?.id ?? ''}>
          <SelectTrigger aria-label={k.squads.template} className="w-44">
            <SelectValue placeholder={k.squads.template} />
          </SelectTrigger>
          <SelectContent>
            {templates.map(item => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          aria-label={k.squads.goal}
          className="field-sizing-content max-h-32 min-h-8 min-w-64 flex-1 resize-none text-[0.75rem]"
          onChange={event => setGoal(event.target.value)}
          onKeyDown={event => {
            if (isSubmitEnter(event) && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={k.squads.goalPlaceholder}
          value={goal}
        />
        <Button disabled={!canStart} onClick={submit} size="sm">
          <Codicon name="rocket" size="0.8rem" />
          {k.squads.launch}
        </Button>
      </div>
      {template && (
        <div className="flex flex-col gap-0.5">
          <p className="text-[0.6875rem] text-(--ui-text-secondary)">{template.summary}</p>
          <StepChain roles={roles} template={template} />
        </div>
      )}
      <p className="text-[0.625rem] text-(--ui-text-quaternary)">{k.squads.setupNote}</p>
    </section>
  )
}

// ── runs ─────────────────────────────────────────────────────────────────────

function RunRow({ onOpen, run }: { onOpen: (id: string) => void; run: SquadRunSummary }) {
  const k = useKanban()

  return (
    <li>
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.75rem] transition-colors hover:bg-(--chrome-action-hover)"
        onClick={() => onOpen(run.id)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate text-foreground">{run.goal || run.title}</span>
        <span className="shrink-0 text-[0.6875rem] text-(--ui-text-tertiary)">{run.template_name}</span>
        <span className="shrink-0 tabular-nums text-[0.6875rem] text-(--ui-text-quaternary)">
          {k.squads.progress(run.done, run.total)}
        </span>
        <StateBadge state={run.state} />
      </button>
    </li>
  )
}

function RunList({ onOpen }: { onOpen: (id: string) => void }) {
  const k = useKanban()
  const scope = useKanbanScope()
  const slug = useValue($boardSlug)
  const { data } = useQuery({ queryKey: squadRunsKey(scope, slug), queryFn: fetchSquadRuns, refetchInterval: 15_000 })
  const runs = data?.runs ?? []

  return (
    <section className="flex flex-col gap-1">
      <span className={FIELD_LABEL}>{k.squads.runs}</span>
      {runs.length === 0 ? (
        <p className="text-[0.6875rem] text-(--ui-text-quaternary)">{k.squads.noRuns}</p>
      ) : (
        <ul aria-label={k.squads.runs} className="flex flex-col">
          {runs.map(run => (
            <RunRow key={run.id} onOpen={onOpen} run={run} />
          ))}
        </ul>
      )}
    </section>
  )
}

// ── one run: lanes + notes ───────────────────────────────────────────────────

function laneHint(lane: SquadLane, run: SquadRun, k: ReturnType<typeof useKanban>): null | string {
  if (lane.status !== 'todo' || lane.needs.length === 0) {
    return null
  }

  const waiting = run.lanes.filter(other => lane.needs.includes(other.key) && other.status !== 'done')

  return waiting.length ? k.squads.waitingOn(waiting.map(other => other.title).join(', ')) : null
}

function Lane({
  lane,
  onOpenTask,
  role,
  run
}: {
  lane: SquadLane
  onOpenTask: (id: string) => void
  role?: SquadRole
  run: SquadRun
}) {
  const k = useKanban()
  const meta = columnMeta(lane.status)
  const hint = laneHint(lane, run, k)

  return (
    <li className="w-56 shrink-0">
      <button
        aria-label={k.squads.openTask(lane.title)}
        className={cn(
          'flex h-full w-full flex-col gap-1.5 rounded-lg border border-(--ui-stroke-tertiary) p-2 text-left transition-colors hover:bg-(--chrome-action-hover)',
          lane.final && 'border-(--ui-stroke-secondary)'
        )}
        onClick={() => onOpenTask(lane.task_id)}
        type="button"
      >
        <span className="flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-tertiary)">
          <span aria-hidden>{role?.emoji}</span>
          <span className="truncate">{role?.name ?? lane.role}</span>
          {lane.final && <span className="ml-auto text-(--ui-text-quaternary)">{k.squads.final}</span>}
        </span>
        <span className="text-[0.75rem] font-medium text-foreground">{lane.title}</span>
        <span className="flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-secondary)">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.tone }} />
          {columnLabel(k, lane.status)}
          <span className="truncate text-(--ui-text-quaternary)">{lane.assignee ?? lane.profile}</span>
        </span>
        {hint && <span className="text-[0.625rem] text-(--ui-text-quaternary)">{hint}</span>}
        {lane.last_failure_error && (
          <span className="line-clamp-3 text-[0.6875rem] text-(--destructive,#f87171)">{lane.last_failure_error}</span>
        )}
        {lane.result && (
          <span className="line-clamp-4 whitespace-pre-wrap text-[0.6875rem] text-(--ui-text-secondary)">
            {lane.result}
          </span>
        )}
      </button>
    </li>
  )
}

function Notes({ run }: { run: SquadRun }) {
  const k = useKanban()
  const invalidate = useInvalidateSquads()
  const [body, setBody] = useState('')

  const send = useMutation({
    mutationFn: () => postSquadNote(run.id, body.trim()),
    onError: err => host.notify({ kind: 'error', message: errText(err) }),
    onSuccess: () => {
      setBody('')
      invalidate()
    }
  })

  const submit = () => {
    if (body.trim() && !send.isPending) {
      send.mutate()
    }
  }

  return (
    <section className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL}>{k.squads.notes}</span>
      {run.notes.length === 0 ? (
        <p className="text-[0.6875rem] text-(--ui-text-quaternary)">{k.squads.noNotes}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {run.notes.map(note => (
            <li className="text-[0.71875rem]" key={note.id}>
              <span className="font-medium text-(--ui-text-secondary)">{note.author}</span>{' '}
              <span className="text-(--ui-text-quaternary)">{ago(note.created_at)}</span>
              <p className="whitespace-pre-wrap text-foreground">{note.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2">
        <Textarea
          aria-label={k.squads.notePlaceholder}
          className="field-sizing-content max-h-32 min-h-8 flex-1 resize-none text-[0.75rem]"
          onChange={event => setBody(event.target.value)}
          onKeyDown={event => {
            if (isSubmitEnter(event) && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={k.squads.notePlaceholder}
          value={body}
        />
        <Button disabled={!body.trim() || send.isPending} onClick={submit} size="sm" variant="outline">
          {k.squads.send}
        </Button>
      </div>
    </section>
  )
}

function RunView({ id, onBack, onOpenTask }: { id: string; onBack: () => void; onOpenTask: (id: string) => void }) {
  const k = useKanban()
  const scope = useKanbanScope()
  const slug = useValue($boardSlug)
  const roles = useRoles()

  const { data } = useQuery({
    queryKey: squadRunKey(scope, slug, id),
    queryFn: () => fetchSquadRun(id),
    refetchInterval: 8_000
  })

  const run = data?.run

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button onClick={onBack} size="xs" variant="ghost">
          <Codicon name="arrow-left" size="0.75rem" />
          {k.squads.back}
        </Button>
        {run && (
          <>
            <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-foreground">{run.goal}</span>
            <span className="tabular-nums text-[0.6875rem] text-(--ui-text-tertiary)">
              {k.squads.progress(run.done, run.total)}
            </span>
            <StateBadge state={run.state} />
          </>
        )}
      </div>
      {run && (
        <>
          <ol aria-label={run.template_name} className="flex gap-2 overflow-x-auto pb-1">
            {run.lanes.map(lane => (
              <Lane key={lane.key} lane={lane} onOpenTask={onOpenTask} role={roles[lane.role]} run={run} />
            ))}
          </ol>
          <Notes run={run} />
        </>
      )}
    </div>
  )
}

// ── panel ────────────────────────────────────────────────────────────────────

/** The board-header button that shows or hides the panel. */
export function SquadsToggle({ onToggle, open }: { onToggle: () => void; open: boolean }) {
  const k = useKanban()

  return (
    <Button
      aria-pressed={open}
      className={cn(open && 'bg-(--ui-control-active-background) text-foreground')}
      onClick={onToggle}
      size="sm"
      variant="ghost"
    >
      <Codicon name="rocket" size="0.8rem" />
      {k.squads.toggle}
    </Button>
  )
}

export function SquadsPanel({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const k = useKanban()
  const roles = useRoles()
  const [runId, setRunId] = useState<null | string>(null)

  return (
    <div
      aria-label={k.squads.title}
      className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto border-t border-(--ui-stroke-tertiary) px-4 py-3"
      role="region"
    >
      {runId ? (
        <RunView id={runId} onBack={() => setRunId(null)} onOpenTask={onOpenTask} />
      ) : (
        <>
          <p className="text-[0.71875rem] text-(--ui-text-secondary)">{k.squads.intro}</p>
          <Team roles={Object.values(roles)} />
          <StartSquad onStarted={setRunId} roles={roles} />
          <RunList onOpen={setRunId} />
        </>
      )}
    </div>
  )
}
