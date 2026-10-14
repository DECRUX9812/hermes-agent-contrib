/**
 * FORK-ONLY WIRE TYPES — declarations for RPCs the fork adds to the gateway.
 *
 * Upstream declares every method it owns in `tui_gateway/contracts/` and renders the TypeScript
 * shapes into `apps/shared/src/gateway-contract.generated.ts`. The fork's extra methods live in
 * topical siblings there (`methods_fork_onboarding.py`, `methods_session_ask.py`) and are NOT part
 * of that generated contract, so nothing upstream-named exports their result shapes. Declaring
 * them here — under `src/fork/`, never in `@hermes/shared` — keeps the fork's additions off
 * upstream's surface: an upstream file that imports a name from here is the bug this file exists
 * to make impossible.
 *
 * The shapes mirror the Python handler's reply exactly. A drift shows up as a runtime `undefined`,
 * so every consumer reads them defensively (see `store/onboarding-gate.ts`,
 * `store/session-ask.ts`).
 */

/** ``setup_choose`` card kinds. ``fork`` / ``machine_use`` / ``tour`` rows are filled by the
 *  backend, so the renderer only knows them once the request arrives. */
export type SetupChooseKind =
  | 'accent'
  | 'connectors'
  | 'fork'
  | 'layout'
  | 'machine_use'
  | 'plugins'
  | 'question'
  | 'theme'
  | 'tour'

/** One row of a picker card. `detail` is the optional second line (a reason, a missing-app note). */
export interface SetupChooseOption {
  detail?: string | null
  id: string
  label: string
}

/** ``fork.onboarding.state`` reply (``hermes_cli/setup_profile.py::read_state``). */
export interface OnboardingStateResult {
  eligible: boolean
  /** How far the intro got: `unseen` before the user has seen it, then `seen`. */
  intro: 'seen' | 'unseen'
  /** Starts that failed before the guide opened; a later attempt nudges the copy. */
  failed_starts: number
  /** The setup profile's name, or null when none exists yet. */
  profile?: null | string
}

/** ``fork.onboarding.ensure_setup_profile`` reply. */
export interface OnboardingEnsureSetupProfileResult {
  created: boolean
  name: string
  path: string
}

/** ``fork.onboarding.ensure_setup_session`` reply. */
export interface OnboardingEnsureSetupSessionResult {
  /** True only before the setup chat's first turn — the caller replays the opening prompt. */
  empty: boolean
  profile: string
  session_id: string
}

/** ``session.ask`` reply (``tui_gateway/methods_session_ask.py``). */
export interface SessionAskResult {
  answer: string
  truncated: boolean
}

/** ``session.start_chat`` args — the tool call whose result the card renders. */
export interface StartChatArgs {
  /** What the setup chat hands off to the task chat. */
  brief?: string
  goal?: string
  task?: string
  /** The card re-sends the args it parsed off the tool call, so absent values arrive as null. */
  title?: null | string
  [key: string]: unknown
}

/** ``session.start_chat`` reply. */
export interface SessionStartChatResult {
  profile?: null | string
  session_id?: string
  title?: null | string
  status?: 'started' | 'rejected'
  reason?: string
  retryable?: boolean
}
