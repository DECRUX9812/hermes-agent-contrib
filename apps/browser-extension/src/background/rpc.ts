/**
 * Minimal JSON-RPC over WebSocket client for `hermes serve`/`dashboard`
 * (`/api/ws`). Auth ladder, in order:
 *
 *   1. `POST {base}/api/auth/ws-ticket` with the bearer credential —
 *      succeeds on OAuth-gated backends and yields a single-use ticket whose
 *      WS connection carries a server-minted identity (unlocks the privileged
 *      `browser.controller.*` methods).
 *   2. `?token=` directly — the legacy shared-token path. Everything except
 *      controller registration works.
 *
 * Server→client frames: JSON-RPC results (matched by `id`), `event`
 * notifications `{type, session_id, payload}`, and `req` server requests
 * (approvals — answered `cancel` so nothing waits on us).
 */

export interface RpcEvent {
  type: string
  session_id?: string
  payload?: Record<string, unknown>
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class GatewayRpc {
  private ws: WebSocket | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private openPromise: Promise<void> | null = null
  private closed = false
  hasIdentity = false

  /** Fires for every `event` notification. */
  onEvent: ((ev: RpcEvent) => void) | null = null
  onClose: (() => void) | null = null

  constructor(
    private baseUrl: string,
    private token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private wsBase(): string {
    return this.baseUrl.replace(/^http/, 'ws')
  }

  private async mintTicket(): Promise<string | null> {
    try {
      const r = await fetch(`${this.baseUrl}/api/auth/ws-ticket`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'X-Hermes-Session': this.token,
        },
      })

      if (!r.ok) {return null}
      const body = (await r.json()) as { ticket?: string }

      return body.ticket ?? null
    } catch {
      return null
    }
  }

  async connect(): Promise<void> {
    if (this.openPromise) {return this.openPromise}
    this.closed = false
    this.openPromise = this.open().catch(e => {
      this.openPromise = null
      throw e
    })

    return this.openPromise
  }

  private async open(): Promise<void> {
    const ticket = await this.mintTicket()

    const wsUrl = ticket
      ? `${this.wsBase()}/api/ws?ticket=${encodeURIComponent(ticket)}`
      : `${this.wsBase()}/api/ws?token=${encodeURIComponent(this.token)}`

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      this.ws = ws
      const timer = setTimeout(() => reject(new Error('ws connect timeout')), 15000)

      ws.onopen = () => {
        clearTimeout(timer)
        this.hasIdentity = ticket !== null
        resolve()
      }

      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('ws connect failed'))
      }

      ws.onclose = ev => {
        if (ev.code === 4403) {reject(new Error(`auth rejected: ${ev.reason || '4403'}`))}
        this.handleClose()
      }

      ws.onmessage = ev => this.handleMessage(ev.data as string)
    })
  }

  private handleMessage(raw: string) {
    let frame: Record<string, unknown>

    try {
      frame = JSON.parse(raw)
    } catch {
      return
    }

    // Result frame
    if (typeof frame.id === 'number' && ('result' in frame || 'error' in frame)) {
      const p = this.pending.get(frame.id)

      if (!p) {return}
      this.pending.delete(frame.id)
      clearTimeout(p.timer)

      if (frame.error) {
        const err = frame.error as { message?: string }
        p.reject(new Error(err.message || JSON.stringify(frame.error)))
      } else {
        p.resolve(frame.result)
      }

      return
    }

    // Event notification
    if (frame.method === 'event' && frame.params) {
      this.onEvent?.(frame.params as RpcEvent)

      return
    }

    // Server→client request (approval/clarify/…): refuse politely so the
    // agent isn't left hanging on a UI that doesn't exist.
    if (frame.method === 'req' || typeof frame.method === 'string' && frame.id !== undefined && frame.params !== undefined) {
      this.rawSend({
        jsonrpc: '2.0',
        id: frame.id,
        error: { code: -32601, message: 'bot-room: no interactive handler' },
      })
    }
  }

  private rawSend(obj: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj))
    }
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60000): Promise<T> {
    await this.connect()
    const id = ++this.seq

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method}: timeout`))
      }, timeoutMs)

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.rawSend({ jsonrpc: '2.0', id, method, params })
    })
  }

  private handleClose() {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('ws closed'))
    }

    this.pending.clear()
    this.ws = null
    this.openPromise = null

    if (!this.closed) {this.onClose?.()}
  }

  close() {
    this.closed = true

    try {
      this.ws?.close()
    } catch { /* already gone */ }

    this.ws = null
    this.openPromise = null
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
