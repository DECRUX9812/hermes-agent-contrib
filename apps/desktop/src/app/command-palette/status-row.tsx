import type React from 'react'

import { cn } from '@/lib/utils'

/** Centered loading / empty / error row for a Cmd-K page's result list. */
export function StatusRow({ icon, text, tone }: { icon?: React.ReactNode; text: string; tone?: 'error' }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 px-2 py-6 text-ui-sm',
        tone === 'error' ? 'text-danger' : 'text-fg-muted'
      )}
    >
      {icon}
      {text}
    </div>
  )
}
