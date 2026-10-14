import { parseMaybeObject } from '@/components/assistant-ui/tool/fallback-model'
import { translateNow } from '@/i18n'
import { capitalize } from '@/lib/text'

import type { ToolCardDetail } from './types'

const MAX_ARG_ROWS = 4
const MAX_ARG_CHARS = 200

export function clampText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

interface KnownArg {
  key: string
  label: 'code' | 'command' | 'path' | 'query' | 'target' | 'text' | 'url'
  lines?: number
}

const KNOWN_ARGS: readonly KnownArg[] = [
  { key: 'url', label: 'url' },
  { key: 'command', label: 'command' },
  { key: 'path', label: 'path' },
  { key: 'file_path', label: 'path' },
  { key: 'query', label: 'query' },
  { key: 'pattern', label: 'query' },
  { key: 'code', label: 'code', lines: 3 },
  { key: 'text', label: 'text' },
  { key: 'ref', label: 'target' },
  { key: 'selector', label: 'target' },
  { key: 'element', label: 'target' }
]

const KNOWN_KEYS = new Set(KNOWN_ARGS.map(arg => arg.key))

function humanize(key: string): string {
  return capitalize(
    key
      .replace(/[_-]+/g, ' ')
      .trim()
      .toLowerCase()
  )
}

function scalarText(value: unknown, lines?: number): string {
  if (typeof value === 'string') {
    const text = value.trim()

    return lines ? text.split('\n').slice(0, lines).join('\n') : text
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value
      .map(item => item.trim())
      .filter(Boolean)
      .join(', ')
  }

  return ''
}

export function toolCardArgs(args: unknown): ToolCardDetail[] {
  const record = parseMaybeObject(args)
  const rows: ToolCardDetail[] = []
  const labels = new Set<string>()

  const push = (label: string, value: string) => {
    if (!value || labels.has(label) || rows.length >= MAX_ARG_ROWS) {
      return
    }

    labels.add(label)
    rows.push({ label, value: clampText(value, MAX_ARG_CHARS) })
  }

  for (const arg of KNOWN_ARGS) {
    push(translateNow(`assistant.toolCards.argLabels.${arg.label}`), scalarText(record[arg.key], arg.lines))
  }

  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_KEYS.has(key)) {
      push(humanize(key), scalarText(value))
    }
  }

  return rows
}
