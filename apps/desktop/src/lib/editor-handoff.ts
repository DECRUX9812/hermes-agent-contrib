/** Editors a file can be handed to, by their URL scheme. The main process
 *  opens only the `<scheme>://file/…` and remote-SSH shapes built here. */
export const EDITORS = [
  { id: 'vscode', label: 'VS Code', scheme: 'vscode' },
  { id: 'cursor', label: 'Cursor', scheme: 'cursor' },
  { id: 'windsurf', label: 'Windsurf', scheme: 'windsurf' },
  { id: 'zed', label: 'Zed', scheme: 'zed' }
] as const

export type EditorId = (typeof EDITORS)[number]['id']

export const isEditorId = (value: unknown): value is EditorId => EDITORS.some(editor => editor.id === value)

export const editorLabel = (id: EditorId): string => EDITORS.find(editor => editor.id === id)!.label

export interface EditorTarget {
  line?: null | number
  path: string
  /** `user@host` (or an ssh-config alias) when the file lives on an SSH backend. */
  sshHost?: null | string
}

/** `C:\a\b` → `/C:/a/b`; POSIX paths pass through. Segments are URI-encoded. */
function uriPath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const rooted = /^[a-zA-Z]:\//.test(slashed) ? `/${slashed}` : slashed

  return rooted.split('/').map(segment => encodeURIComponent(segment).replace(/%3A/gi, ':')).join('/')
}

/**
 * The URL that opens `path` (at `line`) in `editor`, or null when the editor
 * cannot reach it — a relative path, or an SSH file for an editor without a
 * remote-SSH scheme.
 */
export function editorOpenUrl(editor: EditorId, { line, path, sshHost }: EditorTarget): null | string {
  if (!path.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(path)) {
    return null
  }

  const at = line && line > 0 ? `:${Math.floor(line)}` : ''
  const scheme = EDITORS.find(entry => entry.id === editor)!.scheme
  const host = sshHost?.trim()

  if (!host) {
    return `${scheme}://file${uriPath(path)}${at}`
  }

  if (editor === 'zed') {
    return `zed://ssh/${encodeURIComponent(host).replace(/%40/g, '@')}${uriPath(path)}${at}`
  }

  return `${scheme}://vscode-remote/ssh-remote+${encodeURIComponent(host)}${uriPath(path)}${at}`
}
