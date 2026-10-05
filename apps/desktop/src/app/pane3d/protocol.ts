/**
 * The 3D Pane protocol — the single source of truth for messages exchanged
 * between the main process and the pane/host renderers (architecture §4).
 *
 * Type-only, so the Electron main bundle can `import type` from here without
 * pulling any renderer code (or three.js) into the main process.
 */

export type AvatarId = 'muse' | 'hermes' | 'grok' | 'opencode' | 'claude'

/** Window-local DIP unless the field says screen/world space. */
export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

export type AnchorKind = 'hermes-browser' | 'os-window' | 'desktop'

export interface PaneAnchor {
  kind: AnchorKind
  /** Pane-window-local DIP. */
  rect: ScreenRect
  label: string
}

export interface PageContext {
  source: 'hermes-browser' | 'os-window' | 'none'
  url?: string
  title?: string
  selection?: string
  app?: string
  capturedAt: number
}

export interface NotifyAction {
  id: string
  label: string
}

export interface NotifyRequest {
  avatar: AvatarId
  title: string
  body: string
  action?: NotifyAction
  source?: 'live' | 'dev-harness'
}

export interface ChartSpec {
  title: string
  unit?: string
  /** At most 12 points. */
  series: { label: string; value: number }[]
}

export type DemoScript = 'launch' | 'notify' | 'hangout'

// main → pane
export type PaneState =
  | { type: 'init'; anchor: PaneAnchor; platform: NodeJS.Platform; reducedMotion: boolean }
  | { type: 'anchor'; anchor: PaneAnchor }
  | { type: 'notify'; id: string; request: NotifyRequest }
  | { type: 'demo'; script: DemoScript }
  | { type: 'summon'; avatar: AvatarId }
  | { type: 'dismiss'; avatar: AvatarId }

// pane → main
export type PaneControl =
  | { type: 'ready' }
  | { type: 'hit-regions'; regions: ScreenRect[] }
  | { type: 'focus'; focusable: boolean }
  | { type: 'ignore-mouse'; ignore: boolean }
  | { type: 'notify.action'; id: string; actionId: string }
  | { type: 'notify.dismissed'; id: string }
  | { type: 'open-app' }
  | { type: 'close' }

export const AVATAR_IDS: readonly AvatarId[] = ['muse', 'hermes', 'grok', 'opencode', 'claude']
