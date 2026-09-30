/**
 * Inline MCP App: a tool whose MCP server ships a `ui://` app renders that
 * app under its row (tools/mcp_apps.py → `mcp_apps.*` RPC). The document runs
 * in `sandbox="allow-scripts"` (opaque origin, parent unreachable) under a
 * default-deny CSP; `lib/mcp-apps/bridge.ts` is its only door to the host.
 */

import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { createMcpAppBridge, type JsonRpcMessage } from '@/lib/mcp-apps/bridge'
import { composeMcpAppDocument, type McpAppCsp } from '@/lib/mcp-apps/document'
import type { McpAppRef } from '@/lib/tool-result-metadata'
import { composerHost } from '@/sdk/composer'
import { $gateway } from '@/store/gateway'
import { notify } from '@/store/notifications'
import { requestForSessionProfile } from '@/store/session-request-router'
import { knownOwnerForSession } from '@/store/session-states-routing'

const MIN_HEIGHT = 80
const MAX_HEIGHT = 720

interface McpAppDocument {
  html: string
  meta?: { ui?: { csp?: McpAppCsp; prefersBorder?: boolean } }
}

/** A `mcp_apps.*` call on the gateway that owns this chat. */
function requestMcpApps<T>(sessionId: null | string, method: string, params: Record<string, unknown>): Promise<T> {
  const ambient = <R,>(m: string, p?: Record<string, unknown>) => {
    const gateway = $gateway.get()

    if (!gateway) {
      return Promise.reject(new Error('Hermes gateway unavailable'))
    }

    return gateway.request<R>(m, p ?? {})
  }

  return requestForSessionProfile<T>(knownOwnerForSession(sessionId), ambient, method, {
    ...params,
    ...(sessionId ? { session_id: sessionId } : {})
  })
}

const isDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

export function McpAppFrame({ app, args, result }: { app: McpAppRef; args: unknown; result: unknown }) {
  const sessionId = useStore(useSessionView().$runtimeId)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(MIN_HEIGHT * 3)

  const doc = useQuery({
    queryFn: () => requestMcpApps<McpAppDocument>(sessionId, 'mcp_apps.read_ui', { server: app.server, uri: app.resourceUri }),
    queryKey: ['mcp-app-ui', sessionId, app.server, app.resourceUri],
    retry: false,
    staleTime: 60_000
  })

  const srcDoc = useMemo(() => (doc.data ? composeMcpAppDocument(doc.data.html, doc.data.meta?.ui?.csp) : ''), [doc.data])

  useEffect(() => {
    const frame = frameRef.current

    if (!srcDoc || !frame) {
      return
    }

    // Opaque-origin frame: the target origin can only be '*'; the source check
    // below is what pins every inbound message to THIS iframe.
    const post = (message: JsonRpcMessage) => frame.contentWindow?.postMessage(message, '*')

    const bridge = createMcpAppBridge(
      {
        callTool: (name, toolArgs) =>
          requestMcpApps(sessionId, 'mcp_apps.call', { arguments: toolArgs, server: app.server, tool: name }),
        draftMessage: text => {
          void composerHost.insertText(sessionId, text)
        },
        hostContext: () => ({
          availableDisplayModes: ['inline'],
          displayMode: 'inline',
          locale: navigator.language,
          platform: 'desktop',
          theme: isDark() ? 'dark' : 'light'
        }),
        offerLink: url =>
          notify({
            action: { label: 'Open', onClick: () => void window.hermesDesktop?.openExternal?.(url) },
            kind: 'info',
            message: `${app.title || app.tool} wants to open ${url}`
          }),
        onInitialized: () => {
          bridge.notify('ui/notifications/tool-input', { arguments: args && typeof args === 'object' ? args : {} })
          bridge.notify('ui/notifications/tool-result', toolResultForApp(result))
        },
        onSize: next => setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(next))))
      },
      post
    )

    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.contentWindow) {
        void bridge.receive(event.data)
      }
    }

    window.addEventListener('message', onMessage)

    return () => window.removeEventListener('message', onMessage)
  }, [app.server, app.title, app.tool, args, result, sessionId, srcDoc])

  if (doc.isError) {
    return (
      <p className="px-2 py-1 text-xs text-(--ui-text-tertiary)" data-testid="mcp-app-error">
        {app.title || app.tool}: {doc.error instanceof Error ? doc.error.message : 'app unavailable'}
      </p>
    )
  }

  if (!srcDoc) {
    return null
  }

  return (
    <iframe
      className="block w-full rounded-[0.25rem] border border-(--ui-stroke-tertiary) bg-transparent"
      data-testid="mcp-app-frame"
      ref={frameRef}
      sandbox="allow-scripts allow-forms"
      srcDoc={srcDoc}
      style={{ colorScheme: isDark() ? 'dark' : 'light', height }}
      title={app.title || app.tool}
    />
  )
}

/** The completed call as the app expects it: the tool's own JSON result
 *  (`content` / `structuredContent`) when the handler forwarded it, else text. */
export function toolResultForApp(result: unknown): Record<string, unknown> {
  let value = result

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { content: [{ text: value, type: 'text' }] }
    }
  }

  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const text = typeof record.result === 'string' ? record.result : ''
  const structured = record.structuredContent ?? (text ? undefined : record.result)

  return {
    content: text ? [{ text, type: 'text' }] : [],
    ...(structured && typeof structured === 'object' ? { structuredContent: structured } : {})
  }
}
