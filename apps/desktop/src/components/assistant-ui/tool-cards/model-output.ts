import { stripAnsi } from '@hermes/shared/ansi'

import { compactPreview, findFirstUrl, parseMaybeObject, type ToolPart, type ToolView } from '@/components/assistant-ui/tool/fallback-model'

import { clampText } from './model-args'
import type { ToolCardFamily, ToolCardThumb } from './types'

const MAX_OUTPUT_CHARS = 600
const MAX_REASON_CHARS = 120
const OUTPUT_TEXT_KEYS = ['output', 'stdout', 'content', 'text', 'message', 'summary'] as const
const IMAGE_PATH = /\.(png|jpe?g|webp|gif)(\?|#|$)/i
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

const UNTRUSTED_WRAPPER = /^\s*<untrusted_tool_result\b[^>]*>([\s\S]*?)<\/untrusted_tool_result>\s*$/i

/** The gateway fences tool output as `<untrusted_tool_result>` with a short
 *  preamble before the tool's JSON. Cards read the JSON, not the fence. */
export function unwrapToolResult(result: unknown): unknown {
  if (typeof result !== 'string') {
    return result
  }

  const inner = UNTRUSTED_WRAPPER.exec(result)?.[1]

  if (inner === undefined) {
    return result
  }

  const start = inner.search(/^\s*\{/m)

  if (start >= 0) {
    try {
      const parsed: unknown = JSON.parse(inner.slice(start).trim())

      if (parsed && typeof parsed === 'object') {
        return parsed
      }
    } catch {
      // Not JSON after all: fall through to the plain text inside the fence.
    }
  }

  return inner.trim()
}

export function toolCardOutput(rawResult: unknown, family: ToolCardFamily): string | undefined {
  const result = unwrapToolResult(rawResult)
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

const SCREENSHOT_KEYS = ['screenshot_path', 'screenshot', 'screenshot_url', 'image_path', 'image_url', 'image'] as const

function lastOf(value: unknown): unknown {
  return Array.isArray(value) ? value[value.length - 1] : undefined
}

function screenshotSrc(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  const src = value.trim()

  if (/^data:image\//i.test(src)) {
    return src
  }

  return IMAGE_PATH.test(src) ? src : ''
}

const URL_IN_TEXT = /https?:\/\/[^\s"'`<>()[\]{}\\]+/i
const URL_TEXT_KEYS = ['code', 'task', 'instruction', 'instructions', 'goal', 'text', 'command', 'script'] as const
const RESULT_URL_KEYS = ['url', 'page_url', 'current_url', 'final_url'] as const

/** The first http(s) address written inside free text, trailing punctuation trimmed. */
export function urlInText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  const match = URL_IN_TEXT.exec(value)

  return match ? match[0].replace(/[.,;:!?'"]+$/, '') : ''
}

function validUrl(value: string): string {
  if (!HTTP_URL.test(value)) {
    return ''
  }

  try {
    return new URL(value).hostname ? value : ''
  } catch {
    return ''
  }
}

/** The page a browser or web call worked on: an explicit url field first,
 *  then an address written in its code or task (browser_exec scripts), then
 *  one the result reports. */
export function toolCardPageUrl(args: unknown, rawResult: unknown): string | undefined {
  const result = unwrapToolResult(rawResult)
  const argRecord = parseMaybeObject(args)
  const resultRecord = parseMaybeObject(result)

  const candidates = [
    findFirstUrl(argRecord.url, ...RESULT_URL_KEYS.map(key => resultRecord[key])),
    ...URL_TEXT_KEYS.map(key => urlInText(argRecord[key])),
    ...OUTPUT_TEXT_KEYS.map(key => urlInText(resultRecord[key])),
    urlInText(typeof result === 'string' ? result : '')
  ]

  for (const candidate of candidates) {
    const url = validUrl(candidate)

    if (url) {
      return url
    }
  }

  return undefined
}

export function toolCardThumb(
  family: ToolCardFamily,
  view: ToolView,
  result: unknown,
  pageUrl: string | undefined
): ToolCardThumb | undefined {
  if (family !== 'browser' && family !== 'web') {
    // Other tools (MCP fetchers, generic HTTP helpers) only get a site chip
    // for an address they were explicitly asked to open.
    return pageUrl ? { kind: 'site', url: pageUrl, host: new URL(pageUrl).hostname } : undefined
  }

  const record = parseMaybeObject(unwrapToolResult(result))

  const src =
    view.imageUrl ||
    SCREENSHOT_KEYS.map(key => screenshotSrc(record[key])).find(Boolean) ||
    screenshotSrc(lastOf(record.screenshots))

  if (src) {
    return { kind: 'screenshot', src, url: pageUrl }
  }

  return pageUrl ? { kind: 'site', url: pageUrl, host: new URL(pageUrl).hostname } : undefined
}
