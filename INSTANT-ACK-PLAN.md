# Instant ack — build plan (fan-out)

**Feature:** every Bot Chat send gets an honest acknowledgement in under a second, then visible
background work. Design source: `~/Code/INSTANT-ACK-BRIEF.md` (Muse, 26-10).
**Branch:** `feat/instant-ack` off `overlay/core-patches` @ `65efb98bc1`.
**Worktree:** `~/Code/repair-work/wt-ack`.

## Why this feature

`BOTMODE-PARITY.md` lists instant ack as **not built** in the fork or live. The transcript already
narrates *tool* work (`status.tsx` → `useStatusHint` → `toolPresentVerb`), but the first ~1s after a
send is still a bare spinner with no receipt, so the app reads slower than it is.

## What already exists (do not rebuild)

| Surface | File | Reuse |
|---|---|---|
| Pre-first-token row | `components/assistant-ui/thread/status.tsx` → `ResponseLoadingIndicator` | visual language |
| Tail activity row | same → `TurnActivityIndicator` | quiet-gap timing |
| Tool present verb ("Opening example.com…") | `components/assistant-ui/tool/run-summary.ts` → `toolPresentVerb` | Part B copy |
| Scaffold line styling | `components/chat/scaffold-row.tsx` → `SCAFFOLD_LABEL_CLASS` | calm surface |
| Busy/queue decision | `app/chat/composer/hooks/use-composer-submit.ts`, `busy-submit-state.ts` | arming point |

## Two-part ack

- **Part A — receipt.** Client-side, armed synchronously at submit. `Got it — <restatement>`
  (≤8 words, derived from the user's own text, claims nothing about progress). Target ≤100 ms.
- **Part B — first real event.** The first tool call's present verb, or the first streamed text
  which takes over the bubble entirely. If neither lands by `WAITING_AFTER_MS`, the receipt becomes
  `Waiting on the model…`. Never an invented step.

## Module contract (locked — lanes code against this)

`apps/desktop/src/app/chat/instant-ack/`

```ts
// receipt.ts
export function receiptFromPrompt(text: string): { kind: 'prompt' | 'command'; text: string } | null

// state.ts — pure, i18n-free
export type InstantAckState = 'approval' | 'receipt' | 'waiting' | 'working'
export interface InstantAck {
  state: InstantAckState
  /** Restated ask (receipt) or the tool's present verb (working). Never invented. */
  detail: string
  /** Monotonic ms of the last real event. */
  updatedAt: number
  armedAt: number
}
export type InstantAckEvent =
  | { type: 'arm'; detail: string; at: number }
  | { type: 'tool-start'; detail: string; at: number }
  | { type: 'waiting'; at: number }
  | { type: 'approval'; at: number }
  | { type: 'hand-off'; at: number }   // real reply text / turn over / error
export function reduceInstantAck(current: InstantAck | null, event: InstantAckEvent): InstantAck | null
export const WAITING_AFTER_MS = 1200

// store.ts — nanostores, keyed by composer/queue session key
export const $instantAcks: ReadonlyAtom<Record<string, InstantAck>>
export function armInstantAck(key: string, text: string, at?: number): void
export function noteInstantAck(key: string, event: InstantAckEvent): void
export function clearInstantAck(key: string): void

// use-instant-ack.ts
export function useInstantAck(key: string | null | undefined): InstantAck | null
```

**DOM contract (the probe measures this):** the row renders
`<div data-slot="instant-ack" data-ack-state="receipt|working|waiting|approval" role="status">`.
Absence of the element = nothing to say. Receipt text always starts with `Got it —`.

## Lanes

| Lane | Where | Owns | Done when |
|---|---|---|---|
| **core + wiring** (me) | wt-ack | `receipt.ts`, `state.ts`, `store.ts`, `use-instant-ack.ts`, `instant-ack-line.tsx`, arm in `use-composer-submit.ts`, mount in `app/chat/index.tsx` | unit + component tests green, `tsc` 0 |
| **probe** (agent) | wt-ack-probe | staging :9137 harness + headless receipt-latency + Part B measurement script under `repair-work/probe/` | real numbers printed, shots saved |
| **queue audit** (agent) | wt-ack-queue | `use-busy-input-mode` / `queue-if-busy` / `busy-submit-state` audit + tests proving a queued follow-up gets its own receipt and never emits `Operation interrupted` | audit note + green tests |
| **perf** (agent) | wt-ack-perf | reuse batch-2 frame-time probe: no long task >50 ms while streaming with the ack mounted | numbers or honest miss |

## Acceptance (from the brief, mapped)

1. Part A ≤100 ms after send — probe lane, headless Chrome, staging :9137.
2. Part B p50 ≤1 s with the default model — probe lane; a miss is **reported**, not faked.
3. Queued follow-up gets its own receipt; steering never shows `Operation interrupted` — queue lane.
4. Reload mid-turn restores from real turn state (store is derived, never persisted) — core tests.
5. No long task >50 ms while streaming — perf lane.
6. vitest + typecheck + eslint clean; new tests cover receipt timing, transitions, queue, restore.
7. Staging verification with shots before any deploy.

## Deploy (only after 1–7 pass)

rsync dist-webapp (no `--delete`), no gateway restart (frontend-only), rollback script under
`~/Code/repair-work/backups-batch5-*/rollback.sh`, log in `PORT-STATUS.md` same day.
