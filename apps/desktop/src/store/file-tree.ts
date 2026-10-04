import { atom } from 'nanostores'

import { createDesktopDir, readDesktopDir, writeDesktopFileText } from '@/lib/desktop-fs'
import { planNewEntry } from '@/lib/new-file-entry'

import { notifyWorkspaceChanged } from './workspace-events'

/** The row selected in the file tree — where "New file / folder" lands. */
export const $treeSelection = atom<null | { isDirectory: boolean; path: string }>(null)

const parentOf = (path: string) => path.replace(/[\\/][^\\/]+$/, '')
const leafOf = (path: string) => path.split(/[\\/]/).pop() ?? path

/** The folder new entries go into: the selected folder, a selected file's
 *  folder, else the project root. */
export function newEntryBase(root: string): string {
  const selected = $treeSelection.get()

  if (!selected || !selected.path.startsWith(root)) {
    return root
  }

  return selected.isDirectory ? selected.path : parentOf(selected.path)
}

async function ensureFolder(path: string): Promise<void> {
  try {
    await createDesktopDir(path)
  } catch (error) {
    // An intermediate folder that already exists is the common case.
    if (!/already exists/i.test(error instanceof Error ? error.message : String(error))) {
      throw error
    }
  }
}

/**
 * Create what the user typed under `base` (slashes make folders). Never
 * overwrites: an existing file or folder of that name is an error. Returns
 * the created path.
 */
export async function createTreeEntry(base: string, typed: string, kind: 'file' | 'folder'): Promise<string> {
  const plan = planNewEntry(base, typed)

  if (!plan) {
    throw new Error('Use a name inside this folder, like notes.md or src/app.ts')
  }

  for (const folder of plan.folders) {
    await ensureFolder(folder)
  }

  if (kind === 'folder') {
    await createDesktopDir(plan.target)
  } else {
    const listing = await readDesktopDir(parentOf(plan.target))

    if (listing.entries.some(entry => entry.name === leafOf(plan.target))) {
      throw new Error(`"${leafOf(plan.target)}" already exists`)
    }

    await writeDesktopFileText(plan.target, '')
  }

  notifyWorkspaceChanged(plan.target)

  return plan.target
}
