import { lazy, Suspense } from 'react'

import { PageLoader } from '@/components/page-loader'
import { useI18n } from '@/i18n'

// Offline fonts: vite.config's excalidraw-assets plugin serves/emits them next
// to the app, so Excalidraw never reaches for its CDN.
if (typeof window !== 'undefined') {
  ;(window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL(
    'excalidraw-assets/',
    document.baseURI
  ).href
}

const CanvasSurface = lazy(() => import('./canvas-surface'))

/** `.excalidraw` files in the preview: a live canvas (the heavy editor loads
 *  only when one opens). */
export function CanvasViewer({ filePath, text }: { filePath: string; text: string }) {
  const { t } = useI18n()

  return (
    <Suspense fallback={<PageLoader label={t.preview.loading} />}>
      <CanvasSurface filePath={filePath} text={text} />
    </Suspense>
  )
}
