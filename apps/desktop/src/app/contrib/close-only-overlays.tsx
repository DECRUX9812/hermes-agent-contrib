import { type ComponentType, Suspense } from 'react'

export interface CloseOnlyOverlay {
  id: string
  open: boolean
  View: ComponentType<{ onClose: () => void }>
}

// Route overlays whose only prop is onClose, rendered from one table in their
// listed order (later entries paint above earlier ones).
export function CloseOnlyOverlays({ overlays, onClose }: { overlays: CloseOnlyOverlay[]; onClose: () => void }) {
  return overlays.map(({ id, open, View }) =>
    open ? (
      <Suspense fallback={null} key={id}>
        <View onClose={onClose} />
      </Suspense>
    ) : null
  )
}
