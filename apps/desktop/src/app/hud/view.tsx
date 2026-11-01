/**
 * Which realm the HUD is rendering in.
 *
 * Electron's HUD is its own window, so every `window` and `document` inside
 * `app/hud/*` IS the HUD's. The browser HUD is portalled into a Document-PiP
 * window from the app renderer, so those same components run with two realms in
 * scope: the app's (where their React tree lives) and the PiP window's (where
 * their DOM lands and where the viewport facts come from). Hooks that measure
 * the viewport therefore take the view from here instead of reaching for the
 * global, and default to the app's own window when nothing wraps them — which
 * is the Electron case and every unit test.
 *
 * `useHudSurface()` is the companion answer to a different question: "is this
 * subtree the HUD?" It exists because the portal renders the REAL composer
 * inside the same renderer as the app shell, and shared components (composer
 * drag, the exit chip, the submit surface hint) branch on `$hudMode`, which is
 * per-window and stays false in a browser tab.
 */

import { createContext, type ReactNode, useContext } from 'react'

export interface HudView {
  document: Document
  window: Window
}

const HudViewContext = createContext<HudView | null>(null)
const HudSurfaceContext = createContext(false)

/** The renderer's own realm, built lazily so importing this module never
 *  touches globals at module scope. */
let rendererHudView: HudView | null = null

export const ownHudView = (): HudView => (rendererHudView ??= { document, window })

export function useHudView(): HudView {
  return useContext(HudViewContext) ?? ownHudView()
}

/** True inside the portalled HUD subtree (never inside the app shell). */
export const useHudSurface = (): boolean => useContext(HudSurfaceContext)

export function HudViewProvider({ children, view }: { children: ReactNode; view: HudView }) {
  return <HudViewContext.Provider value={view}>{children}</HudViewContext.Provider>
}

export function HudSurfaceProvider({ children }: { children: ReactNode }) {
  return <HudSurfaceContext.Provider value>{children}</HudSurfaceContext.Provider>
}
