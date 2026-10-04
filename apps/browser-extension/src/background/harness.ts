/**
 * Harness interface — the multi-harness seam.
 *
 * A "harness" is anything that owns bots: the Hermes gateway (bots are
 * profiles), an OpenAI-compatible endpoint (Grok, OpenClaw, ollama), a local
 * CLI wrapper, ACP. Each adapter answers the same four questions and the
 * room engine above never asks which kind it is.
 *
 *   Hermes    → full fidelity: real profiles, canonical Bot Chat, streaming
 *               events, page control via browser.controller.*
 *   OpenAI    → chat-completions loop with a `page_action` tool; page
 *               control proxied through the same room channel
 *   (future)  → ACP adapter, CLI adapter (codex/claude/opencode — the t3code
 *               trick), remote Devin sessions
 */

import type { Bot } from '../shared/types'

export interface TaskCallbacks {
  /** Streaming text deltas (best effort — may be empty for dumb endpoints). */
  onDelta?: (text: string) => void
  /** Status line updates ("Ran 2 commands"). */
  onStatus?: (line: string) => void
  /** The harness wants a page action executed in the user's tab. */
  onPageAction?: (action: string, args: Record<string, unknown>, reply: (result: unknown) => void) => void
}

export interface TaskResult {
  text: string
  /** Any page actions the harness requested during the turn. */
  actionsRun?: number
}

export interface Harness {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly pageControl: boolean

  listBots(): Promise<Bot[]>
  /** Send a user/room message to a bot's working session. */
  send(botRef: string, text: string, cb: TaskCallbacks): Promise<TaskResult>
  interrupt?(botRef: string): Promise<void>
  dispose(): void
}

/** Tiny ID helper shared by adapters. */
export function rid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
