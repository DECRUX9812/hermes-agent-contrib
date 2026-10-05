/**
 * Adapter registry — every "harness kind" maps to a factory.
 *
 * ───────────────────────── THE BOT ROOM ADAPTER CONTRACT ─────────────────────────
 * The handshake doc for external harness authors. ~50 lines, no code required
 * to understand it.
 *
 * A "harness" is anything that owns bots. To make yours a citizen of the
 * room, implement `Harness` (../harness.ts) — four questions, no more:
 *
 *   id / kind / name     who you are (`kind` = the registry key)
 *   pageControl          whether your bots may drive the user's tab
 *   listBots()           → Bot[]; your roster. `ref` is YOUR opaque handle —
 *                        send() gets it back verbatim. Never throw: return
 *                        the last known roster when the backend is down.
 *   send(ref, text, cb)  → {text, actionsRun?}; run ONE turn. Stream text
 *                        with cb.onDelta, narrate progress with cb.onStatus.
 *                        Settle exactly once — resolve with the full reply,
 *                        reject on failure. Never leave the promise hanging:
 *                        MV3 service workers get reaped; a dangling send()
 *                        is a bot stuck "working" forever.
 *   interrupt?(ref)      best-effort cancel of the in-flight send.
 *   dispose()            drop sockets, timers, caches — the SW rebuilds
 *                        harnesses on every settings change.
 *
 * Page control is opt-in but trivial: with `pageControl: true`, call
 * `cb.onPageAction(action, args, reply)` — `reply(result)` returns the
 * tab's answer (snapshot text, click result) back to your harness. The
 * action vocabulary is the `page_action` tool spec in ../openai.ts:
 * navigate / click / type / press / scroll / back / tabs / tab_activate /
 * snapshot / screenshot / read / compose / dom_* / highlight / annotate /
 * window.* / widget.* / mascot.perform / web.fetch. Harnesses that only want
 * stage directions (personas) keep pageControl false and may still call
 * `onPageAction('mascot.perform', …)` — the channel is always live.
 *
 * What a bot gets for free once registered: a 3D mascot on every page,
 * draggable + taskable by click or voice; rooms (mention + round-robin
 * relay, shared scratchpad — bots literally hand notes to each other);
 * status lines under the mascot; and, with pageControl, the page itself.
 *
 * Conversation memory is YOUR problem: Hermes and OpenClaw keep it
 * server-side; the CLI adapter echoes `session_id` back to the relay;
 * OpenAI-shaped endpoints keep history in this file's Map. Whatever fits.
 *
 * Registration: `ADAPTERS['your-kind'] = cfg => new YourHarness(cfg)`. The
 * `kind` string arrives via the preset the user clicked in Options (or
 * hand-edited settings) — `cli-relay:codex`-style suffixes are legal, read
 * them off cfg.kind.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * ADAPTER-TODO(sw.ts): `BotRoomService.buildHarnesses()` still calls
 * `makeOpenAIHarness(cfg)` for every configured harness regardless of
 * cfg.kind — swap it for `makeHarness(cfg)` (below) so non-OpenAI kinds
 * actually resolve. Parent session owns sw.ts.
 *
 * ADAPTER-TODO(options.ts): the "add harness" form requires a non-empty
 * model field — that blocks the `acp`/`cli-relay`/`muse` presets whose
 * model is optional/meaningless (cli-relay uses it as the CLI preset name).
 * Kind-aware validation + a CLI-preset picker belong there.
 */

import type { GenericHarnessConfig } from '../../shared/types'
import type { Harness } from '../harness'
import { OpenAIHarness } from '../openai'

import { AcpHarness } from './acp'
import { CliRelayHarness } from './cli-harness'
import { MuseHarness } from './muse'
import { OpenClawHarness } from './openclaw'

export const ADAPTERS: Record<string, (cfg: GenericHarnessConfig) => Harness> = {
  acp: cfg => new AcpHarness(cfg),
  'cli-relay': cfg => new CliRelayHarness(cfg),
  muse: cfg => new MuseHarness(cfg),
  openai: cfg => new OpenAIHarness(cfg),
  'openai-http': cfg => new OpenAIHarness(cfg),
  openclaw: cfg => new OpenClawHarness(cfg),
}

/**
 * Build the harness for one config: exact kind match, then the kind's
 * prefix before ':' (so 'cli-relay:claude' resolves to the cli adapter),
 * then the OpenAI-compatible fallback — an unknown kind is almost always
 * someone pointing at a chat-completions-shaped endpoint.
 */
export function makeHarness(cfg: GenericHarnessConfig): Harness {
  const kind = cfg.kind ?? 'openai'
  const factory = ADAPTERS[kind] ?? ADAPTERS[kind.split(':')[0] ?? ''] ?? ADAPTERS['openai']

  return factory!(cfg)
}
