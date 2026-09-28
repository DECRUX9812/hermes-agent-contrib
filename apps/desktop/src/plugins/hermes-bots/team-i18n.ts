/**
 * Team Bots strings, registered on top of Bot Mode's bundles under the same plugin id
 * (`ctx.i18n.register` merges per locale). English is the floor every other locale falls
 * back to, so the Team surface ships complete in `en` and picks up translations as they
 * land without any type coupling to the core Bot Mode message shape.
 */

import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'

import { ID } from './shared'

export const TEAM_EN = {
  nav: 'Team',
  title: 'Your team',
  subtitle: 'Bots that work together toward a shared goal.',
  newTeam: 'New team',
  createTitle: 'Start a team',
  createName: 'Team name',
  createNamePlaceholder: 'e.g. Growth',
  createMission: 'What is this team here to do?',
  createMissionPlaceholder: 'One sentence. Every teammate sees it.',
  create: 'Create team',
  emptyTitle: 'No team yet',
  emptyBody: 'Give a few bots a shared mission, a boss and a budget — then watch them work as a team.',
  noTeamSelected: 'Pick a team',
  unavailableTitle: 'Teams need a newer Hermes',
  unavailableBody: 'This gateway does not know about teams yet. Update Hermes on the machine it runs on.',
  seats: (n: number) => (n === 1 ? '1 teammate' : `${n} teammates`),
  openSeats: (n: number) => (n === 1 ? '1 open seat' : `${n} open seats`),
  needsYou: (n: number) => (n === 1 ? '1 thing needs you' : `${n} things need you`),
  overall: 'Overall progress',
  section: {
    approvals: 'Needs your approval',
    org: 'Org chart',
    goals: 'Goals',
    learnings: 'What the team has learned',
    activity: 'Activity'
  },
  approve: 'Approve',
  reject: 'Decline',
  requestedBy: (who: string) => `Asked by ${who}`,
  kind: { hire: 'Hire', spend: 'Spend', credential: 'Access', action: 'Action' },
  openSeat: 'Open seat',
  lead: 'Lead',
  addSeat: 'Add a teammate',
  seatProfile: 'Bot (profile name)',
  seatProfilePlaceholder: 'Leave empty for an open seat',
  seatRole: 'Role',
  seatRolePlaceholder: 'e.g. Content writer',
  seatBudget: 'Monthly budget (USD)',
  seatBudgetPlaceholder: 'No limit',
  seatSkills: 'Skills',
  seatSkillsPlaceholder: 'Comma-separated, e.g. seo, copywriting',
  seatReportsTo: 'Reports to',
  nobody: 'Nobody (top of the team)',
  makeLead: 'Make lead',
  pause: 'Pause',
  resume: 'Resume',
  remove: 'Remove from team',
  edit: 'Edit',
  save: 'Save',
  paused: 'Paused',
  budgetLine: (spent: string, limit: string) => `${spent} of ${limit} this month`,
  budgetUncapped: 'No spending cap',
  budgetExhausted: 'Budget used up — paused from new work',
  goalNone: 'No tasks yet',
  addGoal: 'Add a goal',
  goalTitle: 'Goal',
  goalTitlePlaceholder: 'What should get done?',
  subGoal: 'Add sub-goal',
  goalStatus: { open: 'Open', active: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' },
  owner: 'Owner',
  unowned: 'Unassigned',
  linkTask: 'Link a task',
  taskId: 'Kanban task id',
  linkedTasks: (n: number) => (n === 1 ? '1 task' : `${n} tasks`),
  learningsEmpty: 'Nothing yet. Lessons the team records show up here and are shared with every teammate.',
  learningPlaceholder: 'Add a lesson, e.g. “Always cite sources”',
  addLearning: 'Add',
  confirmed: (n: number) => `confirmed ${n}×`,
  activityEmpty: 'Nothing has happened yet.',
  advanced: {
    policy: 'Let the lead approve things',
    policyHint: 'Off: only you can approve hires, spend and access. On: the lead can too — never for its own requests.',
    exportPack: 'Export as Team Pack',
    importPack: 'Import Team Pack',
    packHint: 'A Team Pack is just the org design — roles, reporting lines and skills. No bots, keys or history.',
    packCopied: 'Team Pack copied',
    packInvalid: 'That is not a valid Team Pack',
    deleteTeam: 'Delete team',
    ids: 'IDs'
  },
  toast: { created: 'Team created', saved: 'Saved' }
}

export const TEAM_LOCALES: PluginLocaleBundles = { en: { team: TEAM_EN } }

export type TeamText = typeof TEAM_EN

/** Typed access to the Team strings for the active locale: `t.section.org`, `t.seats(3)`. */
export function useTeamText(): TeamText {
  const t = usePluginI18n(ID)

  return bindTree(t, TEAM_EN, 'team') as TeamText
}

function bindTree(t: (key: string, ...args: unknown[]) => string, node: object, path: string): unknown {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(node)) {
    const next = `${path}.${key}`
    out[key] =
      typeof value === 'function'
        ? (...args: unknown[]) => t(next, ...args)
        : value && typeof value === 'object'
          ? bindTree(t, value, next)
          : t(next)
  }

  return out
}
