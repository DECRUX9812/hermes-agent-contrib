import { useStore } from '@nanostores/react'
import { Fragment } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { editorLabel } from '@/lib/editor-handoff'
import { $preferredEditor, canOpenInEditor, openInEditor } from '@/store/editor-handoff'
import { revealFileInTree } from '@/store/layout'
import { $currentCwd } from '@/store/session'

/** Segments shown before collapsing the head into "…" (the file always shows). */
const MAX_SEGMENTS = 4

/**
 * Where the previewed file lives, relative to the project: `src › utils ›
 * date.ts`. A folder segment reveals that folder in the file tree; the file
 * segment reveals the file. Files outside the project show their full path.
 */
export function PreviewBreadcrumbs({ filePath }: { filePath: string }) {
  const root = useStore($currentCwd).trim().replace(/[\\/]+$/, '')
  const normalized = filePath.replace(/\\/g, '/')
  const inside = Boolean(root) && normalized.startsWith(`${root}/`)
  const rel = inside ? normalized.slice(root.length + 1) : normalized.replace(/^\/+/, '')
  const parts = rel.split('/').filter(Boolean)

  if (parts.length === 0) {
    return null
  }

  const base = inside ? root : normalized.startsWith('/') ? '' : ''
  const absAt = (index: number) => `${base}/${parts.slice(0, index + 1).join('/')}`.replace(/^\/\//, '/')
  const first = Math.max(0, parts.length - MAX_SEGMENTS)

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[0.6875rem] text-(--ui-text-tertiary)"
      data-slot="preview-breadcrumbs"
    >
      {first > 0 && <span className="shrink-0">…</span>}
      {parts.slice(first).map((part, offset) => {
        const index = first + offset
        const last = index === parts.length - 1

        return (
          <Fragment key={absAt(index)}>
            {(offset > 0 || first > 0) && <Codicon className="shrink-0 opacity-60" name="chevron-right" size="0.625rem" />}
            <button
              className={
                last
                  ? 'min-w-0 truncate font-medium text-foreground hover:underline'
                  : 'max-w-[8rem] shrink truncate hover:text-foreground hover:underline'
              }
              onClick={() => inside && revealFileInTree(absAt(index))}
              title={absAt(index)}
              type="button"
            >
              {part}
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}

/** The preview header's hand-off to the user's own editor. */
export function OpenInEditorButton({ filePath }: { filePath: string }) {
  const { t } = useI18n()
  const editor = useStore($preferredEditor)

  if (!canOpenInEditor()) {
    return null
  }

  const label = t.fileMenu.openInEditor(editorLabel(editor))

  return (
    <Tip label={label}>
      <button
        aria-label={label}
        className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
        data-slot="preview-open-in-editor"
        onClick={() => void openInEditor(filePath)}
        type="button"
      >
        <Codicon name="go-to-file" size="0.75rem" />
      </button>
    </Tip>
  )
}
