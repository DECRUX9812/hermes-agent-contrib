import { host, queryClient, useQuery } from '@hermes/plugin-sdk'
import { useEffect, useMemo } from 'react'

import { botRosterKey } from './data'
import { requestForBot } from './routing'
import type { RosterRow } from './types'

const COMPUTER_KEY = ['hermes-bots', 'computer'] as const

export interface ComputerTimelineStep {
  at?: null | string
  detail?: null | {
    command?: string
    diff?: string
    output_tail?: string
    page_title?: string
    path?: string
    screenshot_path?: string
    url?: string
  }
  duration_s?: null | number
  id: string
  index: number
  kind: 'browser' | 'file' | 'other' | 'search' | 'terminal'
  status: string
  title: string
  tool: string
}

export interface ComputerTodo {
  content: string
  id: string
  status: string
}

export interface ComputerTimelineResult {
  session_id: string
  steps: ComputerTimelineStep[]
  todos: ComputerTodo[]
}

export function computerTimelineKey(bot: RosterRow, sessionId: string) {
  return [...COMPUTER_KEY, botRosterKey(bot), sessionId]
}

export async function loadComputerTimeline(bot: RosterRow, sessionId: string): Promise<ComputerTimelineResult> {
  return requestForBot<ComputerTimelineResult>(bot, 'fork.computer.timeline', {
    profile: bot.name,
    session_id: sessionId
  })
}

export function useComputerTimeline(bot: RosterRow, sessionId: string) {
  const ownerKey = botRosterKey(bot)
  const queryKey = useMemo(() => [...COMPUTER_KEY, ownerKey, sessionId], [ownerKey, sessionId])

  const query = useQuery({
    queryKey,
    queryFn: () => loadComputerTimeline(bot, sessionId),
    enabled: Boolean(bot.name && sessionId),
    staleTime: 0
  })

  const { refetch } = query
  const isRunning = query.data?.steps.some(step => step.status === 'running') ?? false

  useEffect(() => {
    if (!sessionId) {
      return undefined
    }

    let timer: number | null = null
    const canonicalIds = new Set([bot.canonical_session?.id, bot.canonical_session?.resolved_id].filter(Boolean))

    const unsubscribe = host.onEvent?.('tool.complete', event => {
      if (!canonicalIds.has(event.session_id || '')) {
        return
      }

      if (event.connectionId && bot.connectionId && event.connectionId !== bot.connectionId) {
        return
      }

      if (timer !== null) {
        window.clearTimeout(timer)
      }

      timer = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey, exact: true })
      }, 300)
    })

    return () => {
      unsubscribe?.()

      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [bot.canonical_session?.id, bot.canonical_session?.resolved_id, bot.connectionId, queryKey, sessionId])

  useEffect(() => {
    if (!isRunning) {
      return undefined
    }

    const timer = window.setInterval(() => void refetch(), 10_000)

    return () => window.clearInterval(timer)
  }, [isRunning, refetch])

  return query
}

export async function loadBrowserThumbnail(bot: RosterRow, sessionId: string, toolCallId: string) {
  return requestForBot<{
    data_base64?: string | null
    found: boolean
    mime?: string | null
    title?: string | null
    url?: string | null
  }>(bot, 'fork.browser.thumbnail', {
    profile: bot.name,
    session_id: sessionId,
    tool_call_id: toolCallId
  })
}

export function browserThumbnailKey(bot: RosterRow, sessionId: string, toolCallId: string) {
  return [...COMPUTER_KEY, botRosterKey(bot), sessionId, 'thumbnail', toolCallId]
}
