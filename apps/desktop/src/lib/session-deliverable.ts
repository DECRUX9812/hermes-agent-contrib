/**
 * Session deliverable export (roadmap #35): one shareable Markdown report per
 * session — outcome summary, diff stat, produced artifacts, PR link — written
 * through the same `downloadTextFile` plumbing as the transcript/JSON exports.
 * Everything degrades: an unreachable backend, a non-repo session, or no PR
 * each drop their section rather than failing the export.
 */

import { collectArtifactsForSession, type ArtifactRecord as TranscriptArtifact } from '@/app/artifacts/artifact-utils'
import { messageContentText } from '@/components/assistant-ui/thread/content'
import type { HermesReviewFile } from '@/global'
import type { SessionInfo, SessionMessage } from '@/hermes'
import { getAllSessionMessages } from '@/hermes'
import { translateNow } from '@/i18n'
import { desktopGit } from '@/lib/desktop-git'
import { downloadTextFile } from '@/lib/download-text'
import { sessionExportFilename } from '@/lib/session-export'
import { $artifactRegistry, type ArtifactRecord } from '@/store/artifacts'
import { notify, notifyError } from '@/store/notifications'
import { $pullRequestsByBranch, sessionPrKey } from '@/store/pull-requests'
import { sessionTouchedPaths } from '@/store/review-session'
import { $sessions, lineageAliases, sessionMatchesStoredId } from '@/store/session'

const SUMMARY_CHAR_LIMIT = 2000

export interface DeliverableParams {
  profile?: null | string
  session?: SessionInfo
  title?: null | string
}

interface DeliverableFileRow {
  added: null | number
  path: string
  removed: null | number
}

function lastAssistantText(messages: readonly SessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]

    if (!message || message.role !== 'assistant' || message.display_kind === 'hidden') {
      continue
    }

    const text = messageContentText(message.display_content ?? message.content ?? message.text).trim()

    if (text) {
      return text.length > SUMMARY_CHAR_LIMIT ? `${text.slice(0, SUMMARY_CHAR_LIMIT).trimEnd()}…` : text
    }
  }

  return ''
}

function registryArtifactsForSession(sessionId: string, sessions: readonly SessionInfo[]): ArtifactRecord[] {
  const registry = $artifactRegistry.get()
  const out: ArtifactRecord[] = []

  for (const id of lineageAliases(sessionId, sessions)) {
    out.push(...(registry[id] ?? []))
  }

  return out
}

/** Net line stats for the session's own touched paths, looked up in the
 *  branch-scope review list (the "everything vs merge-base" view — the same
 *  shape the review pane's session scope diffs against). Files whose churn is
 *  already committed show as touched rows with no +/-. */
async function deliverableFileRows(session: SessionInfo, sessionId: string): Promise<DeliverableFileRow[]> {
  const cwd = session.cwd?.trim() || session.git_repo_root?.trim() || ''

  if (!cwd) {
    return []
  }

  const touched = await sessionTouchedPaths(cwd, sessionId)

  let files: HermesReviewFile[] = []

  try {
    files = (await desktopGit()?.review.list(session.git_repo_root || cwd, 'branch', null))?.files ?? []
  } catch {
    files = []
  }

  const statByPath = new Map(files.map(file => [file.path, file]))

  const rows: DeliverableFileRow[] = touched.map(path => ({
    added: statByPath.get(path)?.added ?? null,
    path,
    removed: statByPath.get(path)?.removed ?? null
  }))

  // The transcript may be unavailable while the working tree still carries the
  // session's edits — report what git sees rather than an empty section.
  if (rows.length === 0) {
    for (const file of files) {
      rows.push({ added: file.added, path: file.path, removed: file.removed })
    }
  }

  return rows
}

export function deliverableMarkdown(input: {
  artifacts: ArtifactRecord[]
  files: DeliverableFileRow[]
  pr: { number: number; state: string; title: string; url: string } | null
  sessionId: string
  summary: string
  title: string
  transcriptArtifacts: TranscriptArtifact[]
}): string {
  const blocks = [`# ${input.title}`, '', `- ${translateNow('desktop.deliverableSession')}: \`${input.sessionId}\``]

  blocks.push(
    '',
    `## ${translateNow('desktop.deliverableSummary')}`,
    '',
    input.summary || `*${translateNow('desktop.deliverableNoSummary')}*`
  )

  if (input.files.length > 0) {
    const added = input.files.reduce((sum, row) => sum + (row.added ?? 0), 0)
    const removed = input.files.reduce((sum, row) => sum + (row.removed ?? 0), 0)

    blocks.push(
      '',
      `## ${translateNow('desktop.deliverableChanges')}`,
      '',
      translateNow('desktop.deliverableFilesLine', input.files.length, added, removed),
      ''
    )

    for (const row of input.files) {
      const stat = row.added === null ? '' : ` (+${row.added} −${row.removed ?? 0})`

      blocks.push(`- \`${row.path}\`${stat}`)
    }
  }

  const artifactLines: string[] = []

  for (const artifact of input.artifacts) {
    artifactLines.push(`- \`${artifact.kind}\` — ${artifact.title || artifact.slug}`)
  }

  for (const artifact of input.transcriptArtifacts) {
    const ref = artifact.href || artifact.value
    const label = artifact.label || artifact.value

    artifactLines.push(ref ? `- \`${artifact.kind}\` — ${label} (\`${ref}\`)` : `- \`${artifact.kind}\` — ${label}`)
  }

  if (artifactLines.length > 0) {
    blocks.push('', `## ${translateNow('desktop.deliverableArtifacts')}`, '', ...artifactLines)
  }

  if (input.pr) {
    blocks.push(
      '',
      `## ${translateNow('desktop.deliverablePullRequest')}`,
      '',
      `- [#${input.pr.number} ${input.pr.title}](${input.pr.url}) — ${input.pr.state}`
    )
  }

  return `${blocks.join('\n')}\n`
}

export async function exportSessionDeliverable(sessionId: string, params: DeliverableParams = {}): Promise<void> {
  if (!sessionId) {
    return
  }

  try {
    const sessions = $sessions.get()
    const session = params.session ?? sessions.find(row => sessionMatchesStoredId(row, sessionId))
    const title = params.title ?? session?.title ?? sessionId

    const { messages } = await getAllSessionMessages(sessionId, {
      connectionId: session?.connection_id,
      profile: params.profile ?? session?.profile
    })

    const pr = session ? $pullRequestsByBranch.get()[sessionPrKey(session) ?? ''] : undefined

    const markdown = deliverableMarkdown({
      artifacts: registryArtifactsForSession(sessionId, sessions),
      files: session ? await deliverableFileRows(session, sessionId) : [],
      pr: pr ? { number: pr.number, state: pr.state, title: pr.title, url: pr.url } : null,
      sessionId,
      summary: lastAssistantText(messages),
      title,
      transcriptArtifacts: session ? collectArtifactsForSession(session, messages) : []
    })

    downloadTextFile(sessionExportFilename(sessionId, title, 'deliverable.md'), markdown, 'text/markdown')
    notify({ durationMs: 2_000, kind: 'success', message: translateNow('desktop.sessionExported') })
  } catch (err) {
    notifyError(err, translateNow('desktop.sessionExportFailed'))
  }
}
