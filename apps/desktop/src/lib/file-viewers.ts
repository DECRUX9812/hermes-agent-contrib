import type { ReactNode } from 'react'

/**
 * FILE VIEWERS — extra ways to read a file in the preview, as a contribution
 * area. The preview already owns source, rendered markdown and diff; a viewer
 * adds one more mode to the same switcher for the files it `matches` (a table
 * for CSV, a plugin's own format). Viewers render the file's TEXT the preview
 * already loaded — they never re-read, and editing stays the preview's.
 */

export const FILE_VIEWERS_AREA = 'preview.viewers'

export interface FileViewerProps {
  filePath: string
  text: string
}

/** Payload of a `preview.viewers` contribution's `data`. */
export interface FileViewerContribution {
  /** Switcher label ("Table"). A function reads the live locale. */
  label: (() => string) | string
  /** Whether this viewer can show `filePath` (usually by extension). */
  matches: (filePath: string) => boolean
  /** Preferred over plain source when the file has no diff to show. */
  preferred?: boolean
  render: (props: FileViewerProps) => ReactNode
}

export interface ResolvedFileViewer extends FileViewerContribution {
  id: string
}

/** The viewers that apply to `filePath`, in registration order. */
export function viewersFor(
  contributions: readonly { data?: unknown; id: string }[],
  filePath: string
): ResolvedFileViewer[] {
  return contributions.flatMap(contribution => {
    const viewer = contribution.data as FileViewerContribution | undefined

    return viewer && typeof viewer.matches === 'function' && viewer.matches(filePath)
      ? [{ ...viewer, id: contribution.id }]
      : []
  })
}

export const viewerLabel = (viewer: Pick<FileViewerContribution, 'label'>) =>
  typeof viewer.label === 'function' ? viewer.label() : viewer.label
