/** One Quick Open row: a project file or folder, relative to the project root. */
export interface QuickOpenItem {
  dir: string
  isDir: boolean
  name: string
  rel: string
}

export interface QuickOpenQuery {
  /** A `:line` suffix (`app.ts:42`, `app.ts:42:7`) — where to land. */
  line: null | number
  query: string
}

/** Split a typed query into the name to search and an optional `:line`. */
export function parseQuickOpenQuery(raw: string): QuickOpenQuery {
  const text = raw.trim()
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(text)

  if (match && match[1]) {
    return { line: Math.max(1, Number(match[2])), query: match[1] }
  }

  return { line: null, query: text }
}

const COMPLETION_RE = /^@(file|folder):(.+)$/

/**
 * Rows from the backend's `complete.path` answer (the same fuzzy, git-aware
 * search the composer's `@` uses, so it works on a remote backend too). Only
 * file and folder references are kept; agent mentions and plugin rows drop.
 */
export function quickOpenItems(items: readonly { text?: string }[]): QuickOpenItem[] {
  const seen = new Set<string>()
  const rows: QuickOpenItem[] = []

  for (const item of items) {
    const match = COMPLETION_RE.exec(item.text ?? '')

    if (!match) {
      continue
    }

    const isDir = match[1] === 'folder' || match[2].endsWith('/')
    const rel = match[2].replace(/\/+$/, '')

    if (!rel || seen.has(rel)) {
      continue
    }

    seen.add(rel)
    const cut = rel.lastIndexOf('/')
    rows.push({ dir: cut < 0 ? '' : rel.slice(0, cut), isDir, name: rel.slice(cut + 1), rel })
  }

  return rows
}

/** Absolute path of a project-relative row (an absolute `rel` is kept). */
export function quickOpenPath(root: string, rel: string): string {
  if (rel.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rel)) {
    return rel
  }

  return `${root.replace(/[\\/]+$/, '')}/${rel.replace(/^\.\//, '')}`
}
