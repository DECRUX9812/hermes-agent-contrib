import { atom } from 'nanostores'

import { persistStore } from '@/lib/persist-store'
import { persistBoolean, storedBoolean } from '@/lib/storage'
import { modeBound } from '@/store/interface-mode'
import type { HermesConfig } from '@/types/hermes'

const REASONING_COLLAPSED_BY_DEFAULT_STORAGE_KEY = 'hermes.desktop.reasoning.collapsedByDefault'

/** Desktop-local presentation preference; shared backend config must not be changed by a single window.
 *  Simple mode rests reasoning collapsed without touching this preference. */
const $reasoningCollapsedByDefaultPref = atom(storedBoolean(REASONING_COLLAPSED_BY_DEFAULT_STORAGE_KEY, false))

persistStore(
  $reasoningCollapsedByDefaultPref,
  (value, options) => persistBoolean(REASONING_COLLAPSED_BY_DEFAULT_STORAGE_KEY, value, options),
  false
)

export const $reasoningCollapsedByDefault = modeBound(
  'reasoningCollapsedByDefault',
  $reasoningCollapsedByDefaultPref,
  value => $reasoningCollapsedByDefaultPref.set(value)
)

export function setReasoningCollapsedByDefault(value: boolean) {
  $reasoningCollapsedByDefault.set(value)
}

// Mirrors `display.show_reasoning` (Settings → Chat → Reasoning Blocks). On
// by default like DEFAULT_CONFIG; a quoted "false" in config.yaml still
// means off (sibling: display-timestamps.ts).
// Reasoning is OPT-IN. The transcript must not narrate chain-of-thought by
// default: the visible answer is the prose, the thinking stays in the message
// object and the logs. A user who wants it turns on Settings → Chat →
// Reasoning Blocks, or runs `/reasoning show`; both arrive through
// `setShowReasoningFromConfig` / the platform override and flip this on.
export const $showReasoning = atom(false)

export function setShowReasoningFromConfig(value: unknown): void {
  // Opt-in, not opt-out: only an explicit truthy value shows reasoning. A
  // missing key, `undefined` or the backend's DEFAULT_CONFIG `true` do not
  // re-enable it — the request is that the chat reads reasoning-free.
  $showReasoning.set(value === true || value === 'true' || value === 1)
}

/** The `display.show_reasoning` a local surface uses: a local session's `/reasoning show|hide` saves the
 *  per-platform `display.platforms.cli` key (the gateway's key for local sessions), which wins over the
 *  global one, as the gateway and the other local clients resolve it. */
export function localShowReasoning(display: HermesConfig['display']): boolean | string | undefined {
  return display?.platforms?.cli?.show_reasoning ?? display?.show_reasoning
}
