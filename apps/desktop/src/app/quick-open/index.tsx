import { useStore } from '@nanostores/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useMemo, useRef, useState } from 'react'

import { requestComposerFocus, requestComposerInsertRefs } from '@/app/chat/composer/focus'
import { droppedFileInlineRef } from '@/app/chat/composer/inline-refs'
import { HUD_ITEM, HUD_POSITION, HUD_SURFACE, HUD_TEXT } from '@/app/floating-hud'
import { Codicon } from '@/components/ui/codicon'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useI18n } from '@/i18n'
import { pathLeaf } from '@/lib/display-path'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { parseQuickOpenQuery, quickOpenPath } from '@/lib/quick-open'
import { cn } from '@/lib/utils'
import { revealFileInTree } from '@/store/layout'
import { $previewTabs, openPreview } from '@/store/preview'
import { requestPreviewLine } from '@/store/preview-line'
import { openFolderAsProject } from '@/store/projects'
import { $quickOpenOpen, setQuickOpenOpen } from '@/store/quick-open'
import { $currentCwd } from '@/store/session'

import { useFileSearch } from './use-file-search'

async function openFile(path: string, cwd: string, line: null | number) {
  const target = await normalizeOrLocalPreviewTarget(path, cwd)

  if (!target) {
    return
  }

  openPreview(target)

  if (line) {
    requestPreviewLine(path, line)
  }
}

function QuickOpenBody() {
  const { t } = useI18n()
  const q = t.quickOpen
  const cwd = useStore($currentCwd).trim()
  const tabs = useStore($previewTabs)
  const [raw, setRaw] = useState('')
  const { line, query } = parseQuickOpenQuery(raw)
  const { items, loading } = useFileSearch(query, cwd)
  const inputRef = useRef<HTMLInputElement>(null)

  // Empty query: the files already open beside the chat, newest first.
  const recent = useMemo(
    () =>
      tabs
        .filter(tab => tab.target.kind === 'file' && tab.target.path)
        .slice(-8)
        .reverse()
        .map(tab => tab.target.path!),
    [tabs]
  )

  const choose = (path: string, isDir: boolean, attach: boolean) => {
    setQuickOpenOpen(false)

    if (attach) {
      const ref = droppedFileInlineRef({ isDirectory: isDir, path }, cwd)

      if (ref) {
        requestComposerInsertRefs([ref])
        requestComposerFocus('active')
      }

      return
    }

    if (isDir) {
      revealFileInTree(path)

      return
    }

    void openFile(path, cwd, line)
  }

  // ⌘/Ctrl+Enter attaches the highlighted row to the message instead of opening it.
  const attachRef = useRef(false)

  return (
    <Command
      className="bg-transparent"
      loop
      onKeyDownCapture={event => {
        attachRef.current = event.key === 'Enter' && (event.metaKey || event.ctrlKey)
      }}
      shouldFilter={false}
    >
      <CommandInput
        onValueChange={setRaw}
        placeholder={cwd ? q.placeholder(pathLeaf(cwd) || cwd) : q.noProject}
        ref={inputRef}
        value={raw}
      />
      <CommandList className="max-h-[min(24rem,60vh)]">
        {!cwd ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            <p className={cn(HUD_TEXT, 'text-(--ui-text-tertiary)')}>{q.noProjectBody}</p>
            <button
              className="rounded-lg bg-(--ui-accent) px-3 py-1 text-xs font-medium text-white"
              onClick={() => {
                setQuickOpenOpen(false)
                void openFolderAsProject()
              }}
              type="button"
            >
              {q.openFolder}
            </button>
          </div>
        ) : query ? (
          <>
            {!loading && <CommandEmpty className={cn(HUD_TEXT, 'py-6')}>{q.noMatch(query)}</CommandEmpty>}
            <CommandGroup>
              {items.map(item => (
                <CommandItem
                  className={cn(HUD_ITEM, HUD_TEXT)}
                  data-quick-open-row=""
                  key={item.rel}
                  onSelect={() => choose(quickOpenPath(cwd, item.rel), item.isDir, attachRef.current)}
                  value={item.rel}
                >
                  <Codicon
                    className="shrink-0 text-(--ui-text-tertiary)"
                    name={item.isDir ? 'folder' : 'file'}
                    size="0.875rem"
                  />
                  <span className="shrink-0 font-medium text-foreground">{item.name}</span>
                  <span className="min-w-0 truncate text-(--ui-text-quaternary)">{item.dir}</span>
                  {line && !item.isDir && (
                    <span className="ml-auto shrink-0 tabular-nums text-(--ui-text-tertiary)">{q.line(line)}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : recent.length > 0 ? (
          <CommandGroup heading={q.recent}>
            {recent.map(path => (
              <CommandItem
                className={cn(HUD_ITEM, HUD_TEXT)}
                key={path}
                onSelect={() => choose(path, false, attachRef.current)}
                value={path}
              >
                <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="file" size="0.875rem" />
                <span className="shrink-0 font-medium text-foreground">{pathLeaf(path)}</span>
                <span className="min-w-0 truncate text-(--ui-text-quaternary)">{path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : (
          <p className={cn(HUD_TEXT, 'px-4 py-6 text-center text-(--ui-text-tertiary)')}>{q.hint}</p>
        )}
      </CommandList>
      {cwd && (
        <div className="flex items-center gap-3 border-t border-(--ui-stroke-tertiary) px-3 py-1.5 text-[0.6875rem] text-(--ui-text-tertiary)">
          <span>
            <kbd className="font-sans">↵</kbd> {q.openHint}
          </span>
          <span>
            <kbd className="font-sans">⌘↵</kbd> {q.attachHint}
          </span>
          <span className="ml-auto">{q.lineHint}</span>
        </div>
      )}
    </Command>
  )
}

/**
 * ⌘P Quick Open: jump to any file in the project by name, VS Code / Zed style.
 * `name:42` lands on a line; ⌘↵ drops the file into the message instead.
 */
export function QuickOpen() {
  const { t } = useI18n()
  const open = useStore($quickOpenOpen)

  return (
    <DialogPrimitive.Root onOpenChange={setQuickOpenOpen} open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-(--z-over-modal)" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            HUD_POSITION,
            HUD_SURFACE,
            'z-(--z-over-modal-content) w-[min(36rem,calc(100vw-2rem))] overflow-hidden duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=open]:zoom-in-95'
          )}
          data-slot="quick-open"
        >
          <DialogPrimitive.Title className="sr-only">{t.quickOpen.title}</DialogPrimitive.Title>
          {open && <QuickOpenBody />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
