/**
 * The renderer half of the darwin/win32 click-through strategy (architecture §6).
 *
 * There is no `setShape` there, so the window stays
 * `setIgnoreMouseEvents(true, { forward: true })` and the renderer decides when
 * the pointer is genuinely over something interactive. The published rectangles
 * are a LINUX input-shape concept only: they are padded by 6–8 px and merged, so
 * membership in one is not an exact target and never takes the mouse by itself.
 * The exact targets are the DOM nodes the pane renders for interaction —
 * `elementFromPoint(...).closest('[data-pane-hit],[data-pane-chart]')`, with an
 * optional mesh raycast for a body that has no DOM target.
 *
 * The decision and the change-only cursor are pure, so the latch rules
 * (composer open, mid-drag), the stationary-pointer re-test and the
 * empty-regions resync are provable without a window; only the message send
 * lives in the publisher.
 */

export interface Point {
  x: number
  y: number
}

export interface ForwardHitInput {
  platform: NodeJS.Platform
  /** Last forwarded pointer position, null before the first move. */
  pointer: Point | null
  /** `elementFromPoint(...).closest('[data-pane-hit],[data-pane-chart]')` matched something. */
  elementHit: boolean
  /** Optional mesh raycast matched an avatar part with no DOM target. */
  meshHit?: boolean
  /** Any avatar is in `listening` — the composer needs the keyboard and clicks. */
  composerOpen: boolean
  /** A pointer button is down; flipping to click-through mid-drag loses the drag. */
  dragging: boolean
  /** The ignore state the window is in now. */
  current: boolean
}

/**
 * Whether the pane should ignore the mouse (`true`) or take it (`false`).
 *
 * Linux never enters forward mode — `setShape` owns interactivity there — so
 * the current state is returned untouched. While the composer is open the pane
 * must keep the mouse; mid-drag it must not change its mind; before the first
 * pointer move it stays click-through.
 */
export function decideIgnoreMouse(input: ForwardHitInput): boolean {
  const { composerOpen, current, dragging, elementHit, meshHit, platform, pointer } = input

  if (platform === 'linux') {
    return current
  }

  if (composerOpen) {
    return false
  }

  if (dragging) {
    return current
  }

  if (!pointer) {
    return true
  }

  // Only a real target takes the mouse. A padded/merged region is not one:
  // treating it as an exact hit swallowed clicks just beside an avatar or card.
  return !(elementHit || meshHit === true)
}

/** The ignore state the renderer believes main last applied. */
export interface ForwardHitCursor {
  ignore: boolean
}

export interface ForwardHitStepInput {
  platform: NodeJS.Platform
  pointer: Point | null
  elementHit: boolean
  meshHit?: boolean
  composerOpen: boolean
  dragging: boolean
  /** The merged region list this tick; empty means main forces click-through. */
  regionsEmpty: boolean
}

export interface ForwardHitStep {
  /** The cursor to carry into the next tick. */
  ignore: boolean
  /** The `ignore-mouse` message to send, or null when nothing changed. */
  message: { ignore: boolean; type: 'ignore-mouse' } | null
}

/**
 * One publisher tick's worth of forward-mode decision.
 *
 * With no regions at all main's `planHitApplication` already forces
 * click-through (`setIgnoreMouseEvents(true, {forward:true})`), so the cursor
 * resyncs to `true` WITHOUT sending — but it must resync, or the renderer's
 * stale `false` would suppress the next `ignore:false` when a real target
 * appears again. Everything else is a plain change-only compare against the
 * cursor, so the caller can send `message` verbatim.
 */
export function stepForwardHit(cursor: ForwardHitCursor, input: ForwardHitStepInput): ForwardHitStep {
  if (input.platform === 'linux') {
    return { ignore: cursor.ignore, message: null }
  }

  if (input.regionsEmpty) {
    return { ignore: true, message: null }
  }

  const ignore = decideIgnoreMouse({
    composerOpen: input.composerOpen,
    current: cursor.ignore,
    dragging: input.dragging,
    elementHit: input.elementHit,
    meshHit: input.meshHit,
    platform: input.platform,
    pointer: input.pointer
  })

  return { ignore, message: ignore === cursor.ignore ? null : { ignore, type: 'ignore-mouse' } }
}
