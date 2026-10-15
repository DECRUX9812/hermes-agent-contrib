import type { PluginOs, PluginRestOptions } from '@hermes/plugin-sdk'

/**
 * The Desk's own backend namespace (`/api/plugins/hermes-office`), reached only
 * through the `ctx.rest` / `ctx.os` doors handed to register(). Components read
 * them from here because a route render has no `ctx` in reach. Every value the
 * UI paints comes from these calls — there is no local fallback state.
 */

export const DESK_KEY = 'hermes-office'

/** The narrow slice of the plugin REST door the Desk uses. */
export interface DeskRest {
  <T>(path: string, opts?: PluginRestOptions): Promise<T>
}

interface Bound {
  rest: DeskRest | null
  os: PluginOs | null
}

const bound: Bound = { rest: null, os: null }

/** Bind the plugin doors at register time; the returned disposer unbinds them
 *  on unload/disable so nothing outlives the plugin. */
export function bindDeskApi(rest: DeskRest, os: PluginOs): () => void {
  bound.rest = rest
  bound.os = os

  return () => {
    bound.rest = null
    bound.os = null
  }
}

export function osDoor(): PluginOs | null {
  return bound.os
}

function rest<T>(path: string, opts?: PluginRestOptions): Promise<T> {
  if (!bound.rest) {
    return Promise.reject(new Error('Desk is not loaded'))
  }

  return bound.rest<T>(path, opts)
}

// The host rejects a failed REST call with `Error("<status>: <body>")`; FastAPI
// bodies carry `{"detail": ...}`, which is the text worth showing inline.
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const body = raw.replace(/^\d{3}:\s*/, '')

  try {
    const parsed: unknown = JSON.parse(body)

    if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
      const detail = (parsed as { detail: unknown }).detail

      if (typeof detail === 'string') {
        return detail
      }

      return JSON.stringify(detail)
    }
  } catch {
    // Not JSON: the message itself is the best text available.
  }

  return body || 'Request failed'
}

export type OfficeKind = 'docx' | 'pptx' | 'xlsx'

export interface DeskFolderCounts {
  files?: number
  needs_you?: number
  workstreams?: number
}

export interface DeskFolder {
  counts?: DeskFolderCounts
  id: string
  name: string
  path: string
}

export type WorkstreamStatus = 'done' | 'error' | 'needs_you' | 'queued' | 'running'

export interface DeskEvent {
  id: number | string
  kind: string
  /** Epoch seconds (backend) or ISO string — timeAgo accepts both. */
  summary?: string
  tool?: string
  ts?: number | string
}

export interface DeskWorkstream {
  created_at: number | string
  files_changed?: number
  folder_id: string
  id: string
  last_event?: DeskEvent
  note?: string
  session_id?: string
  status: WorkstreamStatus
  title: string
  updated_at: number | string
}

export interface DeskSummary {
  folders: DeskFolder[]
  needs_you: DeskWorkstream[]
  recent: DeskWorkstream[]
}

export interface DeskHealth {
  engines?: Record<string, boolean>
  libreoffice?: boolean
  version?: string
}

export type FileState = 'changed' | 'created' | 'working'

export interface DeskFile {
  kind: OfficeKind | string
  path: string
  rel?: string
  state: FileState
}

export interface DeskReceipt {
  backup_path?: string
  created_at: number | string
  id: number | string
  op_summary?: string
  path: string
  reverted_at?: number | string | null
  tool: string
}

export interface WorkstreamDetail {
  events: DeskEvent[]
  files: DeskFile[]
  /** What the agent is doing right now, as the backend sees it. */
  now: { label: string; path?: string; since?: number | string; tool?: string } | null
  receipts: DeskReceipt[]
  workstream: DeskWorkstream
}

export interface ConversationMessage {
  role: string
  text: string
  ts?: number | string
}

export interface Conversation {
  available: boolean
  messages?: ConversationMessage[]
  reason?: string
}

export interface DocxRun {
  author?: string
  rev?: 'del' | 'ins' | string
  text?: string
}

export interface DocxParagraph {
  runs?: DocxRun[]
  style?: string
}

export interface DocxComment {
  anchor?: string
  author?: string
  id?: number | string
  resolved?: boolean
  text?: string
}

export interface XlsxCell {
  formula?: string
  ref?: string
  value?: number | string | null
}

export interface XlsxSheet {
  dims?: string
  name: string
  rows?: XlsxCell[][]
}

export interface PptxShape {
  h?: number
  kind?: string
  name?: string
  text?: string
  w?: number
  x?: number
  y?: number
}

export interface PptxSlide {
  index: number
  shapes?: PptxShape[]
  title?: string
}

export interface Preview {
  docx?: { comments?: DocxComment[]; paragraphs?: DocxParagraph[] }
  kind: OfficeKind | string
  pptx?: { slide_h?: number; slide_w?: number; slides?: PptxSlide[] }
  xlsx?: { sheets?: XlsxSheet[] }
}

export interface DiffSummary {
  kind: OfficeKind | string
  /** docx */
  paragraphs_changed?: { after?: string; before?: string }[]
  revisions?: { author?: string; revision_type?: string; text?: string }[]
  /** xlsx */
  added_sheets?: string[]
  changed?: { address: string; after?: number | string | null; before?: number | string | null }[]
  removed_sheets?: string[]
  shifted?: { from: string; to: string; value?: number | string | null }[]
  /** pptx */
  slide_changes?: { slide_id: number; text_changes?: { after?: { text?: string }[]; before?: { text?: string }[]; kind?: string; shape?: { name?: string } }[] }[]
  slides_added?: number
  slides_moved?: number
  slides_removed?: number
}

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams()

  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(name, String(value))
    }
  }

  return search.toString()
}

export const api = {
  addFolder: (path: string) => rest<void>('/folders', { body: { path }, method: 'POST' }),
  conversation: (id: string) => rest<Conversation>(`/workstreams/${encodeURIComponent(id)}/conversation`),
  createWorkstream: (body: { folder_id: string; request: string; title: string }) =>
    rest<DeskWorkstream>('/workstreams', { body, method: 'POST' }),
  desk: () => rest<DeskSummary>('/desk'),
  diff: (path: string, receiptId?: number | string) =>
    rest<DiffSummary>(`/diff?${query({ path, receipt_id: receiptId })}`),
  health: () => rest<DeskHealth>('/health'),
  patchWorkstream: (id: string, body: Record<string, unknown>) =>
    rest<DeskWorkstream>(`/workstreams/${encodeURIComponent(id)}`, { body, method: 'PATCH' }),
  preview: (path: string, receiptId?: number | string) =>
    rest<Preview>(`/preview?${query({ path, receipt_id: receiptId })}`),
  redline: (body: { action: 'accept' | 'reject'; path: string; workstream_id: string }) =>
    rest<{ resolved: number }>('/redline', { body, method: 'POST' }),
  revert: (receiptId: number | string) =>
    rest<void>(`/receipts/${encodeURIComponent(receiptId)}/revert`, { body: {}, method: 'POST' }),
  workstream: (id: string) => rest<WorkstreamDetail>(`/workstreams/${encodeURIComponent(id)}`)
}

export const keys = {
  all: [DESK_KEY] as const,
  conversation: (id: string) => [DESK_KEY, 'conversation', id] as const,
  desk: [DESK_KEY, 'desk'] as const,
  diff: (path: string, receiptId: number | string | undefined, version: string) =>
    [DESK_KEY, 'diff', path, receiptId ?? 'current', version] as const,
  health: [DESK_KEY, 'health'] as const,
  preview: (path: string, receiptId: number | string | undefined, version: string) =>
    [DESK_KEY, 'preview', path, receiptId ?? 'current', version] as const,
  workstream: (id: string) => [DESK_KEY, 'workstream', id] as const
}

export const ACTIVE_STATUSES = new Set<WorkstreamStatus>(['running', 'queued'])
