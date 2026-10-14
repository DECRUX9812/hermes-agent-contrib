import { stripAnsi } from '@hermes/shared/ansi'

import { compactPreview, findFirstUrl, parseMaybeObject, type ToolPart, type ToolView } from '@/components/assistant-ui/tool/fallback-model'

import { clampText } from './model-args'
import type { ToolCardFamily, ToolCardThumb } from './types'

const MAX_OUTPUT_CHARS = 600
const MAX_REASON_CHARS = 120
const OUTPUT_TEXT_KEYS = ['output', 'stdout', 'content', 'text', 'message', 'summary'] as const
const IMAGE_PATH = /\.(png|jpe?g|webp|gif)$/i
const HTTP_URL = /^https?:\/\//i

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function scalarLine(key: string, value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return `${key}: ${stripAnsi(value).trim()}`
  }

  return typeof value === 'number' || typeof value === 'boolean' ? `${key}: ${value}` : ''
}

function recordOutput(record: Record<string, unknown>, family: ToolCardFamily): string {
  const text = OUTPUT_TEXT_KEYS.map(key => record[key]).find(nonEmptyString)

  if (text) {
    return stripAnsi(text)
  }

  if (family === 'browser') {
    const page = [record.title, record.url].filter(nonEmptyString).join('\n')

    if (page) {
      return page
    }
  }

  return Object.entries(record)
    .map(([key, value]) => scalarLine(key, value))
    .filter(Boolean)
    .join('\n')
}

export function toolCardOutput(result: unknown, family: ToolCardFamily): string | undefined {
  const record = parseMaybeObject(result)
  let text = ''

  if (Object.keys(record).length > 0) {
    text = recordOutput(record, family)
  } else if (typeof result === 'string' && !/^\s*[[{]/.test(result)) {
    text = stripAnsi(result)
  }

  const trimmed = text.trim()

  return trimmed ? clampText(trimmed, MAX_OUTPUT_CHARS) : undefined
}

export function toolCardReason(part: ToolPart, view: ToolView): string | undefined {
  const record = parseMaybeObject(part.result)
  const plainResult = typeof part.result === 'string' && Object.keys(record).length === 0 ? part.result : undefined
  const raw = [record.error, record.message, plainResult].find(nonEmptyString) ?? view.detail
  const firstLine = raw.split('\n').find(line => line.trim())

  return firstLine ? compactPreview(firstLine, MAX_REASON_CHARS) : undefined
}

function screenshotSrc(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  const src = value.trim()

  if (/^data:image\//i.test(src) || HTTP_URL.test(src)) {
    return src
  }

  return IMAGE_PATH.test(src) ? src : ''
}

export function toolCardPageUrl(args: unknown, result: unknown): string | undefined {
  const url = findFirstUrl(parseMaybeObject(args).url, parseMaybeObject(result).url)

  return HTTP_URL.test(url) ? url : undefined
}

export function toolCardThumb(
  family: ToolCardFamily,
  view: ToolView,
  result: unknown,
  pageUrl: string | undefined
): ToolCardThumb | undefined {
  if (family !== 'browser' && family !== 'web') {
    return undefined
  }

  const record = parseMaybeObject(result)
  const src = view.imageUrl || screenshotSrc(record.screenshot_path) || screenshotSrc(record.screenshot)

  if (src) {
    return { kind: 'screenshot', src, url: pageUrl }
  }

  return pageUrl ? { kind: 'site', url: pageUrl, host: new URL(pageUrl).hostname } : undefined
}
