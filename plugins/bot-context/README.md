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

Bundled with the repo (so `hermes plugins list` already shows it), disabled by
default like every bundled plugin:

```bash
hermes plugins enable bot-context          # add to plugins.enabled
hermes plugins disable bot-context         # back out, no residue
```

Or by config:

```yaml
plugins:
  enabled:
    - bot-context
```

From a checkout or a fork it is a normal directory plugin — copy `plugins/bot-context/`
into `~/.hermes/plugins/bot-context/` (or `hermes plugins install owner/repo`) and
enable it there. Nothing outside the plugin directory is patched, so installing
and removing it is the enable/disable step.

Verify:

```bash
hermes plugins list            # bot-context ... enabled
hermes bot-context status      # settings, store path, pending count
```

## Tools

| Tool | What it answers |
|---|---|
| `bot_context_resolve` | Context for a tracked approval id, an explicit session, or (with no arguments) the calling session. Returns every field it could *not* resolve instead of guessing one. |
| `bot_context_activities` | What bots are blocked on: profile, title, session, room, the choices the host will accept, and a `legacy` projection in the Desktop group-chat wire shape. |
| `bot_context_respond` | Answer one activity — `once`, `session`, `always` or `deny` — through the host queue. |
| `bot_context_history` | Settled decisions, newest first, one row per activity. |

In-session slash command:

```
/bot-context                      # pending activity
/bot-context approve <request-id> # answer with 'once'
/bot-context deny <request-id> [reason]
/bot-context history
```

`reason` is relayed to the blocked bot verbatim, so it can adapt instead of only
hearing "denied".

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
compatibility guarantees above.
