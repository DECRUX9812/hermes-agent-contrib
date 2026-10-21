# Bring Your Harness

Bot Room doesn't care what your agent runs on. It cares that it can take a
task and return text. If your thing can do that — a model endpoint, an agent
framework, a character server, a CLI binary — it gets a 3D mascot on every
web page, a seat in the rooms, and hands that can drive the tab.

This is the whole contract. ~50 lines. No religion.

## The contract

A harness is a TypeScript class in `src/background/adapters/` that answers
four questions (`src/background/harness.ts`):

```ts
interface Harness {
  readonly id: string           // stable harness id (from cfg.id)
  readonly kind: string         // your registry key, e.g. 'acp'
  readonly name: string         // shown in the room roster
  readonly pageControl: boolean // may your bots drive the user's tab?

  listBots(): Promise<Bot[]>    // your roster; `ref` is YOUR opaque handle —
                                // send() gets it back verbatim. Never throw:
                                // backend down = last known roster, not [].
  send(botRef, text, cb): Promise<TaskResult>
                                // run ONE turn. Stream via cb.onDelta,
                                // narrate via cb.onStatus. Settle once —
                                // resolve {text} or reject. A dangling send()
                                // is a bot stuck "working" forever (MV3
                                // workers get reaped; plan for it).
  interrupt?(botRef)            // best-effort cancel
  dispose()                     // drop sockets/timers/cache
}
```

Page control rides one callback: `cb.onPageAction(action, args, reply)`. The
action vocabulary is the `page_action` tool spec (`openai.ts`): navigate,
click, type, press, scroll, back, tabs, tab_activate, snapshot, screenshot,
read, compose, dom_hide/dom_insert/dom_style, highlight, annotate,
window.open/close, widget.open, `mascot.perform`, `web.fetch`. `reply()`
hands the tab's answer back to your harness.

Memory is your business: keep history server-side, in a `Map`, or in the
CLI's own resume — the room doesn't care.

Register it:

```ts
export const ADAPTERS = { 'your-kind': cfg => new YourHarness(cfg), … }
```

`kind` comes from the preset the user picks in Options. `kind:"x:y"` suffixes
are legal (read them off `cfg.kind`).

## What each harness gets

| Harness | Mascot | Rooms | Page control | Voice | Notes |
|---|---|---|---|---|---|
| Hermes | ✅ | ✅ | ✅ native `browser.controller.*` | ✅ | full fidelity: real profiles, canonical Bot Chat, streaming events |
| OpenAI-compat (`openai`) | ✅ | ✅ | ✅ `page_action` tool loop | ✅ | Grok/xAI, OpenAI, OpenRouter, ollama, LiteLLM |
| OpenClaw (`openclaw`) | ✅ | ✅ | ✅ `page_action` tool loop | ✅ | roster pulled live from `GET /v1/models` (`openclaw/<agent>`) |
| CLI relay (`cli-relay`) | ✅ | ✅ | ◐ stdout `page_action` echo | ✅ | Codex / Claude Code / OpenCode / Gemini on your own machine |
| ACP (`acp`) | ✅ | ✅ | ◐ `<page_action>` markers | ✅ | any Agent Client Protocol agent over a ws/stdio relay |
| Muse persona (`muse`) | ✅ | ✅ | ◐ `mascot.perform` only | ✅ | character endpoints: `{text} → {reply, action?}` |

◐ = best-effort channel (echo/markers/stage directions) rather than a native
tool call. Voice input lives in the panel (Web Speech API) — every harness
gets it free; output is whatever your thing already sounds like.

## Config examples

Harnesses live in `settings.harnesses` (`GenericHarnessConfig`; the Options
page edits them, or hand-edit `bot-room.settings` in chrome.storage):

```jsonc
{
  "id": "gx1", "kind": "openai", "name": "Grok",
  "baseUrl": "https://api.x.ai/v1", "apiKey": "xai-…",
  "model": "grok-3",
  "bots": [{"name": "Grokbot", "systemPrompt": "fast, witty, slightly unhinged"}]
}
```

```jsonc
{ "id": "gx2", "kind": "openai", "name": "OpenAI",
  "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-…", "model": "gpt-4o",
  "bots": [{"name": "Scout", "systemPrompt": "precise browsing assistant"}] }
```

```jsonc
// Anthropic-compat: point an OpenAI-shaped shim (LiteLLM, OpenRouter,
// one-api — anything that answers /chat/completions) at the room.
{ "id": "gx3", "kind": "openai", "name": "Claude via LiteLLM",
  "baseUrl": "http://127.0.0.1:4000/v1", "apiKey": "sk-litellm",
  "model": "anthropic/claude-sonnet-4",
  "bots": [{"name": "Claudebot", "systemPrompt": "thoughtful, brief"}] }
```

```jsonc
// OpenClaw — the gateway (default port 18789) multiplexes HTTP+WS;
// chat/completions is off by default upstream, enable it in gateway config.
{ "id": "gx4", "kind": "openclaw", "name": "OpenClaw",
  "baseUrl": "http://127.0.0.1:18789", "apiKey": "$OPENCLAW_GATEWAY_TOKEN",
  "model": "openclaw/default",
  "bots": [{"name": "Claw", "systemPrompt": ""}] }
```

```jsonc
// Muse persona — the character contract: POST {bot,text,persona,history}
// → {reply, emotion?, action?}. emotions/verbs drive mascot.perform.
{ "id": "gx5", "kind": "muse", "name": "Muse",
  "baseUrl": "http://127.0.0.1:8181/reply", "apiKey": "",
  "model": "", "bots": [{"name": "Muse", "systemPrompt": "playful, dramatic"}] }
```

```jsonc
// ACP — any Agent Client Protocol agent behind a relay
// (initialize → session/new → session/prompt; session/update streams back).
{ "id": "gx6", "kind": "acp", "name": "Zed-style agent",
  "baseUrl": "ws://127.0.0.1:9944", "apiKey": "", "model": "",
  "bots": [{"name": "Acp", "systemPrompt": ""}] }
```

```jsonc
// CLI relay — Codex, Claude Code, OpenCode, or Gemini CLI on YOUR machine.
// "model" doubles as the preset name (codex|claude|opencode|gemini); a
// kind suffix works too: "cli-relay:claude".
{ "id": "gx7", "kind": "cli-relay", "name": "Codex CLI",
  "baseUrl": "ws://127.0.0.1:9933", "apiKey": "", "model": "codex",
  "bots": [{"name": "Codexbot", "systemPrompt": ""}] }
```

## The CLI relay protocol (one-pager)

Browsers can't spawn processes; a tiny relay on `ws://127.0.0.1:9933` owns
argv (`hermes bot-relay` is the reference implementation — any process that
speaks these frames works). One text frame = one JSON object.

```
ext → relay   {type:'init', client:'bot-room', version:1}
              {type:'ping'}                                   (keepalive)
              {type:'task.start', task_id, bot,
                preset:'codex|claude|opencode|gemini',
                spec:{cmd,args,format,session_args?,env?},    // argv template;
                text, session_id?, timeout_ms}                // '{prompt}' arg
                                                              // substituted,
                                                              // never re-split
              {type:'task.interrupt', task_id}
              {type:'action.result', task_id, action_id?, ok, result?, error?}

relay → ext   {type:'hello', relay, version, clis:[…]}
              {type:'accepted', task_id, pid?}
              {type:'delta',  task_id, text}      // normalized assistant text
              {type:'status', task_id, line}      // "ran ls", progress lines
              {type:'page_action', task_id, action_id?, action, arguments}
              {type:'done',   task_id, text, exit_code?, session_id?}
              {type:'error',  task_id?, message, fatal?}
              {type:'pong'}
```

`spec.format` tells the relay how stdout decodes: `codex-jsonl` (Codex
`exec --json` events), `claude-jsonl` (stream-json assistant/result frames),
`opencode-jsonl` (part events), `gemini-json` (one whole-buffer `{response}`),
or `text` (raw stdout → deltas — the universal fallback).

Page control for CLIs is an echo channel: the adapter injects a preamble
teaching the agent to print `{"bot_room":"page_action",…}` lines; the relay
forwards them as `page_action` frames, the tab acts, `action.result` flows
back (fire-and-forget when `action_id` is absent). `session_id` echoes both
ways so the CLI can resume (`--resume`, `codex exec resume`, …) — per-bot
memory without the extension knowing anything about your CLI.

argv law for relay authors: `spawn(cmd, args, {shell:false})`; placeholders
substitute per-arg; no shell, ever. That's the whole deal.

## Ship your adapter

New kind → new file in `src/background/adapters/` → one line in
`ADAPTERS` (`index.ts`). The roster poll calls `listBots()` every 8 s;
`send()` gets the room-wrapped prompt (mentions, scratchpad, `[Name]:`
prefixes) already baked. If you need a hook that doesn't exist, that's an
`// ADAPTER-TODO:` in your file, not a fork of sw.ts.

Introduce your thing into our thing. Worst case, it dances.
