/**
 * MCP Apps host bridge — the JSON-RPC 2.0 dialogue between a sandboxed app
 * iframe and Hermes (modelcontextprotocol/ext-apps; OpenAI MCP Extensions
 * build on the same wire). Pure and table-driven: every app→host method is
 * one handler, so each is testable without an iframe.
 *
 * Trust: the app is untrusted script. It can only reach the host through the
 * handlers below — tool calls on its own server (the gateway enforces the
 * `app` visibility and trust gates), text into the composer (never sent for
 * the user), and links the user must click to open.
 */

export const MCP_APPS_PROTOCOL_VERSION = '2026-01-26'

export interface JsonRpcMessage {
  error?: { code: number; data?: unknown; message: string }
  id?: null | number | string
  jsonrpc?: '2.0'
  method?: string
  params?: Record<string, unknown>
  result?: unknown
}

export interface McpAppBridgeDeps {
  /** `tools/call` on the app's own server (gateway `mcp_apps.call`). */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  /** Theme, locale, display mode — `hostContext` in `ui/initialize`. */
  hostContext: () => Record<string, unknown>
  /** Offer an http(s) link; the user's click opens it. */
  offerLink: (url: string) => void
  /** Put app-authored text in the composer for the user to review and send. */
  draftMessage: (text: string) => void
  /** The app finished initializing — send it the tool input/result. */
  onInitialized: () => void
  /** Rendered content height changed. */
  onSize: (height: number) => void
}

export const JSON_RPC_METHOD_NOT_FOUND = -32601
export const JSON_RPC_INVALID_PARAMS = -32602
export const JSON_RPC_SERVER_ERROR = -32000

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

const isWebUrl = (raw: unknown): raw is string => {
  if (typeof raw !== 'string') {
    return false
  }

  try {
    const { protocol } = new URL(raw)

    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** Text blocks of an MCP content array, joined — images/resources are not
 *  drafted into the composer (a later slice attaches them). */
export function contentText(content: unknown): string {
  return (Array.isArray(content) ? content : [])
    .filter(block => block && typeof block === 'object' && (block as { type?: unknown }).type === 'text')
    .map(block => String((block as { text?: unknown }).text ?? ''))
    .filter(Boolean)
    .join('\n\n')
}

type Handler = (params: Record<string, unknown>, deps: McpAppBridgeDeps) => Promise<unknown> | unknown

const REQUESTS: Record<string, Handler> = {
  'ui/initialize': (params, deps) => ({
    protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_APPS_PROTOCOL_VERSION,
    hostInfo: { name: 'hermes-desktop', version: '1' },
    hostCapabilities: { logging: {}, message: { text: {} }, openLinks: {}, serverTools: {} },
    hostContext: deps.hostContext()
  }),
  'tools/call': (params, deps) => {
    if (typeof params.name !== 'string' || !params.name) {
      throw new RpcError(JSON_RPC_INVALID_PARAMS, 'tools/call needs a tool name')
    }

    const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}

    return deps.callTool(params.name, args as Record<string, unknown>)
  },
  'ui/open-link': (params, deps) => {
    if (!isWebUrl(params.url)) {
      throw new RpcError(JSON_RPC_INVALID_PARAMS, 'only http(s) links can be opened')
    }

    deps.offerLink(params.url)

    return {}
  },
  'ui/message': (params, deps) => {
    const text = contentText(params.content)

    if (!text) {
      throw new RpcError(JSON_RPC_INVALID_PARAMS, 'ui/message needs text content')
    }

    deps.draftMessage(text)

    return {}
  },
  // Inline only in this slice; the answer names the mode the app actually has.
  'ui/request-display-mode': () => ({ mode: 'inline' }),
  ping: () => ({})
}

const NOTIFICATIONS: Record<string, Handler> = {
  'ui/notifications/initialized': (_params, deps) => deps.onInitialized(),
  'ui/notifications/size-changed': (params, deps) => {
    const height = Number(params.height)

    if (Number.isFinite(height) && height > 0) {
      deps.onSize(height)
    }
  },
  'notifications/message': () => undefined
}

/** One app's bridge. `post` sends a JSON-RPC message into the iframe. */
export function createMcpAppBridge(deps: McpAppBridgeDeps, post: (message: JsonRpcMessage) => void) {
  return {
    /** Handle one message from the app (already origin-checked by the caller). */
    async receive(raw: unknown): Promise<void> {
      if (!raw || typeof raw !== 'object') {
        return
      }

      const message = raw as JsonRpcMessage
      const method = typeof message.method === 'string' ? message.method : ''
      const params = message.params && typeof message.params === 'object' ? message.params : {}
      const isRequest = message.id !== undefined && message.id !== null

      if (!method) {
        return
      }

      if (!isRequest) {
        await NOTIFICATIONS[method]?.(params, deps)

        return
      }

      const handler = REQUESTS[method]

      if (!handler) {
        post({
          error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `${method} is not supported` },
          id: message.id,
          jsonrpc: '2.0'
        })

        return
      }

      try {
        post({ id: message.id, jsonrpc: '2.0', result: (await handler(params, deps)) ?? {} })
      } catch (error) {
        post({
          error: {
            code: error instanceof RpcError ? error.code : JSON_RPC_SERVER_ERROR,
            message: error instanceof Error ? error.message : String(error)
          },
          id: message.id,
          jsonrpc: '2.0'
        })
      }
    },

    notify(method: string, params: Record<string, unknown>) {
      post({ jsonrpc: '2.0', method, params })
    }
  }
}
