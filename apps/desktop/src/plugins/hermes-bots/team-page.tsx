/**
 * The Team home — `/team`. One page, three questions: who is on the team and what are they
 * on the hook for (org chart + budgets), how far along are the goals (roll-up of the linked
 * Kanban tasks), and what needs a human (approvals). Simple mode shows exactly that; Advanced
 * adds the audit trail, the approval policy, IDs and Team Pack import/export.
 *
 * SDK-only and Electron-free by construction, so the same page mounts in a web-hosted client.
 */

import {
  Button,
  cn,
  Codicon,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  host,
  Input,
  Loader,
  Switch,
  Textarea,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import {
  $selectedTeamId,
  addLearning,
  createTeam,
  mutateTeam,
  pendingApprovals,
  type Team,
  type TeamAuditEntry,
  topLearnings,
  useTeam,
  useTeams
} from './team'
import { GoalsSection } from './team-goals'
import { type TeamText, useTeamText } from './team-i18n'
import { Field, OrgChart } from './team-org'

const fail = (err: unknown) => host.notifyError(err, 'Team')

function CreateTeamDialog({ onClose, open, t }: { onClose: () => void; open: boolean; t: TeamText }) {
  const [name, setName] = useState('')
  const [mission, setMission] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)

    try {
      const view = await createTeam({ mission, name })
      $selectedTeamId.set(view.team.id)
      setName('')
      setMission('')
      onClose()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog onOpenChange={o => !o && onClose()} open={open}>
      <DialogContent className="max-w-md">
        <form
          className="grid gap-3"
          onSubmit={e => {
            e.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.createTitle}</DialogTitle>
          </DialogHeader>
          <Field label={t.createName}>
            <Input autoFocus onChange={e => setName(e.target.value)} placeholder={t.createNamePlaceholder} value={name} />
          </Field>
          <Field label={t.createMission}>
            <Textarea onChange={e => setMission(e.target.value)} placeholder={t.createMissionPlaceholder} rows={3} value={mission} />
          </Field>
          <DialogFooter>
            <Button disabled={busy || !name.trim()} type="submit">
              {t.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Approvals({ t, team }: { t: TeamText; team: Team }) {
  const pending = pendingApprovals(team)

  if (pending.length === 0) {
    return null
  }

  const decide = (id: string, approve: boolean) =>
    void mutateTeam('bots_team.approval.decide', { team_id: team.id, approval_id: id, approve }).catch(fail)

  return (
    <section
      aria-label={t.section.approvals}
      className="rounded-lg border border-(--ui-accent) bg-(--ui-control-background) p-3"
      data-slot="team-approvals"
    >
      <h3 className="mb-2 text-[0.8125rem] font-semibold text-(--ui-text-primary)">{t.section.approvals}</h3>
      <ul className="grid gap-2">
        {pending.map(a => (
          <li className="flex items-center gap-3" key={a.id}>
            <span className="rounded bg-(--ui-control-active-background) px-1.5 py-0.5 text-[0.6875rem] font-medium text-(--ui-text-secondary)">
              {t.kind[a.kind as keyof typeof t.kind] ?? a.kind}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] text-(--ui-text-primary)">{a.subject}</span>
              <span className="block truncate text-[0.6875rem] text-(--ui-text-tertiary)">
                {t.requestedBy(a.requested_by)}
                {a.detail ? ` — ${a.detail}` : ''}
              </span>
            </span>
            <Button onClick={() => decide(a.id, false)} size="sm" variant="ghost">
              {t.reject}
            </Button>
            <Button onClick={() => decide(a.id, true)} size="sm">
              {t.approve}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Learnings({ t, team }: { t: TeamText; team: Team }) {
  const [text, setText] = useState('')
  const items = topLearnings(team.learnings)

  const add = async () => {
    if (!text.trim()) {
      return
    }

    try {
      await addLearning(team.id, text)
      setText('')
    } catch (err) {
      fail(err)
    }
  }

  return (
    <section aria-label={t.section.learnings} data-slot="team-learnings">
      <h3 className="mb-2 text-[0.8125rem] font-semibold text-(--ui-text-primary)">{t.section.learnings}</h3>
      {items.length === 0 ? (
        <p className="text-[0.75rem] text-(--ui-text-tertiary)">{t.learningsEmpty}</p>
      ) : (
        <ul className="grid gap-1">
          {items.map(l => (
            <li className="group/l flex items-baseline gap-2 text-[0.8125rem] text-(--ui-text-secondary)" key={l.id}>
              <span className="min-w-0 flex-1">{l.text}</span>
              {l.count > 1 && <span className="text-[0.6875rem] text-(--ui-text-quaternary)">{t.confirmed(l.count)}</span>}
              <Button
                aria-label={t.remove}
                className="hidden size-5 group-hover/l:inline-flex"
                onClick={() => void mutateTeam('bots_team.learning.remove', { team_id: team.id, learning_id: l.id }).catch(fail)}
                size="icon"
                variant="ghost"
              >
                <Codicon name="close" size="0.625rem" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={e => {
          e.preventDefault()
          void add()
        }}
      >
        <Input onChange={e => setText(e.target.value)} placeholder={t.learningPlaceholder} value={text} />
        <Button size="sm" type="submit" variant="outline">
          {t.addLearning}
        </Button>
      </form>
    </section>
  )
}

function Activity({ t, team }: { t: TeamText; team: Team }) {
  const { data } = useQuery({
    queryKey: ['hermes-bots', 'team-audit', team.id, team.updated_at],
    queryFn: async () => (await host.request<{ entries: TeamAuditEntry[] }>('bots_team.audit.list', { team_id: team.id, limit: 50 })).entries
  })

  return (
    <section aria-label={t.section.activity} data-slot="team-activity">
      <h3 className="mb-2 text-[0.8125rem] font-semibold text-(--ui-text-primary)">{t.section.activity}</h3>
      {!data?.length ? (
        <p className="text-[0.75rem] text-(--ui-text-tertiary)">{t.activityEmpty}</p>
      ) : (
        <ol className="grid gap-1 font-mono text-[0.6875rem] text-(--ui-text-tertiary)">
          {data.map((e, i) => (
            <li className="flex gap-2" key={`${e.at}-${i}`}>
              <time className="shrink-0 tabular-nums">{new Date(e.at * 1000).toLocaleString()}</time>
              <span className="shrink-0 text-(--ui-text-secondary)">{e.actor}</span>
              <span className="truncate">{e.action}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function AdvancedPanel({ t, team }: { t: TeamText; team: Team }) {
  const a = t.advanced

  const exportPack = async () => {
    try {
      const { pack } = await host.request<{ pack: unknown }>('bots_team.pack.export', { team_id: team.id })
      await navigator.clipboard?.writeText(JSON.stringify(pack, null, 2))
      host.notify({ kind: 'success', title: a.packCopied, message: team.name })
    } catch (err) {
      fail(err)
    }
  }

  const importPack = async () => {
    const raw = window.prompt(a.importPack)

    if (!raw) {
      return
    }

    try {
      const view = await mutateTeam('bots_team.pack.import', { pack: JSON.parse(raw) })
      $selectedTeamId.set(view.team.id)
    } catch {
      host.notifyError(new Error(a.packInvalid), 'Team')
    }
  }

  return (
    <section className="grid gap-3 rounded-lg border border-(--ui-stroke-tertiary) p-3" data-slot="team-advanced">
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-[0.8125rem] text-(--ui-text-primary)">{a.policy}</span>
          <span className="block text-[0.6875rem] text-(--ui-text-tertiary)">{a.policyHint}</span>
        </span>
        <Switch
          checked={team.policy.lead_decides}
          onCheckedChange={v => void mutateTeam('bots_team.update', { team_id: team.id, lead_decides: v }).catch(fail)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void exportPack()} size="sm" variant="outline">
          {a.exportPack}
        </Button>
        <Button onClick={() => void importPack()} size="sm" variant="outline">
          {a.importPack}
        </Button>
        <span className="text-[0.6875rem] text-(--ui-text-tertiary)">{a.packHint}</span>
      </div>
      <p className="font-mono text-[0.6875rem] text-(--ui-text-quaternary)">
        {a.ids}: {team.id}
      </p>
      <div>
        <Button
          onClick={() =>
            void host
              .request('bots_team.delete', { team_id: team.id })
              .then(() => $selectedTeamId.set(null))
              .catch(fail)
          }
          size="sm"
          variant="destructive"
        >
          {a.deleteTeam}
        </Button>
      </div>
    </section>
  )
}

function TeamDetail({ id, t }: { id: string; t: TeamText }) {
  const advanced = useValue(host.state.showsAdvancedChrome)
  const { data: view, isPending, error } = useTeam(id)

  if (isPending) {
    return <Loader />
  }

  if (error || !view) {
    return <p className="p-6 text-[0.8125rem] text-(--ui-text-tertiary)">{String((error as Error)?.message ?? '')}</p>
  }

  const { team, tree, rollup } = view
  const pending = pendingApprovals(team).length
  const open = team.members.filter(m => !m.profile).length

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 p-6" data-slot="team-detail">
      <header>
        <h2 className="text-lg font-semibold text-(--ui-text-primary)">{team.name}</h2>
        {team.mission && <p className="mt-1 text-[0.8125rem] text-(--ui-text-secondary)">{team.mission}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[0.75rem] text-(--ui-text-tertiary)">
          <span>{t.seats(team.members.length)}</span>
          {open > 0 && <span>{t.openSeats(open)}</span>}
          {pending > 0 && <span className="font-medium text-(--ui-accent)">{t.needsYou(pending)}</span>}
        </div>
        <div className="mt-3" data-slot="team-overall">
          <div className="mb-1 flex justify-between text-[0.6875rem] text-(--ui-text-tertiary)">
            <span>{t.overall}</span>
            <span className="tabular-nums">{rollup.overall.total ? `${rollup.overall.done}/${rollup.overall.total} · ${rollup.overall.percent}%` : t.goalNone}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-(--ui-control-background)">
            <div className="h-full rounded-full bg-(--ui-accent) transition-[width] duration-500" style={{ width: `${rollup.overall.percent}%` }} />
          </div>
        </div>
      </header>
      <Approvals t={t} team={team} />
      <OrgChart t={t} team={team} tree={tree} />
      <GoalsSection progress={rollup.goals} t={t} team={team} />
      <Learnings t={t} team={team} />
      {advanced && (
        <>
          <Activity t={t} team={team} />
          <AdvancedPanel t={t} team={team} />
        </>
      )}
    </div>
  )
}

export function TeamPage() {
  const t = useTeamText()
  const selected = useValue($selectedTeamId)
  const { data: teams, isPending } = useTeams()
  const [creating, setCreating] = useState(false)
  const current = selected && teams?.some(x => x.id === selected) ? selected : (teams?.[0]?.id ?? null)

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="team-page">
      <div className="flex items-center gap-3 border-b border-(--ui-stroke-tertiary) px-4 py-2">
        <Codicon name="organization" size="1rem" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[0.9375rem] font-semibold text-(--ui-text-primary)">{t.title}</h1>
          <p className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">{t.subtitle}</p>
        </div>
        {teams && teams.length > 1 && (
          <select
            aria-label={t.title}
            className="h-8 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-control-background) px-2 text-[0.8125rem]"
            onChange={e => $selectedTeamId.set(e.target.value)}
            value={current ?? ''}
          >
            {teams.map(x => (
              <option key={x.id} value={x.id}>
                {x.name}
                {x.pending_approvals ? ` (${x.pending_approvals})` : ''}
              </option>
            ))}
          </select>
        )}
        <Button onClick={() => setCreating(true)} size="sm" variant={teams?.length ? 'outline' : 'default'}>
          <Codicon name="add" size="0.75rem" />
          {t.newTeam}
        </Button>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto')}>
        {isPending ? (
          <Loader />
        ) : current ? (
          <TeamDetail id={current} key={current} t={t} />
        ) : (
          <EmptyState description={t.emptyBody} title={t.emptyTitle} />
        )}
      </div>
      <CreateTeamDialog onClose={() => setCreating(false)} open={creating} t={t} />
    </div>
  )
}
