# bot-context

Bot Mode context and **activity approvals**, as an installable Hermes plugin.

The Bot Mode context panel can already show what one attached bot is doing, and
answer the clarify/approval card in front of it. What it cannot do is describe a
bot the client is *not* attached to, or answer that bot's approval after the
panel lost its place. `bot-context` moves that capability to the host, where the
approval actually waits:

* `pre_approval_request` / `post_approval_response` index every approval a bot
  raises, with its resolved context — profile, Bot Mode title, session, hosted
  room — so it can be found by id instead of by attachment.
* `bot_context_*` tools and `/bot-context` resolve that context, list what is
  waiting, answer it, and read the decision history.
* Answering calls the host's own `resolve_gateway_approval`, so the blocked bot
  wakes exactly as if the user had clicked the card. Nothing here can approve an
  action by writing to a database or by faking a tool result.

## Install and enable

`bot-context` is a normal directory plugin. It does not need a patched Hermes
core, a particular branch, or a local checkout: the only requirement is the
stock plugin API (manifest v2, `register_tool`, `register_hook`,
`register_command`, and the public approval hooks).

**Bundled install** (the copy that ships with Hermes):

```bash
hermes plugins enable bot-context          # add to plugins.enabled
hermes plugins disable bot-context         # back out, no residue
```

**Any stock install** — copy the one directory:

```bash
mkdir -p ~/.hermes/plugins
cp -R plugins/bot-context ~/.hermes/plugins/
hermes plugins enable bot-context
```

Or by config:

```yaml
plugins:
  enabled:
    - bot-context
```

The plugin stores decisions under `<hermes home>/plugin-data/bot-context/`
through the public `plugin_data_dir()` helper. It never writes into
`~/.hermes/plugins/bot-context/`, so updating or removing the plugin directory
cannot destroy history.

### What works on stock Nous main

Stock Hermes does **not** put `request_id` on the `pre_approval_request` payload.
The plugin reads the live gateway queue (`list_gateway_approvals`) for the
approval that is actually waiting and uses its host id. That is also why an
approval raised before the plugin loaded is not retroactively indexed: there is
no public "list every prompt" surface, and guessing one would risk answering the
wrong gate.

An interactive CLI prompt has no cross-process queue. It is still listed (with a
`local:` id and `answerable: false`) so the context is visible, but the plugin
refuses to pretend it can answer it; type the answer in that terminal.

| Host capability | If missing |
|---|---|
| `tools.approval.list_gateway_approvals` | Gateway approvals are indexed only when the host supplies `request_id`; CLI rows still work. |
| `tools.approval.resolve_gateway_approval` | `bot_context_respond` returns `host_unavailable`; nothing is claimed. |
| `tui_gateway.session_registry` | Profile falls back to `HERMES_PROFILE`/home; the miss is reported in `degraded`. |
| `tui_gateway.server.register_method` | The optional `bot_context.*` RPC surface is absent; tools, hooks and `/bot-context` still work. |
| `hermes_yaml` / `profile.yaml` | Bot title stays empty; presentation only. |

Verify:

```bash
hermes plugins list            # bot-context ... enabled
hermes bot-context status      # settings, store path, pending count
```

## Tools

| Tool | What it answers |
|---|---|
| `bot_context_resolve` | Context for a tracked approval id, an explicit session, or (with no arguments) the calling session. Returns every field it could *not* resolve instead of guessing one. |
| `bot_context_activities` | What bots are blocked on: profile, title, session, room, the choices the host will accept, and a `legacy` projection in the Desktop group-chat wire shape. Pass `session_key` or `session_id` to list one session only; the response also carries a `sessions` summary. |
| `bot_context_respond` | Answer one activity — `once`, `session`, `always` or `deny` — through the host queue. |
| `bot_context_history` | Settled decisions, newest first, one row per activity. |
| `bot_context_subagents` | Subagents delegated inside one parent session: status, summary, duration, role and their tool-call steps. |

In-session slash command:

```
/bot-context                      # pending activity
/bot-context approve <request-id> # answer with 'once'
/bot-context deny <request-id> [reason]
/bot-context history
```

`reason` is relayed to the blocked bot verbatim, so it can adapt instead of only
hearing "denied".

## Session isolation

The desktop rail also has a **Bot** tab: the bot's Computer/Screen lives there
with its stopped/live state and the same take-over affordance as before, instead
of a black placeholder pinned above the activity feed. Subagents are listed
under the selected session with their goal, status, summary and expandable
tool steps.


An activity belongs to exactly one session. `bot_context_activities` accepts
`session_key` or `session_id`; `bot_context_history` accepts the same filters;
and `bot_context.sessions` returns one row per session with pending counts. The
Desktop Bot Mode pane selects one session and renders only its rows, so
switching sessions switches the whole feed. A bot that is blocked in two
sessions produces two rows, not one merged row.

The runtime session id is filled from `tui_gateway.session_registry` when the
hook only carries a session key, which is what lets a pane address a waiting
approval by the id its live events use. If that lookup is unavailable, the id is
left empty and reported in `degraded`; the session key still isolates the row.

## Configuration

`plugins.entries.bot-context.settings` in `config.yaml`. Every value is optional;
the defaults are the safe ones.

| Key | Default | Meaning |
|---|---|---|
| `answer_scope` | `user` | Who may answer. `user` = the operator's own launch profile only; `same_profile` = also any session inside the target bot's profile (unattended automation); `any` = any session in the process (multi-bot orchestration, no self-approval guard). Unknown values fall back to `user`. |
| `allow_permanent_choices` | `false` | Offer `session` / `always`. Off by default so a plugin-driven answer cannot add a permanent allowlist entry unless you asked for that. |
| `max_pending` | `200` | Hard cap on tracked pending activities; the oldest is dropped and logged past it. |
| `retention_days` | `3` | Age at which an unanswered activity settles as expired instead of listed. |
| `approval_ttl_seconds` | `3600` | Sweep window for "still pending" listings. The host's `approvals.timeout` remains the authority on whether the prompt is alive. |

```yaml
plugins:
  enabled: [bot-context]
  entries:
    bot-context:
      settings:
        answer_scope: same_profile
        allow_permanent_choices: false
```

## Failure behaviour

Every tool returns `{ok: false, code, error}` and never raises into the turn.
The codes are stable; branch on them, not on message text.

| Code | When | What happened to the prompt |
|---|---|---|
| `unknown_activity` | No tracked activity with that id | Untouched |
| `already_settled` | It was already answered or expired | Untouched — no second approval |
| `missing_context` | No session key, so no queue to address | Untouched; answer the card in the bot's session |
| `insufficient_permission` | The caller is a bot, or a bot answering its own gate | Untouched, still pending |
| `invalid_choice` | The host (or `allow_permanent_choices`) will not accept that decision | Untouched |
| `not_pending` | The host queue no longer holds that id: answered elsewhere, withdrawn, expired | Nothing claimed; ledger records `resolved_elsewhere` |
| `local_only` | The prompt belongs to an interactive CLI session, not a gateway queue | Untouched; answer it in that terminal |
| `resolution_failed` | The host resolver raised | Untouched |
| `host_unavailable` | This process has no gateway approval queue | Untouched |

Malformed payloads are refused per field (`request_id`, `command`, `pattern_keys`,
empty preview) and counted in `bot_context_activities(...).store.dropped`; a hook
that cannot parse its payload never blocks the host's prompt. Oversized previews
are truncated, not refused.

## Platform constraints

These are real limits, not TODOs "later":

1. **Approvals are process-local.** The waiting prompt lives in a Python queue in
   the Hermes process that is blocking. A plugin in another process — a CLI
   `hermes bot-context` run, a second gateway, a bot in a different profile served
   by a different gateway — cannot see or answer it. `hermes bot-context pending`
   therefore reports *this* process's index, and answering from the CLI is not
   offered; use `/bot-context` inside a session, the `bot_context_respond` tool,
   or the `approval.respond` RPC from a client attached to that gateway.
2. **The index starts when the plugin loads.** Prompts raised before enablement
   are not retroactively discovered: enumerating every live queue is not a public
   surface (`tools.approval` exposes the resolver and a per-session listing, not a
   global one). Answering still works for tracked ids only.
3. **Room membership is not verified.** The plugin reads the room binding out of
   `room:<task>:<generation>` session keys; it does not consult the hosted-room
   database to confirm the caller is a member. `answer_scope` is the gate.
4. **Bot titles come from `profile.yaml`.** A profile with no Bot Mode title is
   labelled by its profile name. Presentation only — never used for routing.
5. **The CLI verb exists only on local (non-isolated) installs.** Under
   `plugins.isolation: host` the host skips `ctx.register_cli_command()`, so
   `hermes bot-context …` is absent while the tools and `/bot-context` still
   work. Nothing that answers an approval depends on the CLI.

### Host seams

`hermes plugins validate` reports three private-core imports (a catalog warning,
not a failure). Each is behind `try/except` and degrades instead of raising:

| Seam | Why | If it moves |
|---|---|---|
| `tools.approval.resolve_gateway_approval` | The only public way to unblock a waiting bot (it is on the plugin public-surface allowlist) | Answering stops; `host_unavailable` |
| `tools.approval.list_gateway_approvals` | Read the host's `allow_session` / `allow_permanent` flags so an unofferable `always` is never sent | Choices narrow to `once`/`deny`, still safe |
| `tui_gateway.session_registry._find_live_session_by_key` | Map a session key to its profile home — the address→bot seam the gateway itself uses | Profile falls back to `HERMES_PROFILE`/home, reported in `degraded` |

`hermes_yaml` (profile metadata) is in the same warning set: a miss leaves the
title empty, which costs a label, not an answer.

## Desktop RPC (optional)

When the gateway server is already imported, `register()` installs five
read/answer methods through the public `register_method` seam. They are what the
Bot Mode pane uses; they are scoped to one session and never return another
session's rows:

| Method | Result |
|---|---|
| `bot_context.sessions` | One row per session with pending activity, profile, bot label and counts |
| `bot_context.activities` | Pending (or `status: settled/all`) rows; filter with `session_key`, `session_id`, `profile`, `room` |
| `bot_context.history` | Settled decisions, newest first |
| `bot_context.resolve` | Resolved context for an id or session |
| `bot_context.respond` | Answer through the host queue, same codes as the tool |

## Backward compatibility

* No core file changed. The hooks the plugin listens to already existed; with the
  plugin disabled there are no callbacks, no tools and no slash command
  (`registry.get_entry("bot_context_respond") is None`).
* The Desktop panel and `approval.respond` are untouched. `activity["legacy"]`
  matches `GroupPendingApproval` in
  `apps/desktop/src/plugins/hermes-bots/group-turns.ts` (`request_id`, `kind`,
  `command`, `description`, `choices`), so a UI built against that contract can
  render plugin activity without a translation layer.
* Existing callers of `tools.approval.resolve_gateway_approval` keep their
  semantics (FIFO when no `request_id`, `request_id` when given). The plugin only
  ever calls it with an explicit `request_id`, so it can never consume another
  prompt's answer.

## Tests

```bash
python -m pytest tests/plugins/test_bot_context_plugin.py -q
```

The suite covers registration and discovery gating, context precedence and
degradation, an end-to-end answer against a real `_ApprovalEntry` in the host
queue, permission refusals, every failure code, restart-safe history, and the
compatibility guarantees above. It also runs the four portability cases: a
clean user install, an existing `config.yaml`, missing optional settings, and
the same plugin loaded with an unmodified Nous main checkout on `PYTHONPATH`
(set `HERMES_STOCK_CHECKOUT` to point at it; it defaults to
`~/Code/hermes-nous-main` and skips when absent).
