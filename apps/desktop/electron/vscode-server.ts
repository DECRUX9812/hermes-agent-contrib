// VS Code inside the app: which VS Code server to run, how, and what URL the
// Code pane loads.
//
// The pane shows the user's own VS Code (their settings, extensions and keys),
// served on loopback and opened on the chat's project folder. Nothing is
// bundled: we run a server the machine already has, as an ordered ladder.
//
//  1. `code serve-web` — built into VS Code since 1.88, so most developers
//     already have it. Insiders next.
//  2. `openvscode-server` — the standalone build people run on servers.
//
// code-server is deliberately absent: it replaces VS Code's connection token
// with its own password login, which a pane can't satisfy without storing a
// password, and `--auth none` would hand the editor (a shell) to any local
// process. Every rung here binds 127.0.0.1 and requires a fresh random token
// in the URL, so another user or process on the box can't attach.
//
// Pure so it can be unit-tested without Electron; spawning lives in
// vscode-ipc.ts.

export type VsCodeServerKind = 'code' | 'code-insiders' | 'openvscode-server'

export interface VsCodeServerCandidate {
  kind: VsCodeServerKind
  /** Absolute path of the executable that was found. */
  path: string
}

const LADDER: readonly VsCodeServerKind[] = ['code', 'code-insiders', 'openvscode-server']

/** Every installed server, best first. A rung that fails to start falls to the next. */
export function vsCodeServerCandidates(findOnPath: (command: string) => null | string): VsCodeServerCandidate[] {
  return LADDER.flatMap(kind => {
    const found = findOnPath(kind)

    return found ? [{ kind, path: found }] : []
  })
}

export interface VsCodeServerLaunch {
  command: string
  args: string[]
}

/** Argv that serves `candidate` on 127.0.0.1:`port`, gated by `token`. */
export function vsCodeServerLaunch(
  candidate: VsCodeServerCandidate,
  port: number,
  token: string,
  platform: NodeJS.Platform = process.platform
): VsCodeServerLaunch {
  const serve =
    candidate.kind === 'openvscode-server'
      ? ['--host', '127.0.0.1', '--port', String(port), '--connection-token', token]
      : [
          'serve-web',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--connection-token',
          token,
          '--accept-server-license-terms'
        ]

  // `code` on Windows is a .cmd shim, which CreateProcess can't run directly.
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(candidate.path)) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', candidate.path, ...serve] }
  }

  return { command: candidate.path, args: serve }
}

/** A filesystem path as the URI path VS Code's `folder` parameter takes (`C:\x` → `/C:/x`). */
export function vsCodeFolderParam(folder: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `/${folder.replaceAll('\\', '/')}` : folder
}

/** The page the Code pane loads: the token, and the folder to open when there is one. */
export function vsCodeServerUrl(
  port: number,
  token: string,
  folder?: string,
  platform: NodeJS.Platform = process.platform
): string {
  const url = new URL(`http://127.0.0.1:${port}/`)

  url.searchParams.set('tkn', token)

  if (folder) {
    url.searchParams.set('folder', vsCodeFolderParam(folder, platform))
  }

  return url.toString()
}
