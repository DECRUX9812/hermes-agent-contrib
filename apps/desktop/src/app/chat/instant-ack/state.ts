/**
 * The instant-ack state machine.
 *
 * Every state in here is something the app can prove. The receipt restates the
 * user's own message; `working` is the name of a tool call that has actually
 * started; `waiting` means the turn began and produced nothing; `approval` is a
 * live block on the user. There is no "thinking about it" state, because the
 * app cannot know that.
 *
 * Pure and i18n-free: `detail` is carried verbatim (already-localised by the
 * caller) so the reducer is testable without a React tree or a locale.
 */

export type InstantAckState = 'approval' | 'receipt' | 'waiting' | 'working'

export interface InstantAck {
  /** The restated ask (receipt) or the running tool's present verb (working). */
  detail: string
  /** When the ack first appeared. */
  armedAt: number
  /** When a real event last changed it. */
  updatedAt: number
  state: InstantAckState
}

export type InstantAckEvent =
  | { at: number; detail: string; type: 'arm' }
  | { at: number; detail: string; type: 'tool-start' }
  | { at: number; type: 'waiting' }
  | { at: number; type: 'approval' }
  /** Real turn state took over: reply text, turn end, or an error. */
  | { at: number; type: 'hand-off' }

/**
 * How long a receipt may stand before it admits it is waiting on the model.
 *
 * The brief's Part B target is one second. Past that the honest line is that
 * nothing has happened yet — not a reworded guess at what the model is doing.
 */
export const WAITING_AFTER_MS = 1200

/**
 * How long a waiting line may stand on a session that is not busy before it is
 * dropped. `busy` lags a send by a tick or two, so clearing immediately would
 * blink the line on every send; leaving it longer would keep claiming a turn
 * that a refused submit never started.
 */
export const IDLE_WAITING_GRACE_MS = 2000

/**
 * Apply one real event. Returns `null` when there is nothing left to say, which
 * is the signal for the row to unmount rather than linger on a stale claim.
 */
export function reduceInstantAck(current: InstantAck | null, event: InstantAckEvent): InstantAck | null {
  if (event.type === 'hand-off') {
    return null
  }

  // A new send always owns the row: the previous turn's line would otherwise
  // narrate someone else's work.
  if (event.type === 'arm') {
    return { armedAt: event.at, detail: event.detail, state: 'receipt', updatedAt: event.at }
  }

  // Nothing was armed (a reply from a source with no send, e.g. a background
  // resume or a cron kickoff): there is no receipt to promote.
  if (current === null) {
    return null
  }

  if (event.type === 'approval') {
    return { ...current, detail: current.detail, state: 'approval', updatedAt: event.at }
  }

  if (event.type === 'tool-start') {
    return { ...current, detail: event.detail, state: 'working', updatedAt: event.at }
  }

  // Silence is only news before the turn has named anything. Once a tool is
  // running its card carries the timer ("Opening example.com…"), so a second
  // waiting line would count the same seconds twice.
  if (event.type === 'waiting') {
    return current.state === 'receipt' ? { ...current, state: 'waiting', updatedAt: event.at } : current
  }

  return current
}

/** Whether a state still owns a live claim worth animating. */
export function isLiveAck(state: InstantAckState): boolean {
  return state === 'receipt' || state === 'working'
}
