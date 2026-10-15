import { queryClient, useQuery } from '@hermes/plugin-sdk'

import { botRosterKey } from './data'
import { requestForBot } from './routing'
import type { RosterRow, RoutineJob } from './types'

const ROUTINE_KEY = ['hermes-bots', 'fork-routines'] as const
const LEGACY_CRON_KEY = ['hermes-bots', 'legacy-cron'] as const

export interface BotRoutine {
  condition?: null | string
  deliver?: null | string
  enabled: boolean
  id: string
  kind: 'schedule' | 'watch'
  last_run_at?: null | string
  last_status?: null | string
  name: string
  next_run_at?: null | string
  prompt: string
  schedule: string
}

export function botRoutinesKey(bot: RosterRow) {
  return [...ROUTINE_KEY, botRosterKey(bot)]
}

export async function loadBotRoutines(bot: RosterRow): Promise<BotRoutine[]> {
  const result = await requestForBot<{ routines: BotRoutine[] }>(bot, 'fork.routines.list', { profile: bot.name })

  return Array.isArray(result.routines) ? result.routines : []
}

export function useBotRoutines(bot: RosterRow) {
  return useQuery({
    queryKey: botRoutinesKey(bot),
    queryFn: () => loadBotRoutines(bot),
    enabled: Boolean(bot.name),
    refetchInterval: 20_000,
    staleTime: 5_000
  })
}

export async function mutateBotRoutine(bot: RosterRow, action: 'pause' | 'remove' | 'resume' | 'run_now', id: string) {
  const result = await requestForBot<{ routines: BotRoutine[]; started?: boolean }>(bot, `fork.routines.${action}`, {
    profile: bot.name,
    id
  })

  await invalidateBotRoutines(bot)

  return result
}

export async function createBotRoutine(
  bot: RosterRow,
  params: { condition?: string; kind: 'schedule' | 'watch'; name: string; prompt?: string; schedule: string }
) {
  const result = await requestForBot<{ routines: BotRoutine[] }>(bot, 'fork.routines.create', {
    profile: bot.name,
    ...params
  })

  await invalidateBotRoutines(bot)

  return result
}

export async function updateBotRoutine(
  bot: RosterRow,
  id: string,
  params: { condition?: string; name: string; prompt?: string; schedule: string }
) {
  const result = await requestForBot<{ routines: BotRoutine[] }>(bot, 'fork.routines.update', {
    profile: bot.name,
    id,
    ...params
  })

  await invalidateBotRoutines(bot)

  return result
}

export async function invalidateBotRoutines(bot: RosterRow) {
  await queryClient.invalidateQueries({ queryKey: botRoutinesKey(bot), exact: true })
}

interface LegacyCronList {
  jobs?: RoutineJob[]
}

export function legacyCronKey(bot: RosterRow) {
  return [...LEGACY_CRON_KEY, botRosterKey(bot)]
}

async function loadLegacyCronJobs(bot: RosterRow): Promise<RoutineJob[]> {
  const result = await requestForBot<LegacyCronList>(bot, 'cron.manage', {
    action: 'list',
    include_disabled: true,
    profile: bot.name
  })

  return Array.isArray(result.jobs) ? result.jobs : []
}

export function useLegacyCronJobs(bot: RosterRow) {
  return useQuery({
    queryKey: legacyCronKey(bot),
    queryFn: () => loadLegacyCronJobs(bot),
    enabled: Boolean(bot.name),
    refetchInterval: 20_000,
    staleTime: 8_000
  })
}
