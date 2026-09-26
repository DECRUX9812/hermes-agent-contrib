/**
 * Transcript → Markdown (roadmap #8). One renderer walks BOTH content shapes:
 * persisted `SessionMessage` rows (string | text-part arrays + separate
 * `tool_calls` / `tool` rows) and live assistant-ui part arrays (text /
 * reasoning / tool-call parts inline). Tool calls, tool results, reasoning and
 * the system prompt collapse into `<details>` blocks so the export reads like
 * the conversation, not the wire log.
 */

import { messageContentText } from '@/components/assistant-ui/thread/content'
import type { SessionInfo, SessionMessage } from '@/hermes'
import { getAllSessionMessages } from '@/hermes'
import { translateNow } from '@/i18n'
import { downloadTextFile } from '@/lib/download-text'
import { sessionExportFilename } from '@/lib/session-export'
import { notify, notifyError } from '@/store/notifications'

interface MarkdownLabels {
  assistant: string
  reasoning: string
  system: string
  toolCall: string
  toolResult: string
  user: string
}

export function markdownLabels(): MarkdownLabels {
  return {
    assistant: translateNow('desktop.markdownAssistant'),
    reasoning: translateNow('desktop.markdownReasoning'),
    system: translateNow('desktop.markdownSystem'),
    toolCall: translateNow('desktop.markdownToolCall'),
    toolResult: translateNow('desktop.markdownToolResult'),
    user: translateNow('desktop.markdownUser')
  }
}

const details = (summary: string, body: string) =>
  `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`

// ```` lets a body that itself contains ``` survive the fence.
const fence = (body: string, lang = '') => {
  const ticks = body.includes('```') ? '````' : '```'

  return `${ticks}${lang}\n${body}\n${ticks}`
}

const show = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)

interface PersistedToolCall {
  args?: unknown
  arguments?: unknown
  function?: { arguments?: unknown; name?: unknown }
  name?: unknown
}

/** `tool_calls` on a persisted assistant row: OpenAI `function.name/arguments`
 *  and the flat `name`/`args` shape both appear depending on provider. */
function persistedToolCalls(value: unknown): { args: string; name: string }[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap(entry => {
    const call = (entry ?? {}) as PersistedToolCall
    const name = typeof call.name === 'string' ? call.name : typeof call.function?.name === 'string' ? call.function.name : ''
    const args = call.args ?? call.arguments ?? call.function?.arguments

    return name ? [{ args: args === undefined ? '' : show(args), name }] : []
  })
}

/** Walks a content value that is either a string or a parts array mixing text,
 *  reasoning, and tool-call parts (the assistant-ui shape, and the persisted
 *  text-part shape). Returns joined Markdown blocks. */
export function contentToMarkdown(content: unknown, labels: MarkdownLabels): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  const blocks: string[] = []

  for (const part of content) {
    if (typeof part === 'string') {
      if (part.trim()) {
        blocks.push(part)
      }

      continue
    }

    if (!part || typeof part !== 'object') {
      continue
    }

    const row = part as {
      args?: unknown
      name?: string
      reasoning?: string
      result?: unknown
      text?: string
      toolName?: string
      type?: string
    }

    const type = row.type ?? 'text'

    if (type === 'text') {
      if (typeof row.text === 'string' && row.text.trim()) {
        blocks.push(row.text)
      }
    } else if (type === 'reasoning') {
      const body = (row.reasoning ?? row.text ?? '').trim()

      if (body) {
        blocks.push(details(labels.reasoning, body))
      }
    } else if (type === 'tool-call') {
      const name = row.toolName ?? row.name ?? ''

      const body = [
        row.args === undefined || row.args === null ? null : fence(show(row.args), 'json'),
        row.result === undefined || row.result === null ? null : fence(show(row.result))
      ]
        .filter(Boolean)
        .join('\n\n')

      blocks.push(details(name ? `${labels.toolCall}: ${name}` : labels.toolCall, body))
    }
  }

  return blocks.join('\n\n')
}

/** One persisted transcript row → a Markdown block ('' when the row carries
 *  nothing exportable). */
export function messageToMarkdown(message: SessionMessage, labels: MarkdownLabels): string {
  // Rows projected purely for in-app chrome never belong in an export.
  if (message.display_kind === 'hidden') {
    return ''
  }

  const content = message.display_content ?? message.content ?? message.text
  const text = messageContentText(content)

  switch (message.role) {
    case 'user':
      return text ? `## ${labels.user}\n\n${text}` : ''
    case 'assistant': {
      const sections: string[] = []
      const reasoning = (message.display_reasoning ?? message.reasoning_content ?? message.reasoning)?.trim()

      if (reasoning) {
        sections.push(details(labels.reasoning, reasoning))
      }

      const body = contentToMarkdown(content, labels)

      if (body) {
        sections.push(body)
      }

      for (const call of persistedToolCalls(message.tool_calls)) {
        sections.push(details(`${labels.toolCall}: ${call.name}`, call.args ? fence(call.args, 'json') : ''))
      }

      return sections.length ? `## ${labels.assistant}\n\n${sections.join('\n\n')}` : ''
    }

    case 'tool': {
      const name = message.tool_name?.trim()
      const body = text || (message.args !== undefined ? show(message.args) : '') || show(content)

      return details(name ? `${labels.toolResult}: ${name}` : labels.toolResult, fence(body))
    }

    case 'system':
      // The system prompt is scaffolding, not conversation — it folds under a
      // collapsed block the same way tool calls do.
      return text ? details(labels.system, text) : ''

    default:
      return text ? `*${text}*` : ''
  }
}

export interface SessionMarkdownParams {
  labels?: MarkdownLabels
  profile?: null | string
  session?: SessionInfo
  title?: null | string
}

export function sessionToMarkdown(
  sessionId: string,
  messages: SessionMessage[],
  params: SessionMarkdownParams = {}
): string {
  const labels = params.labels ?? markdownLabels()
  const title = params.title ?? params.session?.title ?? sessionId
  const blocks = [`# ${title}`]

  for (const message of messages) {
    const block = messageToMarkdown(message, labels)

    if (block) {
      blocks.push(block)
    }
  }

  return `${blocks.join('\n\n')}\n`
}

/** Fetch the whole persisted transcript and render it as Markdown. */
export async function sessionMarkdownText(sessionId: string, params: SessionMarkdownParams = {}): Promise<string> {
  const profile = params.profile ?? params.session?.profile
  const { messages } = await getAllSessionMessages(sessionId, profile)

  return sessionToMarkdown(sessionId, messages, params)
}

/** Session menu's "Export as Markdown" — same fetch as the JSON export, but
 *  the file is the readable transcript with tool calls collapsed. */
export async function exportSessionMarkdown(
  sessionId: string,
  params: Omit<SessionMarkdownParams, 'labels'> = {}
) {
  if (!sessionId) {
    return
  }

  try {
    const markdown = await sessionMarkdownText(sessionId, params)

    downloadTextFile(sessionExportFilename(sessionId, params.title ?? params.session?.title, 'md'), markdown, 'text/markdown')
    notify({ kind: 'success', message: translateNow('desktop.sessionExported'), durationMs: 2_000 })
  } catch (err) {
    notifyError(err, translateNow('desktop.sessionExportFailed'))
  }
}
