/**
 * New group dialog templates: one tap fills the room name (until the user
 * types their own), the goal, and the role labels each seat carries in this
 * room. Roles are canonical English strings — they are stored on the room,
 * so every desktop reads the same labels; only their display text localizes.
 */

import { cn, Codicon } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { botRosterKey } from './data'
import { $groupChats, groupChatRoomKey, setGroupChatGoal, setGroupChatListener } from './group-chat'
import { groupMemberKey } from './group-membership'
import { setRoomRoles } from './group-room-roles'
import { displayName } from './labels'
import { useRoomText } from './room-i18n'
import type { LISTMessages } from './room-i18n-list'
import { botRosterMeta } from './routing'
import type { BotMeta, RosterRow } from './types'

export type GroupTemplateId = 'blank' | 'launch' | 'research' | 'review' | 'standup'

export interface GroupTemplate {
  id: GroupTemplateId
  icon: string
  /** Suggested room name, filled only while the user has not typed one. */
  suggest: string
  /** Written to the room after creation; '' means no goal. */
  goal: string
  /** Role options for every seat; 'Member' is always offered. */
  roles: string[]
}

export const GROUP_TEMPLATES: GroupTemplate[] = [
  { id: 'blank', icon: 'file', suggest: '', goal: '', roles: ['Lead', 'Member'] },
  {
    id: 'launch',
    icon: 'rocket',
    suggest: 'Launch team',
    goal: 'Ship the launch: plan, build and write it together.',
    roles: ['Lead', 'Researcher', 'Designer', 'Builder', 'Writer']
  },
  {
    id: 'research',
    icon: 'search',
    suggest: 'Research desk',
    goal: 'Answer the question with sources and a short brief.',
    roles: ['Lead', 'Researcher', 'Analyst', 'Fact-checker']
  },
  {
    id: 'review',
    icon: 'checklist',
    suggest: 'Review board',
    goal: 'Review the work, find the problems, agree on fixes.',
    roles: ['Lead', 'Reviewer', 'Tester']
  },
  {
    id: 'standup',
    icon: 'comment-discussion',
    suggest: 'Daily standup',
    goal: 'Each member reports done, next and blocked; the lead summarises.',
    roles: ['Lead', 'Member']
  }
]

const ROLE_TEXT_KEYS: Record<string, keyof LISTMessages> = {
  Lead: 'roleLead',
  Researcher: 'roleResearcher',
  Designer: 'roleDesigner',
  Builder: 'roleBuilder',
  Writer: 'roleWriter',
  Analyst: 'roleAnalyst',
  'Fact-checker': 'roleFactChecker',
  Reviewer: 'roleReviewer',
  Tester: 'roleTester',
  Member: 'roleMember'
}

export function groupRoleLabel(list: LISTMessages, role: string): string {
  const key = ROLE_TEXT_KEYS[role]

  return (key && list[key]) || role
}

/** One room, one Lead: picking Lead for a seat drops it everywhere else. */
export function assignGroupRole(prev: Record<string, string>, key: string, role: string): Record<string, string> {
  const next = { ...prev, [key]: role }

  if (role === 'Lead') {
    for (const other of Object.keys(next)) {
      if (other !== key && next[other] === 'Lead') {
        next[other] = 'Member'
      }
    }
  }

  return next
}

/** Labels to store on the room, keyed by member key. The default 'Member'
 *  stays out — an unlabeled seat already reads as one. */
export function buildGroupRoleLabels(selected: RosterRow[], roleByKey: Record<string, string>): Record<string, string> {
  const labels: Record<string, string> = {}

  for (const bot of selected) {
    const role = (roleByKey[botRosterKey(bot)] || '').trim()

    if (role && role !== 'Member') {
      labels[groupMemberKey(bot)] = role
    }
  }

  return labels
}

/** The room-listener value for the seat holding Lead, if any — the same
 *  member-key shape the room settings listener picker writes. */
export function groupLeadListenerKey(selected: RosterRow[], roleByKey: Record<string, string>): null | string {
  const lead = selected.find(bot => (roleByKey[botRosterKey(bot)] || 'Member') === 'Lead')

  return lead ? groupMemberKey(lead) : null
}

/** Write the template's goal, listener and role labels onto a fresh room. */
export function applyGroupTemplate(
  groupName: string,
  template: GroupTemplate,
  selected: RosterRow[],
  roleByKey: Record<string, string>
): void {
  // The dialog carries no goal/listener fields: the template's goal lands
  // through the same setter the room settings dialog uses, and a Lead seat
  // becomes the room listener under its member-key shape.
  if (template.goal) {
    setGroupChatGoal(groupName, template.goal)
  }

  const leadKey = groupLeadListenerKey(selected, roleByKey)

  if (leadKey) {
    setGroupChatListener(groupName, leadKey)
  }

  const labels = buildGroupRoleLabels(selected, roleByKey)

  if (Object.keys(labels).length) {
    const created = $groupChats.get()[groupName]

    if (created) {
      setRoomRoles(groupChatRoomKey(groupName, created), labels)
    }
  }
}

/** Template + touch + role state for the New group dialog, reset per open. */
export function useGroupTemplateDraft(open: boolean) {
  const [templateId, setTemplateId] = useState<GroupTemplateId>('blank')
  const [nameTouched, setNameTouched] = useState(false)
  const [roleByKey, setRoleByKey] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      setTemplateId('blank')
      setNameTouched(false)
      setRoleByKey({})
    }
  }, [open])

  const template = GROUP_TEMPLATES.find(entry => entry.id === templateId) ?? GROUP_TEMPLATES[0]

  return {
    template,
    templateId,
    roleByKey,
    pickTemplate: (entry: GroupTemplate, fillName: (name: string) => void): void => {
      setTemplateId(entry.id)

      if (!nameTouched && entry.suggest) {
        fillName(entry.suggest)
      }
    },
    typeName: (value: string, setName: (name: string) => void): void => {
      setNameTouched(true)
      setName(value)
    },
    assignRole: (key: string, role: string): void => {
      setRoleByKey(prev => assignGroupRole(prev, key, role))
    }
  }
}

const TEMPLATE_NAMES: Record<GroupTemplateId, keyof LISTMessages> = {
  blank: 'tplBlank',
  launch: 'tplLaunch',
  research: 'tplResearch',
  review: 'tplReview',
  standup: 'tplStandup'
}

const TEMPLATE_DESCS: Record<GroupTemplateId, keyof LISTMessages> = {
  blank: 'tplBlankDesc',
  launch: 'tplLaunchDesc',
  research: 'tplResearchDesc',
  review: 'tplReviewDesc',
  standup: 'tplStandupDesc'
}

export function GroupTemplateRow({ onChange, value }: { onChange: (template: GroupTemplate) => void; value: GroupTemplateId }) {
  const r = useRoomText().list

  return (
    <div className="grid gap-1.5">
      <div className="text-ui-2xs font-medium text-fg-muted">{r.templateLabel}</div>
      <div aria-label={r.templateLabel} className="grid grid-cols-2 gap-1.5" role="radiogroup">
        {GROUP_TEMPLATES.map(template => {
          const selected = template.id === value

          return (
            <button
              aria-checked={selected}
              className={cn(
                'rounded-card border border-line px-3 py-2 text-left',
                selected && 'border-brand bg-selected'
              )}
              key={template.id}
              onClick={() => onChange(template)}
              role="radio"
              type="button"
            >
              <span className="flex items-center gap-1.5 text-ui-xs font-medium">
                <Codicon name={template.icon} />
                {r[TEMPLATE_NAMES[template.id]]}
              </span>
              <span className="mt-0.5 block text-ui-2xs text-fg-muted">{r[TEMPLATE_DESCS[template.id]]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface GroupRoleSelectsProps {
  allMeta: Record<string, BotMeta>
  bots: RosterRow[]
  onChange: (key: string, role: string) => void
  roles: string[]
  valueByKey: Record<string, string>
}

export function GroupRoleSelects({ allMeta, bots, onChange, roles, valueByKey }: GroupRoleSelectsProps) {
  const r = useRoomText().list

  if (!bots.length) {
    return null
  }

  const options = [...roles.filter(role => role !== 'Member'), 'Member']

  return (
    <div className="grid gap-1">
      {bots.map(bot => {
        const key = botRosterKey(bot)
        const name = displayName(bot, botRosterMeta(bot, allMeta))

        return (
          <label className="flex items-center gap-2" key={key}>
            <span className="min-w-0 flex-1 truncate text-ui-xs text-fg-muted">{name}</span>
            <select
              aria-label={`${r.roleLabel}: ${name}`}
              className="h-7 rounded-control border border-line bg-surface text-ui-xs"
              onChange={event => onChange(key, event.target.value)}
              value={valueByKey[key] || 'Member'}
            >
              {options.map(role => (
                <option key={role} value={role}>
                  {groupRoleLabel(r, role)}
                </option>
              ))}
            </select>
          </label>
        )
      })}
    </div>
  )
}
