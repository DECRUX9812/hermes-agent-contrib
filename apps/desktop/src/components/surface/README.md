# Surface contract

The pieces a surface is assembled from, so a fix lands once.

## Why this exists

Bot Mode drew the same room twice and each copy grew its own header and composer.
The copies diverged exactly where it hurt: one hid the destructive action behind
an overflow, the other kept a bare trash button beside Settings; one composer had
a placeholder, the other did not. That is not a Bot Mode problem — it is what
happens when two surfaces each decide how a surface should look. Every rule below
exists because its absence cost a bug that had to be fixed twice.

## What is here

| Component | Owns | Caller supplies |
|---|---|---|
| `SurfaceHeader` | back, picture, title, subtitle slot, one primary action, overflow whose items you pass | title/subtitle nodes, menu items, primary node |
| `SurfaceComposer` | submit interception, paste/drop hijack **only when files are present**, frame chrome from tokens | attachments slot, field row children, `onSubmit`, optional `onPaste`/`onDrop` |

Both are exported from the plugin SDK, so a plugin can use them without reaching
into app internals.

## Rules

1. **Destruction never sits next to a live control.** It goes in the overflow's
   last group. Both rooms learned this the expensive way.
2. **One primary action per header.** If you need two, one of them is not primary.
3. **`inline` vs stacked is a surface decision, not a frame decision.** The
   gateway composer puts attachments beside the field; the local one stacks them.
   Both are real; the frame expresses both rather than picking a winner.
4. **Token-only styling.** Literal colours fail `npm run lint:hex`; arbitrary type
   sizes are counted by the same tool and Bot Mode is at zero.
5. **The frame does not guess behaviour.** Send-enablement, upload state and
   drafts stay with the surface — a frame that inferred them would be the coupling
   this file exists to remove.

## Adding a component to the contract

Every new SDK export is invisible to the test suite until the mocks know about
it. Twice in one session that produced a wave of
`No "X" export is defined on the "@hermes/plugin-sdk" mock` failures — 47 tests,
then 11 — because bespoke mock objects are built per file.

So: add it to `surfaceContractMock()` in
`src/plugins/hermes-bots/group-test-utils.ts`, and have bespoke mocks spread it:

```ts
...(await (await import('./group-test-utils')).surfaceContractMock()),
```

One line there, not a hunt through the suite.

## Known gap

**There is no `SurfaceRail`.** The right rail is still Bot Mode's
`BotContextPanel`, and it is registered as a pane *and* rendered as a rail — the
ambiguity that kept the Bot Screen unreachable for several rounds. Until a rail
kit exists, every rail-shaped fix is still per-surface.

The next contract piece worth building is therefore the rail, followed by
migrating the app's own chat surface onto `SurfaceHeader`/`SurfaceComposer` so the
contract has more than one consumer and stops being "the thing Bot Mode uses".
