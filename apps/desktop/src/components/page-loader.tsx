import { type ComponentProps, useEffect, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface PageLoaderProps extends Omit<ComponentProps<'div'>, 'children'> {
  label?: string
}

// Full-page route load: a skeleton layout (a title-bar skeleton plus three
// rows) that only appears after a 150ms delay, so fast loads never flash.
// For inline button spinners use `Loader` (components/ui/loader) instead.
export function PageLoader({
  'aria-label': ariaLabel,
  className,
  label = 'Loading',
  role = 'status',
  ...props
}: PageLoaderProps) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setShow(true), 150)

    return () => window.clearTimeout(id)
  }, [])

  if (!show) {
    return <div {...props} aria-label={ariaLabel ?? label} className={cn('h-full', className)} role={role} />
  }

  return (
    <div {...props} aria-label={ariaLabel ?? label} className={cn('grid h-full place-items-center p-6', className)} role={role}>
      <div className="grid w-full max-w-md gap-2">
        <p className="text-ui-sm text-fg-muted">{label}</p>
        <Skeleton className="h-6 w-40 rounded-control" />
        <Skeleton className="h-12 w-full rounded-card" />
        <Skeleton className="h-12 w-full rounded-card" />
        <Skeleton className="h-12 w-full rounded-card" />
      </div>
    </div>
  )
}
