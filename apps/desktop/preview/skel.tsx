/** DEV ONLY — the transcript skeleton over an empty reading column. */
import '@/styles.css'

import { createRoot } from 'react-dom/client'

import { ThreadSkeleton } from '@/components/chat/skeletons'

import { paintTheme } from './theme'

paintTheme()

function App() {
  return (
    <div className="flex h-screen bg-(--ui-editor-surface-background)">
      <div className="relative h-full w-[900px]" data-slot="thread">
        <ThreadSkeleton />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
