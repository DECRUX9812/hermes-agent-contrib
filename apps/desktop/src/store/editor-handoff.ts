import { type EditorId, editorOpenUrl, isEditorId } from '@/lib/editor-handoff'
import { persistentAtom } from '@/lib/persisted'

import { notifyError } from './notifications'
import { $connection } from './session'

/** Which editor "Open in …" hands files to. A per-device choice (it names an
 *  app installed on THIS machine), so it lives beside the window, not in the
 *  backend's config.yaml. */
export const $preferredEditor = persistentAtom<EditorId>('hermes.desktop.preferredEditor', 'vscode', {
  decode: raw => (isEditorId(raw) ? raw : 'vscode'),
  encode: value => value
})

/** The SSH host the backend's files live on, `''` for a local backend, and
 *  null when files are somewhere no editor can reach (a URL / cloud backend). */
export function editorReachHost(): null | string {
  const connection = $connection.get()

  if (!connection || connection.mode !== 'remote') {
    return ''
  }

  return connection.remoteKind === 'ssh' && connection.remoteHost ? connection.remoteHost : null
}

export const canOpenInEditor = (): boolean => editorReachHost() !== null

/** Hand `path` (optionally at `line`) to the preferred editor. */
export async function openInEditor(path: string, line?: null | number): Promise<boolean> {
  const sshHost = editorReachHost()
  const url = sshHost === null ? null : editorOpenUrl($preferredEditor.get(), { line, path, sshHost })

  if (!url || !window.hermesDesktop?.openExternal) {
    return false
  }

  try {
    await window.hermesDesktop.openExternal(url)

    return true
  } catch (error) {
    notifyError(error, 'Could not open the editor')

    return false
  }
}
