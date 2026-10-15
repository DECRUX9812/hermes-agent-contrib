import { queryClient, useQuery } from '@hermes/plugin-sdk'
import type {
  ForkBotIdentityGetResult,
  ForkBotIdentitySetParams,
  ForkBotIdentitySetResult,
  ForkMemoryAddParams,
  ForkMemoryListResult,
  ForkMemoryRemoveParams,
  ForkMemoryUpdateParams
} from '@hermes/plugin-sdk'

import { $botMeta, $lastRoster, botMetaKey, botRosterKey, noteBotMetaWrite, ROSTER_KEY } from './data'
import { requestForBot } from './routing'
import type { RosterRow } from './types'

export const BOT_IDENTITY_QUERY_KEY = ['hermes-bots', 'bot-identity'] as const
export const BOT_MEMORY_QUERY_KEY = ['hermes-bots', 'bot-memory'] as const

export function botIdentityQueryKey(bot: RosterRow) {
  return [...BOT_IDENTITY_QUERY_KEY, botRosterKey(bot)]
}

export function botMemoryQueryKey(bot: RosterRow) {
  return [...BOT_MEMORY_QUERY_KEY, botRosterKey(bot)]
}

export function useBotIdentity(bot: RosterRow) {
  return useQuery<ForkBotIdentityGetResult>({
    queryKey: botIdentityQueryKey(bot),
    queryFn: () =>
      requestForBot<ForkBotIdentityGetResult>(bot, 'fork.bot.identity.get', {
        profile: bot.name
      }),
    enabled: Boolean(bot.name),
    retry: false
  })
}

export function useBotMemory(bot: RosterRow) {
  return useQuery<ForkMemoryListResult>({
    queryKey: botMemoryQueryKey(bot),
    queryFn: () =>
      requestForBot<ForkMemoryListResult>(bot, 'fork.memory.list', {
        profile: bot.name
      }),
    enabled: Boolean(bot.name),
    retry: false
  })
}

export function setBotIdentity(
  bot: RosterRow,
  patch: Omit<ForkBotIdentitySetParams, 'profile'>
): Promise<ForkBotIdentitySetResult> {
  return requestForBot<ForkBotIdentitySetResult>(bot, 'fork.bot.identity.set', {
    profile: bot.name,
    ...patch
  })
}

export function addBotMemory(bot: RosterRow, target: 'memory' | 'user', text: string): Promise<ForkMemoryListResult> {
  const params: ForkMemoryAddParams = { profile: bot.name, target, text }

  return requestForBot<ForkMemoryListResult>(bot, 'fork.memory.add', { ...params })
}

export function updateBotMemory(bot: RosterRow, id: string, text: string): Promise<ForkMemoryListResult> {
  const params: ForkMemoryUpdateParams = { profile: bot.name, id, text }

  return requestForBot<ForkMemoryListResult>(bot, 'fork.memory.update', { ...params })
}

export function removeBotMemory(bot: RosterRow, id: string): Promise<ForkMemoryListResult> {
  const params: ForkMemoryRemoveParams = { profile: bot.name, id }

  return requestForBot<ForkMemoryListResult>(bot, 'fork.memory.remove', { ...params })
}

export function publishBotIdentity(bot: RosterRow, identity: ForkBotIdentityGetResult): void {
  const key = botMetaKey(bot) || bot.name
  noteBotMetaWrite(key)
  $botMeta.set({
    ...$botMeta.get(),
    [key]: {
      ...($botMeta.get()[key] || {}),
      title: identity.display_name,
      role: identity.role
    }
  })

  const rosterKey = botRosterKey(bot)
  $lastRoster.set(
    $lastRoster.get().map(row =>
      botRosterKey(row) === rosterKey
        ? {
            ...row,
            display_name: identity.display_name,
            ui_meta: {
              ...row.ui_meta,
              'hermes-bots': {
                ...row.ui_meta?.['hermes-bots'],
                title: identity.display_name,
                role: identity.role
              }
            }
          }
        : row
    )
  )

  void queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
}

export function cacheBotIdentity(bot: RosterRow, identity: ForkBotIdentityGetResult): void {
  queryClient.setQueryData(botIdentityQueryKey(bot), identity)
}

export function cacheBotMemory(bot: RosterRow, memory: ForkMemoryListResult): void {
  queryClient.setQueryData(botMemoryQueryKey(bot), memory)
}

export function forkRpcErrorCode(error: unknown): number | null {
  const value = errorRecord(error)
  const cause = errorRecord(value?.cause)
  const raw = value?.code ?? cause?.code ?? value?.name ?? cause?.name
  const code = Number(raw)

  return Number.isFinite(code) ? code : null
}

export function forkRpcErrorMessage(error: unknown): string {
  const value = errorRecord(error)
  const cause = errorRecord(value?.cause)
  const message = cause?.message ?? value?.message

  return typeof message === 'string' ? message.trim() : ''
}

function errorRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

export async function cancelIdentityRead(bot: RosterRow): Promise<void> {
  await queryClient.cancelQueries({ queryKey: botIdentityQueryKey(bot), exact: true })
}

export async function cancelMemoryRead(bot: RosterRow): Promise<void> {
  await queryClient.cancelQueries({ queryKey: botMemoryQueryKey(bot), exact: true })
}

