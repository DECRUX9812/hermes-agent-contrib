import {
  buildToolView,
  isRecord,
  isSilentTool,
  stableHash,
  type ToolPart,
  type ToolView
} from '@/components/assistant-ui/tool/fallback-model'
import { translateNow } from '@/i18n'
import type { ToolCardsCopy } from '@/i18n/types_tool_cards'
import { capitalize } from '@/lib/text'

import { toolCardArgs } from './model-args'
import { toolCardOutput, toolCardPageUrl, toolCardReason, toolCardThumb } from './model-output'
import type { ToolCardFamily, ToolCardGroup, ToolCardState, ToolCardView } from './types'

const FAMILY_BY_NAME = new Map<string, ToolCardFamily>([
  ['web_search', 'search'],
  ['search_files', 'search'],
  ['session_search', 'search'],
  ['session_search_recall', 'search'],
  ['fetch_url', 'web'],
  ['terminal', 'terminal'],
  ['process', 'terminal'],
  ['execute_code', 'code'],
  ['read_file', 'files'],
  ['write_file', 'files'],
  ['edit_file', 'files'],
  ['patch', 'files'],
  ['list_files', 'files'],
  ['list_directory', 'files']
])

const FAMILY_BY_PREFIX: ReadonlyArray<readonly [string, ToolCardFamily]> = [
  ['browser_', 'browser'],
  ['web_', 'web'],
  ['mcp__', 'mcp'],
  ['connectors__', 'mcp']
]

const FAMILY_ICON: Record<ToolCardFamily, string> = {
  browser: 'globe',
  code: 'code',
  files: 'files',
  generic: 'tools',
  mcp: 'plug',
  search: 'search',
  terminal: 'terminal',
  web: 'globe'
}

const FILE_ICON = new Map<string, string>([
  ['read_file', 'file'],
  ['write_file', 'edit'],
  ['edit_file', 'edit'],
  ['patch', 'edit'],
  ['list_files', 'files'],
  ['list_directory', 'files']
])

const KNOWN_GENERIC_TOOLS = new Map<string, { icon: string; name: keyof ToolCardsCopy['names'] }>([
  ['memory', { icon: 'brain', name: 'memory' }],
  ['skill_view', { icon: 'tools', name: 'skills' }],
  ['skills_list', { icon: 'tools', name: 'skills' }],
  ['skill_manage', { icon: 'tools', name: 'skills' }],
  ['vision_analyze', { icon: 'eye', name: 'vision' }],
  ['cronjob', { icon: 'watch', name: 'schedule' }],
  ['send_message', { icon: 'tools', name: 'message' }]
])

const t = (key: string): string => translateNow(`assistant.toolCards.${key}`)

export function toolCardFamily(toolName: string): ToolCardFamily {
  const exact = FAMILY_BY_NAME.get(toolName)

  if (exact) {
    return exact
  }

  return FAMILY_BY_PREFIX.find(([prefix]) => toolName.startsWith(prefix))?.[1] ?? 'generic'
}

function toolCardIcon(toolName: string, family: ToolCardFamily): string {
  if (family === 'files') {
    return FILE_ICON.get(toolName) ?? FAMILY_ICON.files
  }

  if (family === 'generic') {
    return KNOWN_GENERIC_TOOLS.get(toolName)?.icon ?? FAMILY_ICON.generic
  }

  return FAMILY_ICON[family]
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ')
}

function toolCardName(toolName: string, family: ToolCardFamily): string {
  if (family === 'mcp') {
    return titleCase(toolName.split('__')[1] ?? '') || t('families.mcp')
  }

  if (family === 'generic') {
    const known = KNOWN_GENERIC_TOOLS.get(toolName)

    return known ? t(`names.${known.name}`) : titleCase(toolName) || t('families.generic')
  }

  return t(`families.${family}`)
}

function toolCardState(part: ToolPart, view: ToolView, approvalPending: boolean): ToolCardState {
  if (part.interrupted) {
    return 'done'
  }

  if (view.status === 'running') {
    return approvalPending ? 'approval' : 'running'
  }

  return view.status === 'error' ? 'error' : 'done'
}

function toolCardStatus(part: ToolPart, view: ToolView): string {
  if (part.interrupted) {
    return t('stopped')
  }

  if (view.title) {
    return view.title
  }

  return view.status === 'running' ? t('working') : ''
}

function epochMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined
  }

  return value < 1e12 ? value * 1000 : value
}

export function toolCardView(part: ToolPart, options: { approvalPending?: boolean } = {}): ToolCardView {
  const view = buildToolView(part, '')
  const family = toolCardFamily(part.toolName)
  const state = toolCardState(part, view, options.approvalPending === true)
  const pageUrl = toolCardPageUrl(part.args, part.result)

  const card: ToolCardView = {
    id: part.toolCallId || stableHash(part.toolName + JSON.stringify(part.args ?? {})),
    family,
    icon: toolCardIcon(part.toolName, family),
    name: toolCardName(part.toolName, family),
    status: toolCardStatus(part, view),
    state,
    args: toolCardArgs(part.args),
    durationLabel: view.durationLabel,
    startedAt: epochMs(part.timestamp),
    completedAt: epochMs(part.completedAt)
  }

  if (state === 'error') {
    card.reason = toolCardReason(part, view) ?? t('failed')
  }

  card.thumb = toolCardThumb(family, view, part.result, pageUrl)
  card.output = toolCardOutput(part.result, family)

  return card
}

const isSoloCard = (card: ToolCardView): boolean => card.state === 'error' || card.state === 'approval'

function joinsRun(previous: ToolCardView, card: ToolCardView): boolean {
  return (
    !isSoloCard(previous) &&
    !isSoloCard(card) &&
    previous.family === card.family &&
    previous.name === card.name
  )
}

function groupOf(cards: ToolCardView[]): ToolCardGroup {
  const latest = cards[cards.length - 1]
  const thumbs = cards.map(card => card.thumb)
  const screenshot = thumbs.findLast(thumb => thumb?.kind === 'screenshot')

  return {
    key: cards[0].id,
    family: latest.family,
    icon: latest.icon,
    name: latest.name,
    state: latest.state,
    cards,
    thumb: screenshot ?? thumbs.findLast(thumb => thumb?.kind === 'site')
  }
}

export function groupToolCards(cards: readonly ToolCardView[]): ToolCardGroup[] {
  const runs: ToolCardView[][] = []

  for (const card of cards) {
    const run = runs.at(-1)

    if (run && joinsRun(run[run.length - 1], card)) {
      run.push(card)
    } else {
      runs.push([card])
    }
  }

  return runs.map(groupOf)
}

const isToolCallPart = (part: unknown): part is ToolPart =>
  isRecord(part) && part.type === 'tool-call' && typeof part.toolName === 'string'

export function toolCardsFromParts(parts: readonly unknown[], options: { approvalCallId?: string } = {}): ToolCardGroup[] {
  const cards: ToolCardView[] = []

  for (const part of parts) {
    if (!isToolCallPart(part) || isSilentTool(part.toolName)) {
      continue
    }

    const approvalPending = Boolean(options.approvalCallId) && part.toolCallId === options.approvalCallId

    cards.push(toolCardView(part, { approvalPending }))
  }

  return groupToolCards(cards)
}
