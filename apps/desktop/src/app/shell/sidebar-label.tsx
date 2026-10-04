import type * as React from 'react'

import { cn } from '@/lib/utils'

interface SidebarPanelLabelProps extends React.ComponentProps<'span'> {
  dotClassName?: string
}

export function SidebarPanelLabel({ children, className, dotClassName, ...props }: SidebarPanelLabelProps) {
  return (
    <span className={cn('ui-section-label flex min-w-0 items-center gap-2 pl-2', className)} {...props}>
      <span
        aria-hidden="true"
        className={cn('dither ui-section-label-glyph size-2 shrink-0 rounded-[1px]', dotClassName)}
      />
      <span className="min-w-0 truncate leading-none">{children}</span>
    </span>
  )
}
