// The Code pane's VS Code server: started on first use, shared by every window,
// stopped when the app quits. hermes:vscode:open answers with the URL a pane
// loads for a folder; which server and how it is launched is vscode-server.ts.
import { type ChildProcess, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import net from 'node:net'

import { ipcMain } from 'electron'

import {
  type VsCodeServerCandidate,
  vsCodeServerCandidates,
  type VsCodeServerKind,
  vsCodeServerLaunch,
  vsCodeServerUrl
} from './vscode-server'

export interface VsCodeIpcDeps {
  findOnPath: (command: string) => null | string
  rememberLog: (line: string) => void
}

export type VsCodeOpenResult =
  { ok: true; kind: VsCodeServerKind; url: string } | { ok: false; error: 'failed' | 'not-installed'; detail?: string }

interface RunningServer {
  child: ChildProcess
  kind: VsCodeServerKind
  port: number
  token: string
}

// `code serve-web` downloads its server on the very first run, so the first
// start may take a while; later starts answer in a second or two.
const READY_TIMEOUT_MS = 180_000
const READY_POLL_MS = 400

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0

      server.close(() => resolve(port))
    })
  })
}

/** Resolves once the server answers HTTP with the token, rejects when the child exits first or time runs out. */
function waitReady(child: ChildProcess, port: number, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + READY_TIMEOUT_MS
    let done = false

    const finish = (error?: Error) => {
      if (done) {
        return
      }

      done = true
      child.off('exit', onExit)
      error ? reject(error) : resolve()
    }

    const onExit = (code: null | number) => finish(new Error(`exited with code ${code}`))

    child.on('exit', onExit)

    const poll = () => {
      if (done) {
        return
      }

      if (Date.now() > deadline) {
        finish(new Error('did not start in time'))

        return
      }

      fetch(`http://127.0.0.1:${port}/?tkn=${token}`, { redirect: 'manual' })
        .then(response => (response.status < 500 ? finish() : setTimeout(poll, READY_POLL_MS)))
        .catch(() => setTimeout(poll, READY_POLL_MS))
    }

    poll()
  })
}

export function registerVsCodeIpc({ findOnPath, rememberLog }: VsCodeIpcDeps) {
  let running: null | RunningServer = null
  let starting: null | Promise<null | RunningServer> = null
  let lastError = ''

  const log = (line: string) => rememberLog(`[vscode] ${line}`)

  async function tryStart(candidate: VsCodeServerCandidate): Promise<null | RunningServer> {
    const port = await freePort()
    const token = crypto.randomBytes(24).toString('hex')
    const launch = vsCodeServerLaunch(candidate, port, token)

    log(`starting ${candidate.kind} on 127.0.0.1:${port}`)

    const child = spawn(launch.command, launch.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

    // The server logs its URL (token included); keep only lines without it.
    const relay = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim() && !line.includes(token)) {
          log(line.trim().slice(0, 300))
        }
      }
    }

    child.stdout?.on('data', relay)
    child.stderr?.on('data', relay)
    child.on('error', error => log(`${candidate.kind}: ${error.message}`))

    try {
      await waitReady(child, port, token)
    } catch (error) {
      lastError = `${candidate.kind} ${(error as Error).message}`
      log(lastError)
      child.kill()

      return null
    }

    const server = { child, kind: candidate.kind, port, token }

    child.on('exit', code => {
      log(`${candidate.kind} stopped (code ${code})`)

      if (running === server) {
        running = null
      }
    })

    return server
  }

  async function ensureServer(): Promise<null | RunningServer> {
    if (running) {
      return running
    }

    starting ??= (async () => {
      for (const candidate of vsCodeServerCandidates(findOnPath)) {
        const server = await tryStart(candidate)

        if (server) {
          return server
        }
      }

      return null
    })().finally(() => {
      starting = null
    })

    running = await starting

    return running
  }

  ipcMain.handle('hermes:vscode:open', async (_event, folder): Promise<VsCodeOpenResult> => {
    if (!vsCodeServerCandidates(findOnPath).length && !running) {
      return { ok: false, error: 'not-installed' }
    }

    const server = await ensureServer()

    if (!server) {
      return { ok: false, error: 'failed', detail: lastError }
    }

    const target = typeof folder === 'string' && folder.trim() ? folder.trim() : undefined

    return { ok: true, kind: server.kind, url: vsCodeServerUrl(server.port, server.token, target) }
  })

  return {
    dispose() {
      running?.child.kill()
      running = null
    }
  }
}
