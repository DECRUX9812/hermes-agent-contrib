import { atom } from 'nanostores'

/** A file opened at a line (Quick Open `app.ts:42`, a `path:line` link). The
 *  source view showing `path` scrolls there, highlights the line and clears
 *  the request; a view for any other file leaves it for its owner. */
export interface PreviewLineRequest {
  line: number
  path: string
}

export const $previewLineRequest = atom<null | PreviewLineRequest>(null)

export function requestPreviewLine(path: string, line: number): void {
  $previewLineRequest.set({ line: Math.max(1, Math.floor(line)), path })
}
