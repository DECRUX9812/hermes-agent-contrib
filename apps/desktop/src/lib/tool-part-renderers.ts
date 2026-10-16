import type { ReactNode } from 'react'

import { registry } from '@/contrib/registry'
import type { Contribution } from '@/contrib/types'

/**
 * PLUGGABLE TOOL-PART RENDERERS — the tool-call seam of the transcript.
 *
 * A plugin registers a renderer for a tool NAME it owns (its own agent tool,
 * e.g. `ambition_card`); wherever that tool's call appears in a transcript,
 * the plugin's node renders in its place instead of the generic tool row.
 * The claim is the guard: an unclaimed tool renders exactly as before.
 *
 * The renderer draws the SETTLED call. A call still running (no result yet)
 * keeps the standard pill, and a failed one keeps the standard expandable
 * failure row — the host owns both, so a broken plugin can never swallow a
 * call it cannot present.
 */

export const TRANSCRIPT_TOOL_PART_AREA = 'transcript.toolParts'

/** The slice of a settled tool call a renderer may draw from. Args are the
 *  model's call arguments; the result is the tool's JSON output (or a JSON
 *  object the backend decoded). Both are untrusted content. */
export interface TranscriptToolPartProps {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  result: unknown
  isError: boolean
}

export interface TranscriptToolPartRenderer {
  /** The tool name this renderer claims (e.g. `ambition_card`). */
  toolName: string
  render: (props: TranscriptToolPartProps) => ReactNode
}

/** The contribution claiming `toolName` within an area snapshot. First
 *  registration wins. */
export function claimedToolPartRendererIn(
  contributions: readonly Contribution[],
  toolName: string
): TranscriptToolPartRenderer | null {
  for (const contribution of contributions) {
    const renderer = contribution.data as TranscriptToolPartRenderer | undefined

    if (renderer?.toolName === toolName && typeof renderer.render === 'function') {
      return renderer
    }
  }

  return null
}

/** The contribution claiming `toolName`, or null. A pure registry read, safe
 *  outside React (render budget, stack grouping); React trees read the area
 *  with `useContributions` + a claim resolver so a hot-loaded plugin
 *  upgrades already-rendered parts in place. */
export function claimedToolPartRenderer(toolName: string): TranscriptToolPartRenderer | null {
  return claimedToolPartRendererIn(registry.getArea(TRANSCRIPT_TOOL_PART_AREA), toolName)
}

/** The inner call of a bridged `tool_call` part (the tool_search deferral),
 *  or null for anything else. Live, the part wears the wrapper name and
 *  args; the stored result carries the real tool's name (`storedResultToolName`)
 *  and the single inner call's arguments ride `args.calls`. Only a
 *  single-call bridge resolves — a batch is the bridge's own surface. */
export function bridgedInnerCall(part: {
  args?: unknown
  storedResultToolName?: string
  toolName: string
}): null | { args: Record<string, unknown>; name: string } {
  if (part.toolName !== 'tool_call') {
    return null
  }

  const source = isRecordObject(part.args) ? part.args : {}
  const rawCalls = Array.isArray(source.calls) ? source.calls : [source]

  if (rawCalls.length !== 1) {
    return null
  }

  const call = isRecordObject(rawCalls[0]) ? rawCalls[0] : {}
  const name = typeof call.name === 'string' && call.name !== '' ? call.name : (part.storedResultToolName ?? '')

  if (!name) {
    return null
  }

  return { args: isRecordObject(call.arguments) ? call.arguments : {}, name }
}

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The tool a transcript part is really for: a `tool_call` bridge part is its
 *  inner tool's call (when the bridge carries exactly one), everything else
 *  is itself. */
export function effectiveToolName(part: { args?: unknown; storedResultToolName?: string; toolName: string }): string {
  return part.toolName === 'tool_call' ? (bridgedInnerCall(part)?.name ?? part.toolName) : part.toolName
}

/** The claim for a transcript tool part, resolved through the bridge, together
 *  with the part props that name the plugin's own tool. Null when no renderer
 *  claims it. The React tree passes its `useContributions` snapshot (a hot
 *  plugin load re-renders claimants in place); pure callers use
 *  `claimedToolPart`, which reads the registry directly. */
export function claimedToolPartIn(
  contributions: readonly Contribution[],
  part: TranscriptToolPartProps & { storedResultToolName?: string }
): null | { props: TranscriptToolPartProps; renderer: TranscriptToolPartRenderer } {
  const bridge = bridgedInnerCall(part)

  if (!bridge && part.toolName !== 'tool_call') {
    const renderer = claimedToolPartRendererIn(contributions, part.toolName)

    return renderer ? { props: { ...part }, renderer } : null
  }

  const renderer = claimedToolPartRendererIn(contributions, bridge?.name ?? '')

  if (!bridge || !renderer) {
    return null
  }

  return { props: { ...part, args: bridge.args, toolName: bridge.name }, renderer }
}

/** `claimedToolPartIn` against the live registry. */
export function claimedToolPart(
  part: TranscriptToolPartProps & { storedResultToolName?: string }
): null | { props: TranscriptToolPartProps; renderer: TranscriptToolPartRenderer } {
  return claimedToolPartIn(registry.getArea(TRANSCRIPT_TOOL_PART_AREA), part)
}
