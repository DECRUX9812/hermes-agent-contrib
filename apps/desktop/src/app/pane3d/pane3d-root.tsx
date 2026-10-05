// Side-effect: registers Muse. Adding an avatar is one file plus one
// `registerAvatar` call; importing it here is the pane's single composition
// point for the cast.
import './avatars/muse'

import { createRoot } from 'react-dom/client'

import { ErrorBoundary } from '@/components/error-boundary'
import { ThemeProvider } from '@/themes/context'

import { snapshotPane3d } from './director/store'
import { PaneApp } from './pane-app'

/**
 * Boot the 3D Pane window (`?win=pane3d`). Same bundle as the app, mounted
 * lazily by main.tsx so no three.js/@react-three module reaches the main
 * window.
 *
 * Deliberately no StrictMode: its double-invoked effects would create and tear
 * down a second WebGL context per mount, and the pane's whole point is ONE
 * context. The theme provider is needed for the design tokens the DOM layer
 * (cards, bubbles) will use.
 */
export function mountPane3d(): void {
  const style = document.createElement('style')

  // `styles.css` paints the themed opaque background as soon as it lands; the
  // pane must be see-through, and #root must actually fill the window so the
  // canvas covers it.
  style.textContent =
    'html,body,#root{background:transparent !important;width:100%;height:100%;margin:0;overflow:hidden;}'
  document.head.appendChild(style)

  if (import.meta.env.DEV) {
    Object.defineProperty(window, '__pane3dDebug', {
      configurable: true,
      value: Object.freeze({ snapshot: () => snapshotPane3d() })
    })
  }

  const root = document.getElementById('root')

  if (!root) {
    return
  }

  createRoot(root).render(
    <ErrorBoundary label="pane3d">
      <ThemeProvider>
        <PaneApp />
      </ThemeProvider>
    </ErrorBoundary>
  )
}
