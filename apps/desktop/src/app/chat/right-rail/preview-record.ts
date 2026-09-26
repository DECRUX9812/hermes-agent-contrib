/**
 * Record-a-task host side (roadmap #46): drives the guest recorder from the
 * preview pane. The in-page listener dies with every navigation — the pane
 * owns re-installing on `dom-ready` and appending `navigate` steps itself,
 * since a guest cannot observe its own teardown.
 *
 * Injection follows the annotate contract exactly: build the install script
 * by concatenation (never a template literal — the engine source contains
 * `${...}` the host must not evaluate) and reuse `executeJavaScript`.
 */

import { type RecordedStep, recordInPageSource } from '@/lib/preview-record/in-page'

/** Anything that can run script in the guest — the pane's webview bridge. */
export interface PreviewRecordGuest {
  executeJavaScript: (code: string) => Promise<unknown>
}

/** How often the host drains the guest's step list while recording. A drain
 *  doubles as the liveness probe that lands steps before a full navigation
 *  tears the document (and the recorder) down. */
export const RECORD_POLL_MS = 800

export function recordInstallScript(): string {
  return '(function(){var api=' + recordInPageSource() + ';window.__hermesRecord=api;api.install();})()'
}

export async function installRecorder(guest: PreviewRecordGuest): Promise<void> {
  await guest.executeJavaScript(recordInstallScript())
}

/** Take the steps the guest captured since the last drain. Returns [] when the
 *  recorder isn't there (fresh document, remote preview) instead of throwing. */
export async function drainRecorderSteps(guest: PreviewRecordGuest): Promise<RecordedStep[]> {
  const out = await guest.executeJavaScript(
    '(window.__hermesRecord && window.__hermesRecord.drain) ? window.__hermesRecord.drain() : []'
  )

  return Array.isArray(out) ? (out as RecordedStep[]) : []
}

export async function teardownRecorder(guest: PreviewRecordGuest): Promise<void> {
  await guest.executeJavaScript(
    '(function(){if(window.__hermesRecord&&window.__hermesRecord.teardown){window.__hermesRecord.teardown();}window.__hermesRecord=undefined;})()'
  )
}
