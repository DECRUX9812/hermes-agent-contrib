import { requestComposerInsertRefs } from '@/app/chat/composer/focus'
import { droppedFileInlineRef } from '@/app/chat/composer/inline-refs'
import { emptyCanvasFile, nextCanvasName } from '@/lib/canvas-file'
import { readDesktopDir, writeDesktopFileText } from '@/lib/desktop-fs'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'

import { notifyError } from './notifications'
import { openPreview } from './preview'
import { $currentCwd } from './session'
import { notifyWorkspaceChanged } from './workspace-events'

/**
 * Start a canvas you and the agent share: a new `.excalidraw` file at the
 * project root, opened beside the chat, and attached to your next message so
 * the agent knows which drawing "this" is. The agent draws by editing the
 * same file with its file tools; the canvas picks its changes up live.
 */
export async function createCanvas(): Promise<null | string> {
  const cwd = $currentCwd.get().trim()

  if (!cwd) {
    return null
  }

  try {
    const listing = await readDesktopDir(cwd)
    const name = nextCanvasName(listing.entries.map(entry => entry.name))
    const path = `${cwd.replace(/[\\/]+$/, '')}/${name}`

    await writeDesktopFileText(path, emptyCanvasFile())
    notifyWorkspaceChanged(path)

    const target = await normalizeOrLocalPreviewTarget(path, cwd)

    if (target) {
      openPreview(target)
    }

    const ref = droppedFileInlineRef({ path }, cwd)

    if (ref) {
      requestComposerInsertRefs([ref])
    }

    return path
  } catch (error) {
    notifyError(error, 'Could not create the canvas')

    return null
  }
}
