/**
 * Side Pages model (bot-mode c1): the pages a bot produced in this chat,
 * derived from the transcript's own tool calls — a written .html/.md/.svg
 * file or an inline visualization. Pure; the panel and the chat card both
 * read through here so they always agree on what a page is.
 */

export type SidePageKind = 'html' | 'markdown' | 'svg'

export interface SidePage {
  /** Stable key: the written path, else `visual:<tool call id>`. */
  id: string
  kind: SidePageKind
  path: string
  title: string
  content: string
}

interface PartLike {
  type?: unknown
  toolName?: unknown
  toolCallId?: unknown
  args?: unknown
  argsText?: unknown
}

interface MessageLike {
  parts?: readonly unknown[]
}

const WRITE_TOOLS = new Set(['write_file', 'create_file', 'write'])
const VISUAL_TOOLS = new Set(['create_visualization'])

const KIND_BY_EXT: Record<string, SidePageKind> = {
  htm: 'html',
  html: 'html',
  markdown: 'markdown',
  md: 'markdown',
  svg: 'svg'
}

export function pageKindOf(path: string): SidePageKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path.trim())?.[1]?.toLowerCase()

  return (ext && KIND_BY_EXT[ext]) || null
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)

  return parts[parts.length - 1] || path
}

function argsOf(part: PartLike): Record<string, unknown> {
  if (part.args && typeof part.args === 'object') {
    return part.args as Record<string, unknown>
  }

  if (typeof part.argsText === 'string' && part.argsText.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(part.argsText)

      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  return {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** A human title: the document's own `<title>` / first `#` heading, else the
 *  file name. */
export function pageTitle(kind: SidePageKind, content: string, path: string): string {
  if (kind === 'markdown') {
    const heading = /^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/m.exec(content)?.[1]

    if (heading) {
      return heading.slice(0, 120)
    }
  } else {
    const titled = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(content)?.[1]?.trim()

    if (titled) {
      return decodeEntities(titled).slice(0, 120)
    }
  }

  return baseName(path)
}

/** Every page in the transcript, oldest first. A path written twice keeps
 *  one entry holding the latest content, placed where it was last written. */
export function pagesFromMessages(messages: readonly MessageLike[] | null | undefined): SidePage[] {
  const byId = new Map<string, SidePage>()

  for (const message of messages ?? []) {
    for (const raw of message?.parts ?? []) {
      const part = (raw ?? {}) as PartLike

      if (part.type !== 'tool-call') {
        continue
      }

      const tool = text(part.toolName)
      const args = argsOf(part)
      let page: SidePage | null = null

      if (WRITE_TOOLS.has(tool)) {
        const path = text(args.path) || text(args.file_path) || text(args.filename)
        const kind = pageKindOf(path)
        const content = text(args.content) || text(args.text)

        if (path && kind && content) {
          page = { content, id: path, kind, path, title: pageTitle(kind, content, path) }
        }
      } else if (VISUAL_TOOLS.has(tool)) {
        const content = text(args.html) || text(args.content)
        const id = `visual:${text(part.toolCallId) || byId.size}`
        const path = text(args.filename) || `${text(args.title) || 'visualization'}.html`

        if (content) {
          page = { content, id, kind: 'html', path, title: text(args.title) || pageTitle('html', content, path) }
        }
      }

      if (page) {
        byId.delete(page.id)
        byId.set(page.id, page)
      }
    }
  }

  return [...byId.values()]
}

/** The page a `::botpage{path=…}` / `{id=…}` marker points at: exact path or
 *  id first, then a unique file-name match. */
export function findPage(pages: readonly SidePage[], ref: { id?: string; path?: string }): SidePage | null {
  const key = (ref.id || ref.path || '').trim()

  if (!key) {
    return null
  }

  const exact = pages.find(page => page.id === key || page.path === key)

  if (exact) {
    return exact
  }

  const named = pages.filter(page => baseName(page.path) === baseName(key))

  return named.length === 1 ? named[0] : null
}

export function pageMime(kind: SidePageKind): string {
  return kind === 'html' ? 'text/html' : kind === 'svg' ? 'image/svg+xml' : 'text/markdown'
}

/** A `data:` URL for the sandboxed viewer (html / svg only). */
export function pageFrameSrc(page: SidePage): string {
  return `data:${pageMime(page.kind)};charset=utf-8,${encodeURIComponent(page.content)}`
}

/** Download file name: the written file's own name, with an extension. */
export function pageFileName(page: SidePage): string {
  const name = baseName(page.path).replace(/[^\w.\- ]+/g, '_') || 'page'
  const ext = page.kind === 'markdown' ? 'md' : page.kind

  return pageKindOf(name) ? name : `${name}.${ext}`
}

interface HistoryRow {
  args?: unknown
  name?: unknown
  role?: unknown
  tool_call_id?: unknown
  tool_calls?: unknown
}

/** `session.history` rows in the transcript shape `pagesFromMessages` reads.
 *  The gateway projects each finished call as a `tool` row carrying `name`
 *  and parsed `args`; raw stored rows (assistant `tool_calls` with JSON
 *  arguments) are read as well. */
export function historyToMessages(rows: unknown): MessageLike[] {
  if (!Array.isArray(rows)) {
    return []
  }

  return rows.map(raw => {
    const row = (raw ?? {}) as HistoryRow

    if (row.role === 'tool') {
      return { parts: [{ args: row.args, toolCallId: row.tool_call_id, toolName: row.name, type: 'tool-call' }] }
    }

    const calls = Array.isArray(row.tool_calls) ? row.tool_calls : []

    return {
      parts: calls.map(call => {
        const c = (call ?? {}) as { function?: { arguments?: unknown; name?: unknown }; id?: unknown }
        const args = c.function?.arguments

        return {
          args: args && typeof args === 'object' ? args : undefined,
          argsText: typeof args === 'string' ? args : undefined,
          toolCallId: c.id,
          toolName: c.function?.name,
          type: 'tool-call'
        }
      })
    }
  })
}
