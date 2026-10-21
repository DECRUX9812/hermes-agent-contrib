/**
 * Pure helpers for the Bot Room overlay — the full-screen transparent layer
 * where bot mascots live on the desktop itself. Side-effect-free so the
 * geometry is unit-testable without booting Electron; `botroom-ipc.ts` owns
 * the live window and IPC.
 */

/**
 * Whether the overlay may start click-through. `setIgnoreMouseEvents(true,
 * { forward: true })` only forwards pointer moves on macOS/Windows; on Linux
 * an ignoring fullscreen layer could never re-arm under the cursor, so it
 * stays a solid window (the pet overlay makes the same call).
 */
export const botroomClickThrough = (platform = process.platform) => platform !== 'linux'

/**
 * The Bot Room covers a display's whole work area — mascots need the entire
 * desktop as their stage, panels and windows float anywhere in it. The window
 * is positioned on the primary display by default; a passed display index
 * homes it there instead.
 */
export function resolveBotRoomBounds(displays, displayIndex = 0) {
  const list = Array.isArray(displays) ? displays : []

  if (!list.length) {
    return null
  }

  const display = list[Math.max(0, Math.min(displayIndex, list.length - 1))]
  const a = display?.workArea ?? display?.bounds

  if (!a || ![a.x, a.y, a.width, a.height].every(Number.isFinite)) {
    return null
  }

  return { x: a.x, y: a.y, width: a.width, height: a.height }
}
