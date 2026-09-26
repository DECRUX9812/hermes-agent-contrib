/**
 * The sidebar session row's drop: convert dropped candidates into composer
 * attachment chips and stage them into THAT session's draft — without opening
 * the session, touching focus, or routing through the backend. The row passes
 * the session's durable pin id as the draft scope, the same key the composer
 * swaps under (store/composer.ts → stageSessionDraftAttachments), so the chips
 * merge with whatever the session's composer already holds: into its live set
 * when one is mounted for that scope, into the stash otherwise.
 *
 * Chip shapes mirror what a direct drop onto the session's composer produces
 * (hooks/use-composer-actions.ts): path-only in-app drags (file tree rows,
 * gutter line drags, links) become `@file:`/`@folder:`/`@line:`/`@url:` chips;
 * OS drops keep the bytes-first image path (saveImageBuffer into Desktop's
 * composer-image cache) so a transient source path can't die before submit.
 */

import { formatRefValue } from '@/components/assistant-ui/directive-text'
import { translateNow } from '@/i18n'
import { attachmentId, contextPath, pathLabel } from '@/lib/chat-runtime'
import {
  type ComposerAttachment,
  createComposerAttachmentOccurrenceId,
  stageSessionDraftAttachments
} from '@/store/composer'
import { notify } from '@/store/notifications'

import { blobExtension, type DroppedFile, isImagePath, partitionDroppedFiles } from './hooks/use-composer-actions'

function inAppRefAttachment(candidate: DroppedFile, cwd: string): ComposerAttachment | null {
  if (candidate.url) {
    const refText = `@url:${formatRefValue(candidate.url)}`

    return {
      id: attachmentId('url', refText),
      kind: 'url',
      label: candidate.url,
      path: candidate.url,
      refText
    }
  }

  const path = candidate.path

  if (!path) {
    return null
  }

  const rel = contextPath(path, cwd)
  const label = pathLabel(path)

  if (candidate.isDirectory) {
    return {
      id: attachmentId('folder', rel),
      kind: 'folder',
      label,
      detail: rel,
      refText: `@folder:${formatRefValue(rel)}`,
      path
    }
  }

  if (candidate.line !== undefined) {
    const range = `${candidate.line}${candidate.lineEnd && candidate.lineEnd > candidate.line ? `-${candidate.lineEnd}` : ''}`
    const refText = `@line:${formatRefValue(`${rel}:${range}`)}`

    return {
      id: attachmentId('file', refText),
      kind: 'file',
      label: `${label}:${range}`,
      detail: `${rel}:${range}`,
      refText,
      path
    }
  }

  return {
    id: attachmentId('file', rel),
    kind: 'file',
    label,
    detail: rel,
    refText: `@file:${formatRefValue(rel)}`,
    path
  }
}

function imageAttachment(filePath: string, previewUrl: string): ComposerAttachment {
  return {
    id: attachmentId('image', filePath),
    occurrenceId: createComposerAttachmentOccurrenceId(),
    kind: 'image',
    label: pathLabel(filePath),
    detail: filePath,
    path: filePath,
    previewUrl
  }
}

async function osDropAttachment(candidate: DroppedFile, cwd: string): Promise<ComposerAttachment | null> {
  const file = candidate.file

  if (!file) {
    return null
  }

  let filePath = candidate.path

  if (!filePath && window.hermesDesktop?.getPathForFile) {
    try {
      filePath = window.hermesDesktop.getPathForFile(file) || ''
    } catch {
      filePath = ''
    }
  }

  const isImage = file.type.startsWith('image/') || isImagePath(file.name) || Boolean(filePath && isImagePath(filePath))

  if (isImage) {
    // Durable copy first — a Finder screenshot can live under a TemporaryItems
    // path macOS reaps before submit, so the chip points at the cached bytes
    // whenever Desktop takes them (identical to attachDroppedItems).
    try {
      const savedPath = await window.hermesDesktop?.saveImageBuffer(
        new Uint8Array(await file.arrayBuffer()),
        blobExtension(file),
        file.name
      )

      if (savedPath) {
        return imageAttachment(savedPath, URL.createObjectURL(file))
      }
    } catch {
      // Same fallback as the composer: attach the raw path if there is one.
    }

    return filePath ? imageAttachment(filePath, URL.createObjectURL(file)) : null
  }

  if (!filePath) {
    return null
  }

  const rel = contextPath(filePath, cwd)

  return {
    id: attachmentId('file', rel),
    kind: 'file',
    label: pathLabel(filePath),
    detail: rel,
    refText: `@file:${formatRefValue(rel)}`,
    path: filePath
  }
}

/**
 * Stage `candidates` as attachment chips in the session draft keyed
 * `draftScopeKey` (`sessionPinId` of the dropped-on row; `cwd` is that
 * session's cwd for relativizing). Returns the session's staged total.
 */
export async function stageDroppedFilesForSession(
  draftScopeKey: string,
  candidates: readonly DroppedFile[],
  cwd: string | null | undefined
): Promise<number> {
  const baseCwd = cwd ?? ''
  const { inAppRefs, osDrops } = partitionDroppedFiles([...candidates])
  const attachments: ComposerAttachment[] = []
  let lastFailure: string | null = null

  for (const candidate of inAppRefs) {
    const attachment = inAppRefAttachment(candidate, baseCwd)

    if (attachment) {
      attachments.push(attachment)
    } else {
      lastFailure = `Could not attach ${candidate.path || candidate.url || 'item'}`
    }
  }

  for (const candidate of osDrops) {
    const attachment = await osDropAttachment(candidate, baseCwd)

    if (attachment) {
      attachments.push(attachment)
    } else {
      lastFailure = `Could not attach ${candidate.file?.name || candidate.path || 'file'}`
    }
  }

  if (!attachments.length) {
    if (lastFailure) {
      notify({ kind: 'warning', title: translateNow('composer.dropFiles'), message: lastFailure })
    }

    return 0
  }

  return stageSessionDraftAttachments(draftScopeKey, attachments)
}
