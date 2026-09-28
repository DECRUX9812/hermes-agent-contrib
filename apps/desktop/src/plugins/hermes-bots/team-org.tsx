/** Org chart + seat editing for the Team page. Pure SDK UI: no Electron APIs, so it renders
 *  identically in the desktop shell and a web-hosted client. */

import {
  Badge,
  Button,
  cn,
  Codicon,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  host,
  Input,
  Tip
} from '@hermes/plugin-sdk'
import { type ReactNode, useState } from 'react'

import { useRoster } from './data'
import {
  budgetState,
  type BudgetTone,
  mutateTeam,
  seatName,
  type Team,
  type TeamMember,
  type TeamOrgNode
} from './team'
import { type TeamText } from './team-i18n'

const TONE_BAR: Record<BudgetTone, string> = {
  exhausted: 'bg-(--ui-danger,#e5484d)',
  ok: 'bg-(--ui-accent)',
  paused: 'bg-(--ui-text-quaternary)',
  warn: 'bg-(--ui-warning,#f5a524)'
}

const usd = (n: number) => `$${n >= 100 ? Math.round(n) : n.toFixed(2).replace(/\.00$/, '')}`

function BudgetMeter({ member, t }: { member: TeamMember; t: TeamText }) {
  const { percent, tone } = budgetState(member)
  const limit = member.budget.monthly_usd

  return (
    <div className="mt-2 min-w-0" data-slot="team-budget" data-tone={tone}>
      <div className="h-1 overflow-hidden rounded-full bg-(--ui-control-background)">
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', TONE_BAR[tone])}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
      <p className="mt-1 truncate text-[0.6875rem] text-(--ui-text-tertiary)">
        {tone === 'paused'
          ? t.paused
          : tone === 'exhausted'
            ? t.budgetExhausted
            : limit === null
              ? t.budgetUncapped
              : t.budgetLine(usd(member.budget.spent_usd), usd(limit))}
      </p>
    </div>
  )
}

function SeatCard({ node, onEdit, team, t }: { node: TeamOrgNode; onEdit: (m: TeamMember) => void; team: Team; t: TeamText }) {
  const open = !node.profile

  const call = (method: string, extra: Record<string, unknown>) =>
    void mutateTeam(method, { team_id: team.id, ...extra }).catch(err => host.notifyError(err, 'Team'))

  return (
    <div
      className={cn(
        'group/seat relative w-52 rounded-lg border p-3 text-left',
        open
          ? 'border-dashed border-(--ui-stroke-secondary) bg-transparent'
          : 'border-(--ui-stroke-tertiary) bg-(--ui-control-background)',
        node.status === 'paused' && 'opacity-70'
      )}
      data-slot="team-seat"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-(--ui-control-active-background) text-[0.75rem] font-semibold text-(--ui-text-secondary)"
        >
          {open ? <Codicon name="add" size="0.875rem" /> : (node.profile ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-medium text-(--ui-text-primary)">{seatName(node, t.openSeat)}</p>
          <p className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">{node.role || node.title || '—'}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={t.edit} className="-mr-1 size-6 opacity-0 group-hover/seat:opacity-100 focus-visible:opacity-100" size="icon" variant="ghost">
              <Codicon name="kebab-vertical" size="0.875rem" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(node)}>{t.edit}</DropdownMenuItem>
            {!node.lead && <DropdownMenuItem onSelect={() => call('bots_team.member.upsert', { slot: node.slot, lead: true })}>{t.makeLead}</DropdownMenuItem>}
            <DropdownMenuItem
              onSelect={() => call('bots_team.member.upsert', { slot: node.slot, status: node.status === 'paused' ? 'active' : 'paused' })}
            >
              {node.status === 'paused' ? t.resume : t.pause}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => call('bots_team.member.remove', { member: node.slot })}>{t.remove}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {node.lead && (
        <Badge className="absolute -top-2 left-3" variant="muted">
          {t.lead}
        </Badge>
      )}
      {!open && <BudgetMeter member={node} t={t} />}
      {node.skills.length > 0 && (
        <Tip label={node.skills.join(', ')}>
          <p className="mt-1.5 truncate text-[0.6875rem] text-(--ui-text-quaternary)">{node.skills.join(' · ')}</p>
        </Tip>
      )}
    </div>
  )
}

function OrgBranch({ nodes, ...rest }: { nodes: TeamOrgNode[]; onEdit: (m: TeamMember) => void; team: Team; t: TeamText }) {
  return (
    <ul className="flex justify-center gap-4">
      {nodes.map(node => (
        <li className="flex flex-col items-center" key={node.slot}>
          <SeatCard node={node} {...rest} />
          {node.reports.length > 0 && (
            <>
              <span aria-hidden="true" className="h-4 w-px bg-(--ui-stroke-secondary)" />
              <OrgBranch nodes={node.reports} {...rest} />
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

export function OrgChart({ team, tree, t }: { team: Team; tree: TeamOrgNode[]; t: TeamText }) {
  const [editing, setEditing] = useState<null | Partial<TeamMember>>(null)

  return (
    <section aria-label={t.section.org} data-slot="team-org">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[0.8125rem] font-semibold text-(--ui-text-primary)">{t.section.org}</h3>
        <Button onClick={() => setEditing({})} size="sm" variant="outline">
          <Codicon name="add" size="0.75rem" />
          {t.addSeat}
        </Button>
      </div>
      {tree.length === 0 ? (
        <p className="text-[0.75rem] text-(--ui-text-tertiary)">{t.emptyBody}</p>
      ) : (
        <div className="overflow-x-auto pb-2 pt-3">
          <div className="mx-auto w-max">
            <OrgBranch nodes={tree} onEdit={setEditing} t={t} team={team} />
          </div>
        </div>
      )}
      <SeatDialog member={editing} onClose={() => setEditing(null)} t={t} team={team} />
    </section>
  )
}

const splitList = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)

function SeatDialog({ member, onClose, t, team }: { member: null | Partial<TeamMember>; onClose: () => void; t: TeamText; team: Team }) {
  return (
    <Dialog onOpenChange={open => !open && onClose()} open={member !== null}>
      <DialogContent className="max-w-md">{member && <SeatForm key={member.slot ?? 'new'} member={member} onClose={onClose} t={t} team={team} />}</DialogContent>
    </Dialog>
  )
}

function SeatForm({ member, onClose, t, team }: { member: Partial<TeamMember>; onClose: () => void; t: TeamText; team: Team }) {
  const [profile, setProfile] = useState(member.profile ?? '')
  const [role, setRole] = useState(member.role ?? '')
  const [budget, setBudget] = useState(member.budget?.monthly_usd?.toString() ?? '')
  const [skills, setSkills] = useState((member.skills ?? []).join(', '))
  const [boss, setBoss] = useState(member.reports_to ?? '')
  const [busy, setBusy] = useState(false)
  const others = team.members.filter(m => m.slot !== member.slot)
  // Hire from the bots this install already has; the field still takes any name.
  const { data: roster } = useRoster()
  const hireable = (roster?.profiles ?? []).map(r => r.name).filter(n => !team.members.some(m => m.profile === n && m.slot !== member.slot))

  const save = async () => {
    setBusy(true)

    try {
      await mutateTeam('bots_team.member.upsert', {
        team_id: team.id,
        ...(member.slot ? { slot: member.slot } : {}),
        profile: profile.trim() || null,
        role,
        skills: splitList(skills),
        monthly_usd: budget.trim() === '' ? null : Number(budget),
        reports_to: boss || null
      })
      onClose()
    } catch (err) {
      host.notifyError(err, 'Team')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
    >
      <DialogHeader>
        <DialogTitle>{member.slot ? t.edit : t.addSeat}</DialogTitle>
      </DialogHeader>
      <Field label={t.seatProfile}>
        <Input list="team-hireable" onChange={e => setProfile(e.target.value)} placeholder={t.seatProfilePlaceholder} value={profile} />
        <datalist id="team-hireable">
          {hireable.map(n => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>
      <Field label={t.seatRole}>
        <Input onChange={e => setRole(e.target.value)} placeholder={t.seatRolePlaceholder} value={role} />
      </Field>
      <Field label={t.seatSkills}>
        <Input onChange={e => setSkills(e.target.value)} placeholder={t.seatSkillsPlaceholder} value={skills} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.seatBudget}>
          <Input inputMode="decimal" onChange={e => setBudget(e.target.value)} placeholder={t.seatBudgetPlaceholder} value={budget} />
        </Field>
        <Field label={t.seatReportsTo}>
          <select
            className="h-8 w-full rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-control-background) px-2 text-[0.8125rem]"
            onChange={e => setBoss(e.target.value)}
            value={boss}
          >
            <option value="">{t.nobody}</option>
            {others.map(m => (
              <option key={m.slot} value={m.slot}>
                {seatName(m, t.openSeat)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <DialogFooter>
        <Button disabled={busy} type="submit">
          {t.save}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid gap-1 text-[0.75rem] font-medium text-(--ui-text-secondary)">
      {label}
      {children}
    </label>
  )
}
