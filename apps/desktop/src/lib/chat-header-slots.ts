import type { ReactNode } from 'react'

/**
 * Chat-header decoration surface — the seam a plugin can extend the chat
 * header through, with the SAME registry schema as every other surface
 * (statusbar, composer, panes, session rows):
 *
 *   render areas (`data`):  chatHeader.title — inline right after the title
 *                                              menu trigger
 *
 * Core keeps ownership of the header's layout and the session-actions menu —
 * this seam AUGMENTS the title row with a small decoration (a subtitle, a
 * chip); it never replaces the title or the menu. A contribution renders
 * `null` for headers it doesn't own, so registering one costs nothing on
 * every other chat.
 */

export const CHAT_HEADER_AREAS = {
  title: 'chatHeader.title'
} as const

/** Props handed to a chat-header decoration's `render`. */
export interface ChatHeaderSlotProps {
  /** The DURABLE (lineage-root) id of the session in view — `sessionPinId`,
   *  not the live tip id, so a decoration survives auto-compression rotating
   *  the session id. Null while a draft without a stored row is in view. */
  sessionId: null | string
  /** The owning profile name on the session row, when resolved. */
  profile: null | string
  /** The title the header is showing (sessionTitle of the stored row, or the
   *  new-session label). */
  title: string
}

/** Payload of a `chatHeader.*` contribution's `data`. */
export interface ChatHeaderSlotContribution {
  /** Renders the decoration, or `null` to leave the header untouched. Mounted
   *  as a component inside the contribution error boundary, so it can
   *  subscribe to its own stores; a throw degrades to an inline error, not a
   *  dead header. */
  render: (props: ChatHeaderSlotProps) => ReactNode
}
