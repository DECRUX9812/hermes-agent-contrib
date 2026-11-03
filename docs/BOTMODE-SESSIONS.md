# Bot Mode: sessions, activity, and approvals

This is the contract behind the Bot Mode activity tab and the `bot-context`
plugin. It exists so a session that is waiting, working, or finished can be read
without guessing which chat a row belongs to.

## The three objects

| Object | Identity | Owned by | Lifetime |
|---|---|---|---|
| **Session** | `(profile, session id)` | one bot chat / one compression tip | until the session is deleted |
| **Activity** | stable task id (`tool:<call id>` / `approval:<request id>`) | exactly one session | durable history row, or bounded live store for a running call |
| **Approval** | host `request_id` | exactly one activity in one session | pending until answered, expired, withdrawn or denied |

The desktop store is keyed by `` `${profile}::${sessionId}` ``. Reads go through
`activityFor(store, ref)`, never through the raw map, so a component cannot ask
for "everything". The host ledger applies the same rule: `pending()` and
`recent()` take `session_key`/`session_id`, and `sessions()` returns one row per
session rather than a flat feed.

## How a row is produced

```
stock gateway approval
  pre_approval_request (no request_id on stock Nous main)
    -> bot-context reads the live queue by command + pattern keys
    -> host request_id, allow_session / allow_permanent
    -> ledger row (profile, title, session, room, choices)
    -> Desktop: bot_context.activities(session_id=...)
    -> approval activity in that session's feed

tool call
  session.history (persisted rows)          live tool.start / tool.complete
    -> activityFromHistory                  -> activityFromToolEvent
    -> mergeSessionActivity (dedupe, out-of-order safe)
    -> chronological feed

decision
  card click / bot_context.respond / approval.respond
    -> answerGroupClarify when the prompt is mirrored in a room
    -> otherwise bot_context.respond, falling back to approval.respond
    -> decideInSession updates the approval row (and the linked task)
```

Two details matter:

1. **The hook payload is not the queue.** Stock Hermes does not put
   `request_id` on `pre_approval_request`. The plugin discovers it from
   `list_gateway_approvals(session_key)` using the same command + pattern-key
   pair the host uses to coalesce prompts. A fork-only patch is not required.
2. **A local CLI prompt has no queue.** It is recorded with a `local:` id and
   `answerable: false`, so it is visible but the plugin never claims it can
   answer it from another surface.

## States

| Status | Meaning | Terminal |
|---|---|---|
| `running` | the tool call started and has not completed | no |
| `waiting` / `pending` | an approval or clarify is blocking this task | no |
| `succeeded` | the host completed the call, or the approval was granted | yes |
| `failed` | the tool returned an error | yes |
| `cancelled` | the turn was stopped or the approval was denied | yes |
| `expired` | the prompt timed out / the session ended first | yes |

A settled update always beats a late `running` update for the same id. A later
`finishedAt` wins. An approval attached to either copy is never dropped. An
approval decision that arrives after its task finished still creates/updates the
approval row, so the decision is never invisible.

## UI hierarchy

- **Session selector** — one button per conversation, newest first, selected with
  `aria-selected`. There is deliberately no "all sessions" option.
- **Timeline** — day groups, newest first, 20 rows initially, **Load older**
  extends the same session only.
- **Row** — status glyph, task title, status badge, summary, time, duration.
  Click expands command/result detail.
- **Approval card** — inside the expanded row, with the host's choice set,
  disabled while answering, and a settled badge after the answer.
- **States** — skeleton while the session list or history loads; `PanelEmpty`
  for no sessions, no activity, and a session-list failure; inline retry for a
  history failure; disabled controls while an answer is in flight.
- **Explainer** — "How Bot Mode works" is one expandable line above the feed so
  the connection (one chat = one session) is visible without a docs detour.

## Performance

- Session history is fetched once per selected session (`staleTime: 5s`), not on
  every render.
- The live event bridge subscribes once per selected session and filters on the
  runtime session id before touching the store.
- Merges are `Map`-based and capped by the store; the feed slices only the
  requested page.
- Session switching never waits on the previous session: the store is already
  keyed, and the new history query is independent.
- The plugin RPC polls approvals every 15s; tool activity is event-driven.

## Tests

```bash
# desktop model + panel
cd apps/desktop
npx vitest run src/plugins/hermes-bots/session-activity.test.ts \
  src/plugins/hermes-bots/bot-context-panel.test.tsx

# host plugin, including a stock Nous main checkout
cd ../..
python -m pytest tests/plugins/test_bot_context_plugin.py -q
```

The desktop suite covers session isolation, chronological ordering, duplicate
and out-of-order updates, approval linkage after task completion, pagination,
empty/loading/error states, and switching sessions. The host suite covers a
clean user install, an existing config, missing optional settings, the stock
`request_id`-less payload, local CLI prompts, session filters, profile rebinding,
RPC installation, and execution against `HERMES_STOCK_CHECKOUT` (default
`~/Code/hermes-nous-main`).
