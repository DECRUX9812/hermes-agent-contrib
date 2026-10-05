# @hermes/browser-extension — Bot Room

Your agents, living in the browser. Bot Room is a Chrome MV3 extension that
drops a 3D mascot overlay onto every page: each bot is a draggable character
that takes tasks by click or voice, chats in rooms with other bots, and can
drive the tab itself.

## Harnesses

Bot Room is multi-harness. An adapter is ~40 lines: anything that can take a
task and return text can live in the room.

| Adapter | Status | Notes |
|---|---|---|
| Hermes | built in | Bots = Hermes profiles, canonical hidden "Bot Chat" session per profile, `browser.controller.*` native page control via `/api/ws` ws-tickets |
| OpenAI-compatible | built in | Any `chat/completions` endpoint — Grok/xAI, OpenClaw, local models, Muse-style personas. Bots get a `page_action` tool |
| ACP / CLI | documented slot | `src/background/adapters/` interface is stable for agent-protocol adapters |

## Features

- **3D mascots** — deterministic identity per bot name (shape/color/face via
  the same seed vocabulary as blobatar), rendered with Three.js: squash-and-
  stretch idle, dance, wave, spin, jump, celebrate, sleep, point-at-element.
  `mascot.perform` is itself a page action so bots can perform on command.
- **Drag-and-drop** — move mascots anywhere; drop a bot on a page element to
  attach it as task context ("reply to this tweet like…"); drop on a room
  chip to move the bot into that room.
- **Rooms** — group chats with a relay engine (`@mention` or round-robin),
  a shared scratchpad ("hand notes to each other"), and bots re-relaying in
  round-robin rooms. Rooms are extension-local so mixed-harness rooms work.
- **Page control** — Hermes bots use the backend's `browser.controller.*`
  lane; other harnesses get the identical vocabulary through `page_action`:
  navigate, click, type, press, scroll, back, snapshot, read, plus
  `dom_hide` / `dom_style` / `dom_insert` / `compose` / `highlight` /
  `annotate`. Mutating actions are serialized per tab so parallel bots don't
  stomp each other.
- **Voice** — mic button on every panel (Web Speech API).
- **Any page** — content script renders into a closed shadow root; disabled
  hosts configurable in options.

## Build

```bash
npm run build      # esbuild → dist bundles next to manifest
npm run dev        # watch mode
npm run typecheck
npm run lint
```

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked →
pick `apps/browser-extension`. Open the extension Options to point at your
`hermes serve` backend (URL + token) and/or add OpenAI-compatible harnesses.

## Architecture

```
src/shared/types.ts     protocol: settings, Bot, Room, ContentToSw/SwToContent
src/background/rpc.ts   JSON-RPC WS client + ws-ticket mint (auth ladder)
src/background/harness.ts  Harness adapter interface
src/background/hermes.ts   profiles→bots, Bot Chat sessions, controller lane
src/background/openai.ts   generic chat/completions harness + page_action loop
src/background/rooms.ts    extension-local room relay engine
src/background/bridge.ts   SW→tab action dispatch, per-tab mutation queue,
                           screenshot/tab ops at SW level
src/background/sw.ts       BotRoomService orchestrator
src/content/*              stage, mascot3d (three.js), panel, actions, styles
```
