import { useState } from 'react'

import { useFileSearch } from '@/app/quick-open/use-file-search'
import { Codicon } from '@/components/ui/codicon'
import { FileTypeIcon } from '@/components/ui/file-type-icon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { quickOpenPath } from '@/lib/quick-open'
import { createTreeEntry } from '@/store/file-tree'
import { revealFileInTree } from '@/store/layout'
import { notifyError } from '@/store/notifications'

export type TreeToolMode = 'filter' | 'new-file' | 'new-folder'

const FIELD =
  'h-6 w-full min-w-0 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-2 text-xs text-foreground outline-none placeholder:text-(--ui-text-quaternary) focus:border-(--ui-accent)'

/** The inline field under the tree header for "New file" / "New folder".
 *  Slashes make folders (`src/utils/date.ts`); Enter creates, Esc cancels. */
export function NewEntryField({
  base,
  baseLabel,
  kind,
  onCreated,
  onDone
}: {
  base: string
  baseLabel: string
  kind: 'file' | 'folder'
  onCreated: (path: string, kind: 'file' | 'folder') => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const r = t.rightSidebar
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!value.trim() || busy) {
      return
    }

    setBusy(true)

    try {
      const created = await createTreeEntry(base, value, kind)

      onDone()
      onCreated(created, kind)
    } catch (error) {
      notifyError(error, kind === 'file' ? r.newFileFailed : r.newFolderFailed)
      setBusy(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-1 px-2.5 pb-2" data-slot="tree-new-entry">
      <span className="truncate text-[0.625rem] text-(--ui-text-tertiary)">
        {kind === 'file' ? r.newFileIn(baseLabel) : r.newFolderIn(baseLabel)}
      </span>
      <input
        aria-label={kind === 'file' ? r.newFile : r.newFolder}
        autoFocus
        className={FIELD}
        disabled={busy}
        onBlur={() => !value.trim() && onDone()}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void submit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onDone()
          }
        }}
        placeholder={kind === 'file' ? r.newFilePlaceholder : r.newFolderPlaceholder}
        spellCheck={false}
        value={value}
      />
    </div>
  )
}

/** The tree's filter: a fuzzy search over the WHOLE project (the backend's
 *  path search, so folders the tree hasn't loaded still match), listed with
 *  each hit's folder. Enter opens the first hit; picking one also reveals it
 *  in the tree when the filter closes. */
export function TreeFilter({
  cwd,
  onClose,
  onOpenFile
}: {
  cwd: string
  onClose: () => void
  onOpenFile: (path: string) => void
}) {
  const { t } = useI18n()
  const r = t.rightSidebar
  const [query, setQuery] = useState('')
  const { items, loading } = useFileSearch(query.trim(), cwd)

  const open = (rel: string, isDir: boolean) => {
    const path = quickOpenPath(cwd, rel)

    onClose()

    if (isDir) {
      revealFileInTree(path)
    } else {
      onOpenFile(path)
      revealFileInTree(path)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-slot="tree-filter">
      <div className="shrink-0 px-2.5 pb-2">
        <input
          aria-label={r.filterFiles}
          autoFocus
          className={FIELD}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            } else if (event.key === 'Enter' && items[0]) {
              event.preventDefault()
              open(items[0].rel, items[0].isDir)
            }
          }}
          placeholder={r.filterPlaceholder}
          spellCheck={false}
          value={query}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2" role="list">
        {!query.trim() ? (
          <p className="px-4 py-3 text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)">{r.filterHint}</p>
        ) : !loading && items.length === 0 ? (
          <p className="px-4 py-3 text-[0.6875rem] text-(--ui-text-tertiary)">{r.filterNoMatch}</p>
        ) : (
          items.map(item => {
            return (
              <Tip key={item.rel} label={item.rel}>
                <button
                  className="flex h-[1.375rem] w-full min-w-0 items-center gap-1.5 px-4 text-left text-xs text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
                  data-slot="tree-filter-row"
                  onClick={() => open(item.rel, item.isDir)}
                  role="listitem"
                  type="button"
                >
                  {item.isDir ? (
                    <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="folder" size="0.875rem" />
                  ) : (
                    <FileTypeIcon className="shrink-0" path={item.name} size="0.875rem" />
                  )}
                  <span className="shrink-0 text-foreground">{item.name}</span>
                  <span className="min-w-0 truncate text-(--ui-text-quaternary)">{item.dir}</span>
                </button>
              </Tip>
            )
          })
        )}
      </div>
    </div>
  )
}
