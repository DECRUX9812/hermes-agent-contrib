import type { HermesTerminalExit, HermesTerminalSession } from '@/global'

type TerminalApi = Window['hermesDesktop']['terminal']

interface BrowserTerminalOptions {
  basePath: string
  currentProfile: () => string | null
  websocketUrl: (profile: string | null) => Promise<string>
  defaultCwd: (profile: string | null) => Promise<string>
}

interface TerminalState {
  id: string
  profile: string | null
  cwd: string
  shell: string
  socket: WebSocket | null
  dataListeners: Set<(payload: string) => void>
  exitListeners: Set<(exit: HermesTerminalExit) => void>
}

const META = '\u0000HERMES_TERMINAL_META:'
const START_TIMEOUT = 10_000

export function createBrowserTerminal(options: BrowserTerminalOptions): TerminalApi {
  const states = new Map<string, TerminalState>()
  let nextId = 1

  function getState(id: string): TerminalState | undefined {
    return states.get(id)
  }

  function emitData(state: TerminalState, data: string): void {
    for (const listener of state.dataListeners) {
      try {
        listener(data)
      } catch {
        // Listener errors must not break the terminal.
      }
    }
  }

  function emitExit(state: TerminalState, exit: HermesTerminalExit): void {
    for (const listener of state.exitListeners) {
      try {
        listener(exit)
      } catch {
        // Listener errors must not break the terminal.
      }
    }
  }

  async function start(opts?: { cols?: number; cwd?: string; rows?: number }): Promise<HermesTerminalSession> {
    const id = `browser-term-${nextId++}`
    const profile = options.currentProfile()
    const cwd = opts?.cwd || await options.defaultCwd(profile)
    const cols = opts?.cols || 80
    const rows = opts?.rows || 24

    const state: TerminalState = {
      id,
      profile,
      cwd,
      shell: '',
      socket: null,
      dataListeners: new Set(),
      exitListeners: new Set(),
    }
    states.set(id, state)

    const url = await options.websocketUrl(profile)
    const socket = new WebSocket(url)
    state.socket = socket

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        socket.close()
        states.delete(id)
        reject(new Error('Terminal connection timed out'))
      }, START_TIMEOUT)

      socket.onopen = () => {
        // Send initial resize
        socket.send(`\u001b[RESIZE:${cols};${rows}]`)
      }

      socket.onmessage = event => {
        if (typeof event.data === 'string' && event.data.startsWith(META)) {
          try {
            const meta = JSON.parse(event.data.slice(META.length))
            if (meta.cwd) state.cwd = meta.cwd
            if (meta.shell) state.shell = meta.shell
            if (meta.ready) {
              window.clearTimeout(timer)
              resolve({ id: state.id, cwd: state.cwd, shell: state.shell })
            }
          } catch {
            // Invalid metadata ignored
          }
          return
        }

        if (typeof event.data === 'string') {
          emitData(state, event.data)
        } else if (event.data instanceof Blob) {
          void event.data.text().then(text => emitData(state, text))
        }
      }

      socket.onerror = () => {
        window.clearTimeout(timer)
        states.delete(id)
        reject(new Error('Terminal connection failed'))
      }

      socket.onclose = event => {
        window.clearTimeout(timer)
        states.delete(id)
        emitExit(state, { code: event.code, signal: event.reason || 'closed' })
      }
    })
  }

  async function write(id: string, data: string): Promise<boolean> {
    const state = getState(id)
    if (!state?.socket || state.socket.readyState !== WebSocket.OPEN) {
      return false
    }
    state.socket.send(data)
    return true
  }

  async function resize(id: string, size: { cols: number; rows: number }): Promise<boolean> {
    const state = getState(id)
    if (!state?.socket || state.socket.readyState !== WebSocket.OPEN) {
      return false
    }
    state.socket.send(`\u001b[RESIZE:${size.cols};${size.rows}]`)
    return true
  }

  async function dispose(id: string): Promise<boolean> {
    const state = getState(id)
    if (!state) return false
    state.socket?.close(1000, 'dispose')
    states.delete(id)
    return true
  }

  async function attach(id: string): Promise<boolean> {
    // Browser terminals don't support reattach; return whether it exists.
    return states.has(id)
  }

  async function cwd(id: string): Promise<string | null> {
    return getState(id)?.cwd || null
  }

  function onData(id: string, callback: (payload: string) => void): () => void {
    const state = getState(id)
    if (!state) return () => undefined
    state.dataListeners.add(callback)
    return () => {
      state.dataListeners.delete(callback)
    }
  }

  function onExit(id: string, callback: (payload: HermesTerminalExit) => void): () => void {
    const state = getState(id)
    if (!state) return () => undefined
    state.exitListeners.add(callback)
    return () => {
      state.exitListeners.delete(callback)
    }
  }

  return {
    attach,
    cwd,
    dispose,
    onData,
    onExit,
    resize,
    start,
    write,
  }
}
