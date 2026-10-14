/** Gateway display hints are not the tool's result. Keep them off the raw
 * payload so summaries cannot overwrite evidence, including false/null/"". */
export interface ToolResultMetadata {
  duration_s?: number
  error?: string | boolean
  inline_diff?: string
  /** The MCP App behind this tool (tools/mcp_apps.py) — the row mounts its UI. */
  mcp_app?: McpAppRef
  message?: string
  preview?: string
  summary?: string
  todos?: unknown
}

/** Which MCP server/tool an app-bearing tool call belongs to and its `ui://` document. */
export interface McpAppRef {
  resourceUri: string
  server: string
  title?: string
  tool: string
}

/** A well-formed app ref from untrusted event/stored JSON, else undefined. */
export function mcpAppRef(value: unknown): McpAppRef | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const { resourceUri, server, title, tool } = value as Record<string, unknown>

  return typeof resourceUri === 'string' &&
    resourceUri.startsWith('ui://') &&
    typeof server === 'string' &&
    server &&
    typeof tool === 'string' &&
    tool
    ? { resourceUri, server, tool, ...(typeof title === 'string' ? { title } : {}) }
    : undefined
}

export interface ToolResultSource {
  result?: unknown
  toolResultMetadata?: ToolResultMetadata
}

/** A derived record for existing presentation code; never stored as the result. */
export function toolResultRecord(source: ToolResultSource): Record<string, unknown> {
  let value = source.result

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      value = undefined
    }
  }

  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {}

  // Authoritative result fields win over fallible/abbreviated display hints.
  return { ...source.toolResultMetadata, ...record }
}

/** The event's own account of a failure, for calls whose result carries none. */
export function envelopeErrorText(metadata: ToolResultMetadata | undefined): string {
  const text = typeof metadata?.error === 'string' ? metadata.error : metadata?.message

  return text?.trim() ?? ''
}
