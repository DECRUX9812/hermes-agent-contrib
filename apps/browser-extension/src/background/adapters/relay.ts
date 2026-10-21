/**
 * JsonSocket — WebSocket JSON plumbing shared by the relay-backed adapters
 * (cli-harness, acp).
 *
 * MV3 service workers are event-driven and can be reaped mid-conversation, so
 * the socket owns its own liveness: `connect()` is idempotent and lazy (the
 * first caller opens the socket), and unexpected closes schedule an automatic
 * reconnect with capped backoff. Callers never manage reconnect state — they
 * just `await connect()` before `send()`.
 *
 * `onFrame` receives every parsed JSON text frame; `onOpen` fires on the
 * initial connect AND every reconnect (adapters re-handshake there); `onClose`
 * fires on every drop so callers can fail in-flight work.
 */

interface JsonSocketOptions {
  /** Label for console.warn diagnostics. */
  label?: string
  /** ms before first retry; doubles to maxRetryMs. Defaults 1000 → 15000. */
  retryMs?: number
  maxRetryMs?: number
}

export class JsonSocket {
  onFrame: ((frame: Record<string, unknown>) => void) | null = null
  onOpen: (() => void) | null = null
  onClose: (() => void) | null = null

  private ws: WebSocket | null = null
  private openPromise: Promise<void> | null = null
  private closed = false
  private retryDelay: number
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly label: string
  private readonly retryMs: number
  private readonly maxRetryMs: number

  constructor(
    private url: string,
    opts: JsonSocketOptions = {},
  ) {
    this.label = opts.label ?? 'relay'
    this.retryMs = opts.retryMs ?? 1000
    this.maxRetryMs = opts.maxRetryMs ?? 15000
    this.retryDelay = this.retryMs
  }

  /** Open the socket if it isn't open or opening. Resolves on WS open. */
  connect(): Promise<void> {
    if (this.isOpen) {return Promise.resolve()}

    if (!this.openPromise) {
      this.closed = false
      this.openPromise = this.open().catch(e => {
        this.openPromise = null
        throw e
      })
    }

    return this.openPromise
  }

  private open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws

      const timer = setTimeout(() => {
        try { ws.close() } catch { /* half-open */ }
        reject(new Error(`${this.label}: connect timeout`))
      }, 10000)

      ws.onopen = () => {
        clearTimeout(timer)
        this.retryDelay = this.retryMs
        this.onOpen?.()
        resolve()
      }

      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`${this.label}: connect failed (${this.url})`))
      }

      ws.onclose = () => {
        clearTimeout(timer)
        this.handleClose()
      }

      ws.onmessage = ev => {
        let frame: Record<string, unknown>

        try {
          frame = JSON.parse(String(ev.data))
        } catch {
          return // non-JSON frame — relays send JSON only; ignore noise
        }

        try {
          this.onFrame?.(frame)
        } catch (e) {
          console.warn(`[${this.label}] frame handler threw`, e)
        }
      }
    })
  }

  /** Send one JSON frame. Returns false (drops it) when the socket isn't open —
   *  callers that need reliability `await connect()` first. */
  send(obj: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {return false}
    this.ws.send(JSON.stringify(obj))

    return true
  }

  private handleClose() {
    this.ws = null
    this.openPromise = null
    this.onClose?.()

    if (this.closed) {return}

    if (this.retryTimer) {clearTimeout(this.retryTimer)}
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect().catch(e => {
        console.warn(`[${this.label}] reconnect failed`, e)
      })
    }, this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryMs)
  }

  /** Permanent shutdown — no more reconnects. Reconnect-able: a later
   *  connect() opens a fresh socket. */
  close() {
    this.closed = true

    if (this.retryTimer) {clearTimeout(this.retryTimer)}
    this.retryTimer = null

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
