/**
 * Small shared helpers for the adapter layer — kept dependency-free so each
 * adapter file can be read standalone (that is the point of the directory).
 */

import type { Bot, GenericHarnessConfig } from '../../shared/types'

/** Deterministic per-bot accent — same name→hue recipe as sw.ts profileColorFor. */
export function colorFor(name: string): string {
  let h = 0

  for (const ch of name) {h = (h * 31 + ch.charCodeAt(0)) >>> 0}

  return `hsl(${h % 360}, 72%, 58%)`
}

/**
 * Build the Bot[] a config-driven adapter advertises: one virtual bot per
 * cfg.bots entry. `ref` is the cfg name — the harness resolves it back to
 * whatever session/conversation it manages under the hood.
 */
export function cfgBots(cfg: GenericHarnessConfig, pageControl: boolean): Bot[] {
  return cfg.bots.map(b => ({
    id: `${cfg.id}:${b.name}`,
    harnessId: cfg.id,
    name: b.name,
    displayName: b.name,
    color: colorFor(b.name),
    status: 'idle' as const,
    pageControl,
    ref: b.name,
  }))
}

/** Configured system prompt for one bot, or '' when unset. */
export function systemPromptFor(cfg: GenericHarnessConfig, ref: string): string {
  return cfg.bots.find(b => b.name === ref)?.systemPrompt ?? ''
}
