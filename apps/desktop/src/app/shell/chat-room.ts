import { findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $layoutTree } from '@/components/pane-shell/tree/store'
import { $sidebarOpen, setSidebarOpen } from '@/store/layout'

// The chat keeps a readable width. Panels and the sidebar give way before the
// conversation does — Codex's order: a panel that would squeeze the chat stays
// a tab (panel-launcher), and when the chat is still too narrow (a smaller
// window, a panel opened elsewhere) the left sidebar folds away, then comes
// back by itself once the room returns — unless you moved it in between.

/** Narrowest chat that still reads well — about what a popped-out session
 *  window enforces on itself. */
export const CHAT_COMFORT_PX = 440

/** Extra room required before an auto-folded sidebar returns, so a window
 *  resized around the threshold doesn't flap the sidebar in and out. */
const UNFOLD_SLACK_PX = 48

/** Rendered width of the zone holding `pane` (Infinity when it isn't shown). */
export function zoneWidthOf(pane: string): number {
  const tree = $layoutTree.get()
  const group = tree ? findGroupOfPane(tree, pane) : null
  const el = group ? document.querySelector<HTMLElement>(`[data-tree-group="${CSS.escape(group.id)}"]`) : null

  return el ? el.getBoundingClientRect().width : Number.POSITIVE_INFINITY
}

export interface ChatRoomState {
  /** Sidebar width when it was auto-folded; null when the user owns its state. */
  foldedWidth: null | number
  sidebarOpen: boolean
}

/** What the sidebar should do for a chat this wide. */
export function chatRoomAction(chat: number, state: ChatRoomState): 'fold' | 'unfold' | null {
  if (state.sidebarOpen && chat < CHAT_COMFORT_PX) {
    return 'fold'
  }

  if (!state.sidebarOpen && state.foldedWidth !== null && chat - state.foldedWidth >= CHAT_COMFORT_PX + UNFOLD_SLACK_PX) {
    return 'unfold'
  }

  return null
}

let foldedWidth: null | number = null
let applying = false

/** Fold the sidebar now if the chat is too narrow (after a panel opens). */
export function keepChatRoomy(): void {
  const action = chatRoomAction(zoneWidthOf('workspace'), { foldedWidth, sidebarOpen: $sidebarOpen.get() })

  if (!action) {
    return
  }

  applying = true

  if (action === 'fold') {
    const width = zoneWidthOf('sessions')

    foldedWidth = Number.isFinite(width) ? width : 0
    setSidebarOpen(false)
  } else {
    foldedWidth = null
    setSidebarOpen(true)
  }

  applying = false
}

let installed = false

/** Watch window resizes for the life of the app (idempotent). */
export function installChatRoomGuard(): void {
  if (installed || typeof window === 'undefined') {
    return
  }

  installed = true

  // A sidebar the user opens or closes themselves is theirs again.
  $sidebarOpen.listen(() => {
    if (!applying) {
      foldedWidth = null
    }
  })

  let timer: null | number = null

  window.addEventListener('resize', () => {
    if (timer !== null) {
      window.clearTimeout(timer)
    }

    timer = window.setTimeout(() => {
      timer = null
      keepChatRoomy()
    }, 150)
  })
}
