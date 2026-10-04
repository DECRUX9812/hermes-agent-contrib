import { atom } from 'nanostores'

/**
 * Preview-verify pass/fail rows (roadmap #33): each `preview.verify` answer a
 * session's agent receives posts a card to that session's status stack —
 * spinner while the settle window runs, then pass or fail with the error
 * count. Session-scoped and in-memory on purpose: a verdict is a moment in a
 * loop, not state worth persisting.
 */

export interface PreviewVerifyRecord {
  at: number
  errorCount: number
  /** First console error's message — the row's subtext on failure. */
  firstError?: string
  ok: boolean
  running: boolean
  /** Console-store key of the verified tab ("open console" target). */
  tabId?: string
  url?: string
}

export const $previewVerifyBySession = atom<Record<string, PreviewVerifyRecord>>({})

export function recordPreviewVerifyRunning(sessionId: string): void {
  if (!sessionId) {
    return
  }

  $previewVerifyBySession.set({
    ...$previewVerifyBySession.get(),
    [sessionId]: { at: Date.now(), errorCount: 0, ok: false, running: true }
  })
}

export function recordPreviewVerifyResult(
  sessionId: string,
  result: { errorCount: number; firstError?: string; ok: boolean; tabId?: string; url?: string }
): void {
  if (!sessionId) {
    return
  }

  $previewVerifyBySession.set({
    ...$previewVerifyBySession.get(),
    [sessionId]: { at: Date.now(), running: false, ...result }
  })
}

export function dismissPreviewVerify(sessionId: string): void {
  const next = { ...$previewVerifyBySession.get() }

  delete next[sessionId]
  $previewVerifyBySession.set(next)
}
