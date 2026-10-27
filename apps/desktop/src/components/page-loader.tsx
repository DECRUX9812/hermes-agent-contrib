import { type ComponentProps, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface PageLoaderProps extends Omit<ComponentProps<'div'>, 'children'> {
  label?: string
}

// A page-shaped skeleton while loading; after 8s, one way out instead of a spinner forever (audit M10).
export function PageLoader({
  'aria-label': ariaLabel,
  className,
  label = 'Loading',
  role = 'status',
  ...props
}: PageLoaderProps) {
  const { t } = useI18n()
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8_000)

    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      {...props}
      aria-label={ariaLabel ?? label}
      className={cn('grid h-full place-items-center', className)}
      role={role}
    >
      {slow ? (
        <div className="grid justify-items-center gap-3 text-sm text-muted-foreground">
          {label}
          <Button onClick={() => window.location.reload()} size="sm" variant="outline">
            {t.common.retry}
          </Button>
        </div>
      ) : (
        <div aria-hidden="true" className="grid w-full max-w-md gap-3 p-6">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      )}
    </div>
  )
}
