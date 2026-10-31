import { atom } from 'nanostores'

// Mirrors `display.tool_progress`, independent of `display.show_reasoning`:
// hiding thinking must not hide the work. Answer-only is both keys off.
// The transcript's hard-coded default is hidden: only an explicit opt-in
// (true / "on" / "all" / "new" / "verbose") shows tool rows; a missing,
// unknown or "off" value keeps them — and file-edit rows — out of the feed.
export const $showToolActivity = atom(false)

const TOOL_PROGRESS_ON = new Set(['all', 'new', 'on', 'verbose'])

export function toolProgressVisible(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  return typeof value === 'string' && TOOL_PROGRESS_ON.has(value.trim().toLowerCase())
}

export function setShowToolActivityFromConfig(value: unknown): void {
  $showToolActivity.set(toolProgressVisible(value))
}
