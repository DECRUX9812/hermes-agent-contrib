import { atom } from 'nanostores'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { isPaneVisible, revealTreePane } from '@/components/pane-shell/tree/store'
import { matchesQuery } from '@/hooks/use-media-query'
import { Codecs, persistentAtom } from '@/lib/persisted'

// The Code pane: the user's own VS Code, served on loopback by the main
// process and opened on the chat's project folder, beside the conversation.

// Must match the pane id registered in contrib/controller.
export const CODE_PANE_ID = 'code'

export const $codeOpen = persistentAtom('hermes.desktop.codeOpen', false, Codecs.bool)

export type CodeServerState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'ready'; kind: string; url: string }
  | { status: 'missing' }
  | { status: 'failed'; detail?: string }

/** What the pane shows, for the folder it last asked about. */
export const $codeServer = atom<CodeServerState>({ status: 'idle' })

let requestSeq = 0

/** Ask main for the VS Code URL for `folder`, starting the server on first use. */
export async function loadCodeServer(folder: string): Promise<void> {
  const open = window.hermesDesktop?.openVsCode

  if (!open) {
    $codeServer.set({ status: 'missing' })

    return
  }

  const seq = ++requestSeq

  $codeServer.set({ status: 'starting' })

  const result = await open(folder).catch((error: Error) => ({
    ok: false as const,
    error: 'failed' as const,
    detail: error.message
  }))

  // A newer request (another folder, a retry) owns the pane now.
  if (seq !== requestSeq) {
    return
  }

  if (result.ok) {
    $codeServer.set({ status: 'ready', kind: result.kind, url: result.url })
  } else if (result.error === 'not-installed') {
    $codeServer.set({ status: 'missing' })
  } else {
    $codeServer.set({ status: 'failed', detail: result.detail })
  }
}

export function openCodePane(): void {
  $codeOpen.set(true)
}

export function closeCodePane(): void {
  $codeOpen.set(false)
}

export function toggleCodePane(): void {
  if (isPaneVisible(CODE_PANE_ID)) {
    closeCodePane()
  } else {
    revealCodePane()
  }
}

/** Open (never close) the pane and bring it to the front. Narrow widths
 *  overlay it instead of docking, like the Live pane. */
export function revealCodePane(): void {
  const wasOpen = $codeOpen.get()

  openCodePane()

  if (matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)) {
    if (!wasOpen) {
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: CODE_PANE_ID } }))
    }

    return
  }

  revealTreePane(CODE_PANE_ID)
}
