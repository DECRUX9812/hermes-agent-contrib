import { lazy, Suspense } from 'react'

import { cn } from '@/lib/utils'

import type { CodeEditorProps } from './code-editor-impl'

export type { CodeEditorApi, CodeEditorProps } from './code-editor-impl'

// CodeMirror and its language table are ~300 KB of JS. The editor is reached
// from always-mounted chrome (profile switcher, preview pane), so a static
// import put all of it on the boot path for a surface most launches never open.
const LazyCodeEditor = lazy(() => import('./code-editor-impl').then(m => ({ default: m.CodeEditor })))

export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<div className={cn('h-full min-h-0', props.className)} />}>
      <LazyCodeEditor {...props} />
    </Suspense>
  )
}
