/**
 * PREVIEW VERIFY — the renderer half of the `verify_preview` tool (roadmap
 * #33): resolve the preview the user is looking at, let pending console
 * traffic settle, then answer pass/fail from the tab's console log
 * (`preview-console-store.ts`). Read-only — it never opens, reloads, or
 * touches the page; that's `desktop_preview` / `drive_preview`'s job.
 */

import type { ConsoleEntry } from '@/app/chat/right-rail/preview-console-state'
import { previewConsoleState } from '@/app/chat/right-rail/preview-console-store'
import { resolveActivePreviewTab } from '@/app/chat/right-rail/preview-reader'

export interface PreviewVerifyError {
  level: number
  line?: number
  message: string
  source?: string
}

export interface PreviewVerifyResult {
  errorCount: number
  /** Capped at PREVIEW_VERIFY_MAX_ERRORS — the agent iterates on the list. */
  errors: PreviewVerifyError[]
  ok: boolean
  /** The console-store key the logs were read from (the row's "open console". */
  tabId: string
  title: string
  url: string
  warningCount: number
}

export interface PreviewVerifyFailure {
  error: string
  ok: false
}

export type PreviewVerifyOutcome = PreviewVerifyFailure | PreviewVerifyResult

export const PREVIEW_VERIFY_DEFAULT_SETTLE_MS = 1_200
export const PREVIEW_VERIFY_MAX_SETTLE_MS = 10_000
const PREVIEW_VERIFY_MAX_ERRORS = 20

// Webview console-message levels (Electron): 0 verbose, 1 info, 2 warning, 3
// error — the same scale PreviewPane's own level-3 checks use.
const CONSOLE_LEVEL_WARNING = 2
const CONSOLE_LEVEL_ERROR = 3

/** Pure pass/fail over a console log — exported for tests. */
export function verifyResultFromLogs(
  tabId: string,
  url: string,
  title: string,
  logs: readonly ConsoleEntry[]
): PreviewVerifyResult {
  const errors: PreviewVerifyError[] = []
  let warningCount = 0

  for (const entry of logs) {
    if (entry.level >= CONSOLE_LEVEL_ERROR) {
      if (errors.length < PREVIEW_VERIFY_MAX_ERRORS) {
        errors.push({ level: entry.level, line: entry.line, message: entry.message, source: entry.source })
      }
    } else if (entry.level >= CONSOLE_LEVEL_WARNING) {
      warningCount += 1
    }
  }

  // errorCount is the true total, not the (possibly capped) array length.
  const errorCount = logs.filter(entry => entry.level >= CONSOLE_LEVEL_ERROR).length

  return {
    errorCount,
    errors,
    ok: errorCount === 0,
    tabId,
    title,
    url,
    warningCount
  }
}

/** Wait `settleMs`, then answer the active preview's pass/fail — or a failure
 *  telling the agent there's nothing open to check. */
export async function verifyActivePreview(opts: { settleMs?: number } = {}): Promise<PreviewVerifyOutcome> {
  const settle = Math.max(0, Math.min(opts.settleMs ?? PREVIEW_VERIFY_DEFAULT_SETTLE_MS, PREVIEW_VERIFY_MAX_SETTLE_MS))

  if (settle > 0) {
    await new Promise(resolve => setTimeout(resolve, settle))
  }

  const tab = resolveActivePreviewTab()

  if (!tab) {
    return { error: 'No preview is open — open the built app with desktop_preview first.', ok: false }
  }

  // The console store keys on the tab id (see preview-pane.tsx).
  const key = tab.id
  const logs = previewConsoleState(key).$logs.get()

  return verifyResultFromLogs(key, tab.target.url, tab.target.label, logs)
}
