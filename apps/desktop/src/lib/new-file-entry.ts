export interface NewEntryPlan {
  /** Absolute folders to create first, outermost first (`src`, `src/utils`). */
  folders: string[]
  /** The absolute path of the file (or folder) the user named. */
  target: string
}

const INVALID_SEGMENT = /^\.{1,2}$|[<>:"|?*]/

// Control characters can't be typed into a text field anyway; checked by code
// point so the pattern stays free of raw control-character classes.
const hasControlChar = (segment: string) => [...segment].some(char => char.charCodeAt(0) < 0x20)

/**
 * Turn what the user typed in the tree's "New file / New folder" field into
 * the paths to create under `base`. Slashes make intermediate folders
 * (`src/utils/date.ts`), VS Code style. Returns null for anything that could
 * leave `base` or name nothing: an absolute path, `..`, an empty name.
 */
export function planNewEntry(base: string, typed: string): NewEntryPlan | null {
  const trimmed = typed.trim().replace(/\\/g, '/')

  if (!trimmed || trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) {
    return null
  }

  const segments = trimmed.split('/').filter(Boolean)

  if (segments.length === 0 || segments.some(segment => INVALID_SEGMENT.test(segment) || hasControlChar(segment))) {
    return null
  }

  const root = base.replace(/[\\/]+$/, '')
  const folders: string[] = []
  let acc = root

  for (const segment of segments.slice(0, -1)) {
    acc = `${acc}/${segment}`
    folders.push(acc)
  }

  return { folders, target: `${acc}/${segments.at(-1)}` }
}
