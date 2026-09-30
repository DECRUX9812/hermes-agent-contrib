/**
 * Built-in Team Packs for the Hire gallery: whole org designs you hire in one
 * click. They are the exact data `bots_team.pack.export` produces (seats, roles,
 * reporting lines, role kits, budgets) and go through `bots_team.pack.import`,
 * which allow-lists every key — a pack can create a team with open seats and
 * nothing else. Fill the seats from the Team page with your own bots.
 */

import { mutateTeam, type TeamView } from './team'

export interface TeamPackSeat {
  slot: string
  role: string
  title: string
  reports_to_slot?: string
  lead?: boolean
  skills?: string[]
  monthly_usd?: number
  hard_stop?: boolean
}

export interface TeamPack {
  pack_version: 1
  name: string
  mission: string
  policy: { lead_decides: boolean }
  seats: TeamPackSeat[]
}

export interface BuiltinTeamPack {
  id: string
  /** Faces for the card, in seat order (blobatar seeds — not profile names). */
  faces: string[]
  pack: TeamPack
}

export const BUILTIN_TEAM_PACKS: readonly BuiltinTeamPack[] = [
  {
    id: 'startup-kit',
    faces: ['atlas', 'scout', 'forge', 'quill'],
    pack: {
      pack_version: 1,
      name: 'Startup kit',
      mission: 'Ship the product and tell the world about it.',
      policy: { lead_decides: false },
      seats: [
        {
          slot: 's1',
          role: 'Chief of staff',
          title: 'Plans the week and hands out the work',
          lead: true,
          monthly_usd: 30
        },
        {
          slot: 's2',
          role: 'Researcher',
          title: 'Finds and cites what the team needs to know',
          reports_to_slot: 's1',
          skills: ['arxiv', 'grounded-citations'],
          monthly_usd: 20
        },
        {
          slot: 's3',
          role: 'Engineer',
          title: 'Writes, reviews and ships the code',
          reports_to_slot: 's1',
          skills: ['github', 'systematic-debugging', 'test-driven-development'],
          monthly_usd: 40
        },
        {
          slot: 's4',
          role: 'Writer',
          title: 'Drafts posts, docs and launch copy',
          reports_to_slot: 's1',
          monthly_usd: 20
        }
      ]
    }
  },
  {
    id: 'content-studio',
    faces: ['quill', 'lens', 'muse'],
    pack: {
      pack_version: 1,
      name: 'Content studio',
      mission: 'Publish one great piece a week, on time.',
      policy: { lead_decides: false },
      seats: [
        { slot: 's1', role: 'Editor', title: 'Owns the calendar and the final edit', lead: true, monthly_usd: 25 },
        { slot: 's2', role: 'Writer', title: 'Turns outlines into drafts', reports_to_slot: 's1', monthly_usd: 20 },
        {
          slot: 's3',
          role: 'Analyst',
          title: 'Checks what landed and what did not',
          reports_to_slot: 's1',
          monthly_usd: 15
        }
      ]
    }
  },
  {
    id: 'personal-ops',
    faces: ['juno', 'pilot'],
    pack: {
      pack_version: 1,
      name: 'Personal ops',
      mission: 'Keep my week organized and nothing important dropped.',
      policy: { lead_decides: true },
      seats: [
        { slot: 's1', role: 'Planner', title: 'Runs the calendar and the Monday brief', lead: true, monthly_usd: 10 },
        {
          slot: 's2',
          role: 'Ops',
          title: 'Watches inboxes and routines, flags what needs you',
          reports_to_slot: 's1',
          skills: ['document-to-action-items'],
          monthly_usd: 10
        }
      ]
    }
  }
]

/** Create a team from a pack. Every seat starts open; the backend ignores
 *  anything a pack carries beyond the allow-listed org design. */
export const importTeamPack = (pack: TeamPack): Promise<TeamView> => mutateTeam('bots_team.pack.import', { pack })
