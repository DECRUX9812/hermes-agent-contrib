/** Org chart + seat editing for the Team page. Pure SDK UI: no Electron APIs, so it renders
 *  identically in the desktop shell and a web-hosted client. */

import {
  Badge,
  Button,
  cn,
  Codicon,
  confirm,
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
  Tip,
  useValue
} from '@hermes/plugin-sdk'
import { type ReactNode, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { $botMeta, useRoster } from './data'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
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
import type { RosterRow } from './types'

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
      <div className="h-1 overflow-hidden rounded-full bg-(--ui-stroke-tertiary)">
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

/** The seat's bot as the roster knows it: real face, colour and friendly name. */
function useSeatBot(profile: null | string) {
  const { data } = useRoster()
  const allMeta = useValue($botMeta)
  const bot = (data?.profiles ?? []).find((row: RosterRow) => row.name === profile) as RosterRow | undefined

  if (!bot || !profile) {
    return null
  }

  const meta = botRosterMeta(bot, allMeta)

  return { ...botAppearance(bot.name, meta), label: displayName(bot, meta) }
}

/** An inline-editable seat line: text until clicked, an input on Enter/blur, Escape cancels.
 *  Saves straight through `bots_team.member.upsert` — no dialog for a rename. */
function InlineSeatField({
  ariaLabel,
  className,
  field,
  node,
  placeholder,
  t,
  team
}: {
  ariaLabel: string
  className?: string
  field: 'role' | 'title'
  node: TeamOrgNode
  placeholder: string
  t: TeamText
  team: Team
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<null | string>(null)
  const value = node[field]

  const commit = () => {
    const next = (draft ?? '').trim()

    setEditing(false)
    setDraft(null)

    if (next !== value) {
      void mutateTeam('bots_team.member.upsert', { [field]: next, slot: node.slot, team_id: team.id }).catch(err =>
        host.notifyError(err, 'Team')
      )
    }
  }

  if (!editing) {
    return (
      <button
        aria-label={ariaLabel}
        className={cn(
          '-mx-1 max-w-full truncate rounded-row px-1 text-left transition-colors hover:bg-hover',
          className
        )}
        data-slot={`team-seat-${field}`}
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          setEditing(true)
        }}
        type="button"
      >
        {value || <span className="text-fg-subtle">{placeholder}</span>}
      </button>
    )
  }

  return (
    <Input
      aria-label={ariaLabel}
      autoFocus
      className={cn('h-6', className)}
      onBlur={commit}
      onChange={e => setDraft(e.target.value)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          commit()
        }

        if (e.key === 'Escape') {
          setEditing(false)
          setDraft(null)
        }
      }}
      placeholder={placeholder}
      value={draft ?? value}
    />
  )
}

function SeatCard({
  node,
  onEdit,
  team,
  t
}: {
  node: TeamOrgNode
  onEdit: (m: TeamMember) => void
  team: Team
  t: TeamText
}) {
  const open = !node.profile
  const face = useSeatBot(node.profile)

  const call = (method: string, extra: Record<string, unknown>) =>
    mutateTeam(method, { team_id: team.id, ...extra }).catch(err => host.notifyError(err, 'Team'))

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
        {face ? (
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            <BotFace
              color={avatarColor(face.color, node.profile ?? '')}
              image={face.image}
              name={node.profile ?? ''}
              shape={face.shape}
              size={28}
            />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-(--ui-control-active-background) text-[0.75rem] font-semibold text-(--ui-text-secondary)"
          >
            {open ? <Codicon name="add" size="0.875rem" /> : (node.profile ?? '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="truncate text-[0.8125rem] font-medium text-(--ui-text-primary)">
            {face?.label || seatName(node, t.openSeat)}
          </p>
          <InlineSeatField
            ariaLabel={t.seatTitle}
            className="text-[0.6875rem] text-(--ui-text-secondary)"
            field="title"
            node={node}
            placeholder={t.seatTitlePlaceholder}
            t={t}
            team={team}
          />
          <InlineSeatField
            ariaLabel={t.seatRole}
            className="text-[0.6875rem] text-(--ui-text-tertiary)"
            field="role"
            node={node}
            placeholder={t.seatRolePlaceholder}
            t={t}
            team={team}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t.edit}
              className="-mr-1 size-6 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/seat:opacity-100"
              size="icon"
              variant="ghost"
            >
              <Codicon name="kebab-vertical" size="0.875rem" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(node)}>{t.edit}</DropdownMenuItem>
            {!node.lead && (
              <DropdownMenuItem onSelect={() => call('bots_team.member.upsert', { slot: node.slot, lead: true })}>
                {t.makeLead}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() =>
                call('bots_team.member.upsert', {
                  slot: node.slot,
                  status: node.status === 'paused' ? 'active' : 'paused'
                })
              }
            >
              {node.status === 'paused' ? t.resume : t.pause}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void confirm({
                  confirmLabel: t.remove,
                  description: face?.label || seatName(node, t.openSeat),
                  destructive: true,
                  onConfirm: async () => {
                    await call('bots_team.member.remove', { member: node.slot })
                  },
                  title: t.remove
                })
              }}
            >
              {t.remove}
            </DropdownMenuItem>
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

// Connectors are drawn per child: a stub down from the rail, and a rail segment that stops at the
// middle for the first/last child so the line spans exactly from the first to the last sibling.
const RAIL =
  'relative px-2 pt-4 before:absolute before:left-0 before:right-0 before:top-0 before:h-px before:bg-(--ui-stroke-secondary) after:absolute after:left-1/2 after:top-0 after:h-4 after:w-px after:bg-(--ui-stroke-secondary) first:before:left-1/2 last:before:right-1/2 only:before:hidden'

function OrgBranch({
  nodes,
  root,
  ...rest
}: {
  nodes: TeamOrgNode[]
  onEdit: (m: TeamMember) => void
  root?: boolean
  team: Team
  t: TeamText
}) {
  return (
    <ul className="flex justify-center">
      {nodes.map(node => (
        <li className={cn('flex flex-col items-center', !root && RAIL)} key={node.slot}>
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
  const openSeats = team.members.filter(m => !m.profile).length

  return (
    <section aria-label={t.section.org} data-slot="team-org">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[0.8125rem] font-semibold text-(--ui-text-primary)">{t.section.org}</h3>
        <p className="min-w-0 truncate text-[0.6875rem] text-(--ui-text-tertiary)" data-slot="team-seats-count">
          {t.seats(team.members.length)}
          {openSeats > 0 ? ` · ${t.openSeats(openSeats)}` : ''}
        </p>
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
            <OrgBranch nodes={tree} onEdit={setEditing} root t={t} team={team} />
          </div>
        </div>
      )}
      <SeatDialog member={editing} onClose={() => setEditing(null)} t={t} team={team} />
    </section>
  )
}

const splitList = (s: string) =>
  s
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)

function SeatDialog({
  member,
  onClose,
  t,
  team
}: {
  member: null | Partial<TeamMember>
  onClose: () => void
  t: TeamText
  team: Team
}) {
  return (
    <Dialog onOpenChange={open => !open && onClose()} open={member !== null}>
      <DialogContent className="max-w-md">
        {member && <SeatForm key={member.slot ?? 'new'} member={member} onClose={onClose} t={t} team={team} />}
      </DialogContent>
    </Dialog>
  )
}

function SeatForm({
  member,
  onClose,
  t,
  team
}: {
  member: Partial<TeamMember>
  onClose: () => void
  t: TeamText
  team: Team
}) {
  const [profile, setProfile] = useState(member.profile ?? '')
  const [budget, setBudget] = useState(member.budget?.monthly_usd?.toString() ?? '')
  const [skills, setSkills] = useState((member.skills ?? []).join(', '))
  const [boss, setBoss] = useState(member.reports_to ?? '')
  const [busy, setBusy] = useState(false)
  const others = team.members.filter(m => m.slot !== member.slot)
  // Hire from the bots this install already has; the field still takes any name.
  const { data: roster } = useRoster()

  const hireable = (roster?.profiles ?? [])
    .map(r => r.name)
    .filter(n => !team.members.some(m => m.profile === n && m.slot !== member.slot))

  const save = async () => {
    setBusy(true)

    try {
      await mutateTeam('bots_team.member.upsert', {
        team_id: team.id,
        ...(member.slot ? { slot: member.slot } : {}),
        profile: profile.trim() || null,
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
        <Input
          list="team-hireable"
          onChange={e => setProfile(e.target.value)}
          placeholder={t.seatProfilePlaceholder}
          value={profile}
        />
        <datalist id="team-hireable">
          {hireable.map(n => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>
      <Field label={t.seatSkills}>
        <Input onChange={e => setSkills(e.target.value)} placeholder={t.seatSkillsPlaceholder} value={skills} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.seatBudget}>
          <Input
            inputMode="decimal"
            onChange={e => setBudget(e.target.value)}
            placeholder={t.seatBudgetPlaceholder}
            value={budget}
          />
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
