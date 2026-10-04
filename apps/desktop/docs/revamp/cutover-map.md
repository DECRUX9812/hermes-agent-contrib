# Cutover conflict map — fork-added backend surface vs the canonical gateway

Wave 0 item 0.4. This map enumerates **every backend method/route the fork added
since the last upstream sync** and says where each one lands under the "one
gateway owns every local session" cutover
([NousResearch/hermes-agent#106742](https://github.com/NousResearch/hermes-agent/pull/106742),
+81k lines, awaiting maintainer merge).

Upstream authority references:

- The staged entry-point plan: <https://gist.github.com/unsupportedpastels/765f9d551ce88ee01630c18367763e75>
  (caller map → serve cutover → Desktop remote lifecycle → producer contracts →
  remove alternate host; acceptance suite items 1–12).
- The stage-1 review handoff thread the merge is gated on:
  <https://github.com/NousResearch/hermes-agent/pull/106742#issuecomment-5657057905>
  (handler-level ledger; verified finding: serve still executes outside the
  canonical admission ledger, and the canonical ambiguous-ACK retry retains one
  admission/execution).
- Our own design rule, roadmap §5 (`agentic-desktop-roadmap.md`): **route through
  session/authority lookups, never process-local serve-owns-it state.**

## How the list was built

```
git remote add upstream https://git-manager.devin.ai/proxy/github.com/NousResearch/hermes-agent.git
git fetch upstream
git merge-base upstream/main HEAD        # d0288be5b3330d2442e3907185b8e9d0958297bb
```

Registered wire names were diffed between the merge-base and HEAD (the set of
`@…method("…")` / `register_method("…")` registrations in `tui_gateway/`, plus
`@router.` routes in `hermes_cli/web_routers/`), not just `git log` — upstream
merges interleave with ours, so name-set diff is the reliable enumeration.
**Result: 5 new JSON-RPC methods, 1 new server→client request, 8 new HTTP
routes, zero removals.** A follow-on table lists fork-modified (not new) surface
with cutover-relevant deltas.

### Mark legend

| mark | meaning |
|---|---|
| `cutover-blocked` | reads or writes process-local serve state (`_sessions`, `open_requests`, `_methods`, `_SESSION_TOKEN`) or performs admission outside the canonical ledger — **cannot survive the cutover unchanged** |
| `cutover-neutral` | a resource/projection/device-local operation that keeps working once its calls are routed to the owning host — no authority-state dependency |
| `retire-post-cutover` | exists only because the pooled model exists; the canonical model makes it redundant |

## New JSON-RPC methods (`tui_gateway/`)

| method | file | purpose | renderer call sites | canonical destination | mark |
|---|---|---|---|---|---|
| `session.ask` | `methods_session_ask.py` | Read-only utility-model Q&A over a session transcript ("ask this session a question" sidebar dialog). Reads the **live in-memory `session["history"]` via `_sessions.get(target)`** for running sessions, profile store otherwise; calls `agent.auxiliary_client.call_llm`. | `apps/desktop/src/store/session-ask.ts` (`requestGateway`), `app/chat/sidebar/session-ask-dialog.tsx`, `session-actions-menu.tsx`, `store/session-states.ts` | The transcript belongs to the authority — becomes a **session read-model projection + utility call on the gateway** (`authority.session.ask` equivalent). The `session["history"]` fast path is the conflict: under #106742 the live transcript is owned by the canonical session, not this process's `_sessions` dict. | **cutover-blocked** (live path); the profile-store fallback is neutral |
| `bots_mailbox.list` | `methods_bot_mailbox.py` | Lists the install-wide shared bot mailbox (`tools.bot_mailbox.list_notes` under `_hermes_root(_default_home())`). | `plugins/hermes-bots/mailbox.ts` (`host.requestProfile` fan-out across connections), `mailbox-parts.tsx` | A file-store **resource read**, not session authority. Canonical model: whichever backend hosts the request answers from the shared install mailbox; no ledger involvement. | **cutover-neutral** |
| `bots_mailbox.send` | `methods_bot_mailbox.py` | Files a mailbox note AND delivers its text to the target bot's canonical Bot Chat — local targets go through an **in-process `_methods["bot_relay.deliver"]` call → `prompt.submit` admission**; remote targets enqueue a relay envelope. | `plugins/hermes-bots/mailbox.ts` | The filing half is a resource write; the delivery half is a **prompt admission and must enter the canonical admission ledger** (the flagged comment's core complaint: `prompt.submit` reached through in-process dispatch is exactly the path that bypasses admission). Cross-backend fan-out also assumes peers are reachable pooled serves; under one gateway the mailbox owner is contacted through the authority, not a per-connection `requestProfile` fan-out. | **cutover-blocked** |
| `bots_mailbox.update` | `methods_bot_mailbox.py` | Flips a note's status + best-effort notifies the live Bot Chat via `find_canonical_live_owner`/`deliver_to_live_owner` — a **process-local live-owner lookup**. | `plugins/hermes-bots/mailbox.ts` | Status write is a resource mutation (neutral); the live-owner notify assumes the owner is a session in this process's `_sessions` — under canonical ownership the notify must route through the authority's session lookup. | **cutover-blocked** (notify path only) |
| `delegation.reports` | `methods_delegation_reports.py` | Durable read of settled delegations for a session (`tools.async_delegation.settled_delegations_for_session`) → report cards; optional cached utility-model summary (`result_json.report_summary`, detached-thread fill). | `apps/desktop/src/store/delegation-reports.ts`, `store/agent-review.ts` | A **durable read projection** — the delegation store is on-disk state, not live session authority. Upstream disposition for read projections: "read projections, not proof of execution ownership". Survives as-is; only the session-id → authority resolution wrapper changes. | **cutover-neutral** |

## New server→client request

| request | file | purpose | renderer handler | canonical destination | mark |
|---|---|---|---|---|---|
| `preview.verify` (`srq-*`, `server_request("preview.verify", …)` in `contracts/server_requests.py`) | emitted from `agent_callbacks.py::verify_preview_callback` (was a local callback) | Asks the owning desktop to run a JS snippet against the in-app browser preview and return the observation. | `app/session/hooks/use-message-stream/gateway-event/server-requests.ts` (~line 497), `store/preview-verify.ts`, `app/chat/composer/status-stack/verify-row.tsx`, `lib/preview-verify.ts` | Upstream capability-map disposition is explicit: **"device work remains client-local; response correlation depends on legacy pending-request registry"** — the verify itself stays on the desktop, but the `srq` correlation must ride the canonical request fan-out (viewer-scoped, authority-tracked) instead of the serve-local `_open` registry. | **cutover-blocked** (correlation path only; the device work is neutral) |

## New HTTP routes (`hermes_cli/web_routers/`)

| route | file | purpose | renderer call sites | canonical destination | mark |
|---|---|---|---|---|---|
| `GET /mobile` | `web_routers/mobile.py` | Static HTML shell for the mobile companion (roadmap #45). | `app/webhooks/mobile-companion.tsx` builds `${base}/mobile`; `api/mobile.ts` | Static asset — any host can serve it; under the plan's entry-point staging it moves to the canonical gateway's own HTTP surface. | **cutover-neutral** |
| `POST /api/mobile/pairing` | `web_routers/mobile.py` | Mints a short-lived numeric pairing code (authed; refuses on OAuth `auth_required`). | `apps/desktop/src/api/mobile.ts` | Pairing is **entry-point authentication** — acceptance items 8–9 put token issuance on the canonical authority; a code exchanged for `web_server._SESSION_TOKEN` (a serve-local credential) cannot outlive the serve it names. | **cutover-blocked** |
| `POST /api/mobile/pair` | `web_routers/mobile.py` | Public endpoint exchanging the code for `web_server._SESSION_TOKEN` (rate-limited). | none in renderer (the phone browser calls it) | Same as above: mints a serve-scoped bearer; becomes a gateway-level session/token mint. | **cutover-blocked** |
| `GET /api/mobile/overview` | `web_routers/mobile.py` | Phone-facing overview: reads **`gateway._sessions` + `server_requests.open_requests` in-process**. | none in renderer | Process-local session registry — under canonical ownership this is an authority read model; the overview must come from the canonical session index, not one serve's `_sessions`. | **cutover-blocked** |
| `POST /api/mobile/respond` | `web_routers/mobile.py` | Answers an open server→client request via `_gateway_rpc("request.answer", …)` — an **in-process `rpc_dispatch.handle_request` call, never `dispatch`/`bind_transport`**. | none in renderer | **Shared control** (acceptance item 5): answering a pending approval/clarify from another surface must go through the canonical request ledger — which is also where "answered elsewhere" cancellation (`request.cancel`) originates. | **cutover-blocked** |
| `POST /api/mobile/reply` | `web_routers/mobile.py` | Submits a prompt via `_gateway_rpc("prompt.submit", …)` — a real admission through in-process dispatch. | none in renderer | A `prompt.submit` admission: canonical ledger or nothing — this is precisely the "serve still executes outside the canonical admission ledger" gap flagged in the review handoff. | **cutover-blocked** |
| `POST /api/git/worktree/ensure` | `web_routers/git.py` | Recreate a session's worktree dir (roadmap #47 session-worktree restore). | `apps/desktop/src/lib/desktop-git.ts` (`gitPost('worktree/ensure')`) | Host-local git op on explicit paths — no session-authority read. Caveat: under one gateway the route must be answered by the **host that owns the worktree** (gateway → owning-host routing), since the desktop will no longer be dialed into a per-host pooled serve. | **cutover-neutral** (re-route, keep semantics) |
| `POST /api/git/worktree/merge` | `web_routers/git.py` | Merge a session worktree back (#47). | `apps/desktop/src/lib/desktop-git.ts` (`gitPost('worktree/merge')`) | Same as `ensure`. | **cutover-neutral** (re-route, keep semantics) |

## Modified (not new) surface with cutover-relevant deltas

These were touched since the merge-base without adding wire names; they ride
existing methods/events but matter to the cutover because they extend the
process-local assumptions or the request registry.

| file | delta | cutover note |
|---|---|---|
| `tui_gateway/server.py` | `_session_skills` per-session memo; `_session_show_reasoning`; expanded `_tool_lifecycle_required_for_ui` (`clarify`, `manage_connections`, `setup_mcp`, `image_generate`, `manage_catalog`, `delegate_task`); `_submit_row_target_key` model-switch marker; `_headless_server_log_frame` redaction | More process-local per-session state in `_sessions`-adjacent maps — all of it must move behind session/authority lookups (roadmap §5 rule). `delegate_task` in the required-for-UI set intersects the approval/answer fan-out. |
| `tui_gateway/session_auto_continue.py`, `session_workdir.py`, `tool_progress.py`, `agent_callbacks.py` | Lineage fixes: `_submit_row_owner_key`, `resolve_active_row_id`, `show_reasoning` gating, `verify_preview_callback` → `_ask("preview.verify")` | Row-identity/owner-key bookkeeping assumes in-process admission order; canonical replay/ack must preserve the same owner-key derivation or reconcile on epoch change. |
| `tui_gateway/contracts/sessions.py` | `SessionAskParams`/`SessionAskResult`/`SessionAskExchange` | Wire contract for `session.ask` (see above). |
| `tui_gateway/contracts/common.py` | `StoredSessionRow.continuation_kind` | Durable field — survives; canonical store keeps it. |
| `tui_gateway/contracts/tools_commands.py` | checkpoint `sid`/`turn`/`user_row_id` fields | Durable checkpoint metadata — neutral. |
| `tui_gateway/contracts/server_requests.py` | `server_request("preview.verify")` registration | See the request table. |
| `tui_gateway/contracts/delegation_reports.py` | new contract module for `delegation.reports` | Wire contract only. |
| `tui_gateway/methods_bot_relay.py`, `methods_tools.py`, `methods_projects.py` | +28/+18/+3-line deltas | Modified upstream handlers — reviewed; no new authority assumption beyond what upstream already carries. |
| `hermes_cli/web_routers/config_env.py` | `provider_profiles`/`provider_primary` fields on the env catalog | Config read — neutral. |
| `hermes_cli/web_routers/messaging.py` | `identity` field on platform payload | Neutral. |
| `hermes_cli/web_routers/sessions.py` | hidden-row exclusion in session search | Read-side filter on the store projection — neutral. |

## The systemic conflict in one paragraph

Everything marked `cutover-blocked` shares one root cause: it treats
**this `serve` process** as the place where sessions live (`_sessions`,
`open_requests`, `_methods` in-process dispatch, `_SESSION_TOKEN` issuance).
Under #106742 the canonical gateway owns sessions, admissions, and
server→client request correlation; a serve is at most a compute host. Each
blocked row above is a place where fork code must be re-pointed at the
authority (session lookup / admission ledger / shared-control route) or the
feature silently stops working the day the pooled backend stops owning the
session — which is exactly the "offer, don't hijack" failure family the 0.5
dual-topology fixtures exercise from the client side.

Nothing enumerated here is `retire-post-cutover` outright: every addition is a
feature with a canonical home — the work is re-pointing, not deleting.
