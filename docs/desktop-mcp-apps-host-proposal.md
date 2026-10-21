# Desktop as an MCP Apps host — OpenAI MCP Extensions parity and beyond

Status: slice 1 shipped on the fork (inline apps) · Sep 30 2026 · owner: desktop

## Why

On Sep 30 2026 OpenAI shipped **MCP Extensions**
([spec](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)): a plugin's MCP
server can put an interactive UI into ChatGPT's sidebar, a conversation side panel, the file
viewer, settings, the composer, and forms. None of it is proprietary plumbing. Every extension
is `_meta` / capability sugar layered on two open standards:

- **MCP** — tools, resources, elicitation (Hermes already speaks it: `tools/mcp_tool*.py`).
- **MCP Apps** ([ext-apps](https://github.com/modelcontextprotocol/ext-apps)) — a tool names a
  `ui://` HTML resource (`_meta.ui.resourceUri`, `text/html;profile=mcp-app`). The host renders
  it in a sandboxed iframe and talks JSON-RPC over `postMessage` (`ui/initialize`, `tools/call`,
  `resources/read`, `ui/message`, `ui/update-model-context`, `ui/notifications/*`).

So the lever is: **make Hermes Desktop a complete MCP Apps host that implements OpenAI's
extensions.** Then every plugin built for ChatGPT runs in Hermes unchanged. On top of that we
add what ChatGPT can't: local-first plugins, any website as an app, picture-in-picture, bots, and
profiles. That is how we beat "ChatGPT plugins" and Cursor/DeepSeek-style extension panels
without inventing yet another manifest.

This is not the "universal extension system" `apps/desktop/AGENTS.md` warns against. It
implements a published protocol with thousands of real consumers, and it mounts into seams that
already exist (`PANES_AREA`, `FILE_VIEWERS_AREA`, `SIDEBAR_NAV_AREA`, `ROUTES_AREA`,
`COMPOSER_AREAS`, `hermes://`). It adds no core model tool.

## What exists today (and the gap)

| OpenAI extension | Hermes today | Gap |
|---|---|---|
| **MCP Apps rendering** (inline tool UI) | Sandboxed `allow-scripts` iframe for artifacts (`chat/right-rail/preview-artifact.tsx`); MCP client keeps raw `Tool` objects incl. `_meta` (`server._tools`) | No `ui://` fetch, no host↔app JSON-RPC bridge, tool-result `_meta` stripped (`mcp_tool_content.py`) |
| **Sidebar apps** (`entrypoints: [{type:"global"}]`) | `SIDEBAR_NAV_AREA` + `ROUTES_AREA`, icon rail (#119) | No entrypoint discovery |
| **Conversation panels** (`type:"thread"`) | `PANES_AREA`, right rail, pane-shell tree | Same |
| **File viewers/editors** (`type:"file"`, `openai/resources/write`) | `FILE_VIEWERS_AREA`, file tree (#119) | No host-resource broker (opaque URI, etag writes) |
| **Plugin settings** (`openai/settings` read/update tools) | Capabilities → MCP page; plugin `settings.ts` | No schema-rendered settings from MCP |
| **Display modes** (inline / fullscreen) | Panes can maximize; **floating HUD window** (`app/floating-hud.ts`) | Mode negotiation; **pip** (ChatGPT has none — we can) |
| **Deep links** (`{scheme}://plugins/{id}/app/{tool}?path=`) | `hermes://` handler in `electron/main.ts` (mcp/install, plugin/install, session/open) | `hermes://plugins/...` route + `hostContext["openai/deepLink"]` |
| **Model-app context** (`ui/update-model-context`) | Composer attachments | Per-app replaceable attachment slot |
| **Composer mentions** (`openai/extensions["mentions/search"]`) | `@` mentions for bots/teammates | Provider-driven mention items |
| **Rich forms** (`openai/elicitation/create`) | MCP elicitation → **accept/decline only** (`tools/approval_prompt.py::request_elicitation_consent`); `requestedSchema` ignored | Real form renderer |
| **Plugin onboarding** (`onboardingSkill`) | Skills system, `hermes://plugin/install` | Run the skill after install |
| **Open local file** (`openai/files/open`) | File tree + viewers | Bridge method |

## Architecture

```
MCP server ──(stdio/http)── tools/mcp_tool*.py ── tools/mcp_apps*.py (new siblings)
                                                        │  app registry · ui:// fetch · app tool calls
                                                        │  host-resource broker · settings · mentions
                                   tui_gateway/methods_mcp_apps.py  (mcp_apps.* RPC)
                                                        │
Desktop renderer ── src/lib/mcp-apps/  McpAppHost  (bridge, CSP, lifecycle)
   mounts into:  transcript inline · ROUTES/SIDEBAR_NAV (global) · PANES (thread)
                 FILE_VIEWERS (file) · settings page · composer (context, mentions) · HUD (pip)
```

### Backend (`tools/mcp_apps*.py` + `tui_gateway/methods_mcp_apps.py`)

Siblings of the MCP facade, per the facade + siblings layout. No new model tool.

- `mcp_apps.list` — read `server._tools` per connected server and return every tool whose
  `_meta.ui.resourceUri` is set: `{server, tool, title, icons, entrypoints, visibility,
  resourceUri}`. Title/icon fallback order follows the spec (tool `title` → `annotations.title`
  → `name`; tool icon → server icon → generic).
- `mcp_apps.read_ui` — `resources/read` of a `ui://` URI. Returns html, `_meta.ui.csp`,
  `_meta["openai/ui"]` display modes. Cached per (server, uri, list epoch).
- `mcp_apps.call` — a tool call **originated by the app, not the model**. It is allowed only for
  tools on the same server whose `_meta.ui.visibility` includes `"app"`. Model-only tools are
  refused. Results go back to the app and are never appended to the transcript.
- `mcp_apps.resource.{read,subscribe,write}` — the host-resource broker for file entrypoints.
  It mints opaque `host-resource://<id>` URIs mapped to paths server-side. It never hands a raw
  path to the iframe. Writes use `openai/resources/write` semantics with an etag
  (`saved | conflict | too-large`) and route through the existing file-write path. Tool calls
  from a file-entrypoint app get `_meta["openai/resource"].path` stamped on the way to the server.
- `mcp_apps.settings.{read,update}` — proxy the server's advertised `openai/settings`
  `readTool` / `updateTool`. The server persists the values.
- `mcp_apps.mentions.search` — call the server's `mentions/search` tool; return `ResourceLink`s.
- **Rich forms:** the elicitation handler stops collapsing to consent. It forwards
  `requestedSchema` (plus `x-openai-input`, `x-openai-suggestions`, `x-openai-thumbnail`,
  option `description`, `pattern`) to the desktop as a form request. The client advertises
  `extensions["openai/elicitation"].form` on `initialize`. A schema containing unsupported
  inputs is reported unsupported, never half-rendered (spec rule). CLI/TUI keep the existing
  consent fallback.
- **Tool results with UI:** `mcp_tool_content.py` keeps a *host-only* `ui` envelope
  (`resourceUri`, `structuredContent`, tool input) on the tool-progress event so the desktop can
  mount the app inline. `_meta` stays out of model input, as today.

Profile scope: every `mcp_apps.*` method binds the owning profile (`@_profile_scoped`), because
MCP servers are per profile. Two homes, A→B→A, is the E2E bar.

### Desktop (`src/lib/mcp-apps/`)

- **`McpAppHost`** — one component renders an app in every surface. It uses a double iframe:
  an outer `sandbox="allow-scripts"` proxy frame on its own origin, with the inner app document
  loaded via `srcdoc` under a CSP built from `_meta.ui.csp` (`connectDomains`,
  `resourceDomains`, default deny). It runs the JSON-RPC bridge: `ui/initialize` →
  `hostCapabilities` (advertise `experimental: {"openai/resource", "openai/modelContext",
  "openai/message", "openai/files"}` as each lands), `hostContext` (theme, locale, displayMode,
  `openai/deepLink`, `openai/modelContext`), then `ui/notifications/tool-input` /
  `tool-result` / `host-context-changed` / `size-changed` / `teardown`. The bridge is a pure,
  table-driven `method → handler` map, so each handler is unit-testable without an iframe.
- **Surfaces** (each is a contribution into an existing area):
  - *Inline*: a model-invoked tool with a `ui` envelope renders in the transcript tool row
    (`TRANSCRIPT_DIRECTIVE_AREA` / tool-row slot), inline by default.
  - *Global*: one `SIDEBAR_NAV_AREA` item + `ROUTES_AREA` page per global entrypoint. It opens
    fullscreen with a composer, and the thread it targets is the page's session (spec: desktop
    global apps get a composer + thread layout).
  - *Thread*: a `PANES_AREA` pane, one instance per session (keyed by session id), offered
    from the pane launcher and the chat header.
  - *File*: a `FILE_VIEWERS_AREA` contribution per advertised extension. It outranks the
    default viewer, and the user can pick "Open with…".
  - *Settings*: an "App settings" section on the Capabilities → MCP server page, rendered
    natively from `SettingsReadResult` (boolean/enum/string/number + tool buttons; an MCP App
    tool button opens the app in a modal).
  - *Deep links*: `hermes://plugins/{server}/app/{tool}?path=` (same shape as ChatGPT's
    `codex://`) resolves to the global route and sets `hostContext["openai/deepLink"]`.
  - *Composer*: `ui/update-model-context` fills one removable attachment group per app instance
    (replace, not append; `audience:["assistant"]` blocks hidden). `ui/message` with `target:
    "new"` opens a new session. Mention search plugs into the existing `@` picker as an
    extra provider section.
  - *Forms*: `ElicitationForm` renders the schema, including resource pickers
    (explicit/implicit), suggestions, and thumbnails.
- **Display modes**: `inline | fullscreen | pip`. **pip** docks the app into the floating HUD
  window. ChatGPT doesn't support pip; we do, and we honor `preferredDisplayMode` /
  `availableDisplayModes`.

### "Any website is a plugin" — Web Apps

The user pastes a URL (or the agent proposes one) and it becomes an app with the same
entrypoint model: a sidebar item, a thread panel, or pip. It doesn't need a manifest or an MCP
server.

- It renders in a `<webview>` with **its own persistent partition per app**
  (`persist:hermes-webapp-<slug>`; no `:` in the slug — see the Windows partition invariant),
  so logins persist and apps can't read each other's cookies. It reuses the preview pane's
  guest-safety bridge exactly: no `allowpopups`, trusted-click-only external links, http(s)
  only (`apps/desktop/AGENTS.md` § Guest content). The guest preload keys on the partition
  **prefix**, and a test pins it.
- **Context bridge, user-driven only:** "Add selection / page to chat" puts the text, URL, and
  title into the composer as a removable attachment (the same slot model-context uses). No
  background scraping.
- **Agent reach:** the agent can drive a web app only through the existing browser tooling,
  scoped to that partition, and only after the per-app consent the browser tool already asks
  for. That keeps it a session-scoped surface capability (root AGENTS.md § Surface capability
  is a property of the SESSION), not a new core tool.
- Stored in `config.yaml` under `desktop.web_apps: [{name, url, icon, entrypoints}]`. It's
  config, not a secret. The source of truth is the backend profile, so the list follows the
  profile to every client.

## Invariants (review lens)

- **Prompt cache:** nothing here touches the system prompt or the tool list. App-only tools
  (`visibility: ["app"]`) are filtered out of the model's tool schema, which also fixes today's
  over-exposure. Model context rides the *next user message* as attachments.
- **Security:** every app is untrusted JS. That means a sandboxed iframe with no
  `allow-same-origin` on the app document, CSP default-deny, no raw paths, and no OS navigation
  without a trusted gesture. App tool calls are restricted to the same server and to tools
  marked `app`. Destructive tools still go through the existing approval gate
  (`tools/approval.py`). Web apps are isolated per partition.
- **Remote topologies:** apps render on the client, and servers run on the backend. Everything
  crosses the gateway RPC, so it works for local, SSH, URL + token, and Cloud backends. Nothing
  is gated on `HERMES_DESKTOP=1`.
- **No new `HERMES_*` env, no new core tool, no manifest of our own.**

## Delivery plan (PR slices)

Each slice ships alone, behind nothing, with 1–2 invariant tests plus an E2E against the
reference server (`openai/mcp-extensions/plugins/bits-and-bolts`, run as a local MCP server in
tests).

1. **Inline MCP Apps.** `mcp_apps.list/read_ui/call`, the `ui` envelope on tool events, and
   `McpAppHost` inline in the transcript. App-only tools are dropped from the model schema.
   *Proof:* bits-and-bolts renders, its button calls an app tool, and the model never sees
   `visibility:["app"]` tools.
2. **Entrypoints.** Global (sidebar + route), thread (pane), and deep links
   (`hermes://plugins/...`, `openai/deepLink`).
3. **Model context + messages.** Attachment slot, `ui/update-model-context` replace semantics,
   `host-context-changed` on removal, and `ui/message` target new/active.
4. **Rich forms.** Schema forms for elicitation (+ `openai/elicitation` capability), resource
   picker, suggestions, and thumbnails. This replaces the accept/decline-only consent on
   desktop.
5. **File entrypoints.** The host-resource broker (read / subscribe / etag write),
   `FILE_VIEWERS_AREA` wiring, `openai/files/open`, and the resource path stamping.
6. **Settings + onboarding.** Native settings from `openai/settings`, plus running
   `onboardingSkill` after install.
7. **Composer mentions.** The `mentions/search` provider in the `@` picker.
8. **Web Apps.** Add-by-URL, per-app partitions, the context bridge, and pip for any app.
9. **Catalog.** `plugin-catalog/` entries can declare that they ship an MCP App; the
   Capabilities catalog shows a preview and one-click install (existing `hermes://mcp/install`).

**Slice 1 status (shipped):** `tools/mcp_apps.py` (registry, `ui://` reads, app calls with the
visibility and trust gates, app-only tools out of the model schema), `mcp_apps.*` RPC, the
`mcp_app` descriptor persisted on tool results, and the Desktop's sandboxed inline frame
(`components/assistant-ui/tool/mcp-app.tsx`, bridge + CSP in `src/lib/mcp-apps/`). Proven live
against a stdio server built on the SDK's `Apps` extension, and in Chromium: the handshake,
`tools/call` through the host, a blocked parent reach and a CSP-refused undeclared script.

Slices 1–3 are the minimum to call it "ChatGPT plugins work in Hermes". Slice 8 is the
headline feature that ChatGPT can't match.

## Open questions

- Should the proxy frame be a real origin (`hermes-app://` custom protocol, like the spec's
  recommended sandbox proxy) or `srcdoc` inside the existing sandboxed frame? A custom protocol
  gives each app a stable origin for `localStorage`; `srcdoc` is simpler. Recommendation: custom
  protocol, so apps keep state.
- Upstream: this is generic host infrastructure, not a vendor integration, so it fits the core
  rubric. Propose it to NousResearch/hermes-agent as slices after slice 1 proves it on the fork.

## Artifacts across venues (design input, Sep 30 2026)

From the Bot Mode UX discussion (Suzu) and the "canvas" theory account. These refine the
slices above rather than add new ones.

- **One artifact, many renditions.** An artifact's *content* is the same on every venue; only
  its *display* changes. This is the canvas account's moment/rendition split: renditions share
  truth, not pixels. In MCP Apps terms the tool result (`structuredContent`) is the moment, and
  each host surface renders it for its venue. Desktop inline or panel, a phone chat as text or
  image, and a future glanceable screen all read the same result. `hostContext.platform` /
  `displayMode` tell the app which rendition it is drawing.
- **Venues are not one UI stretched.** Continuity means *hand-off*: the same agent, the same
  artifacts and the same conversation, reachable from whichever device is in hand. It does not
  mean the same interface everywhere. Squish-and-hide responsive layouts preserve pixels when
  they should preserve the subject. Each venue gets its own interface into the swarm.
- **Guarding against malformed artifacts: a pool plus a check.** Free-form generated UI breaks
  in venues it wasn't composed for. Two mechanisms:
  1. *A pool of pre-composed elements* the model picks from and fills (cards, tables, diffs,
     timelines, pickers), each with renditions per venue. This is the canvas account's
     "ratified idiom": compressed, cacheable, and recognizable over time. MCP Apps from servers
     and Hermes's own built-in elements live in the same pool.
  2. *A way for the model to check its composition*: schema lint first (constrained element
     trees can be linted where prose can't), then a render-and-inspect pass per target venue
     (headless render → screenshot → vision check) before the artifact is shown.
- **Fleet view.** No interface has cracked "what is my fleet doing". The target is a
  UniFi-style overview (one tile per bot or run → drill-down) built from the same artifacts, so
  a bot's status card is one element in the pool.
- **Attention and sovereignty** (canvas invariants): no unprompted element may create a duty to
  check. Venues are apertures the user opens and closes with no penalty, and ambient status is
  "weather-like, never notification-like". Every nudge we ship (e.g. #121's long-context card)
  is dismissible and suggestion-only for this reason.

Next slices that follow from this: the element pool (a small built-in catalog with per-venue
renditions, exposed through the same host bridge), and a composition check that renders an
artifact headlessly for a target venue before it is shown.
