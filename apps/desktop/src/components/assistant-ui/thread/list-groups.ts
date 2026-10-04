import { atom } from 'nanostores'

// Transcript grouping + DOM render budget. Pure helpers shared by the list
// component (list.tsx) and its tests; nothing here touches React or the DOM.

export type MessageGroup = { id: string; weight: number } & (
  { index: number; kind: 'standalone' } | { indices: number[]; kind: 'turn' }
)

// DOM is bounded by a render-cost budget, not a message/turn count. The
// currency is `messagePaintWeight`: what a turn actually MOUNTS, which is what
// the grouping decides rather than what the payload weighs. A settled run of
// twelve reads is one grey summary line, a thought is one collapsed
// disclosure, a hoisted `todo` is nothing — while a diff, an image card or a
// wall of markdown really does build DOM and is charged for it.
//
// Pricing by payload instead had the budget counting work that never mounts:
// one tool-heavy turn measured 84-281 units of tool JSON that painted as a
// dozen one-line summaries, so a session spent the whole page in two or three
// turns and offered "Show earlier" over a screen and a half of transcript.
//
// "Show earlier" prepends another page; whole turns stay intact so the sticky
// human bubble never loses its turn. This is the long-session perf lever WITHOUT
// a virtualizer — pure rendering, never touches scrollTop, so it can't fight
// use-stick-to-bottom (the single scroll owner).
//
// 600 units ≈ 10-20 agentic turns on measured real sessions (a tool-heavy turn
// prices at 30-90, a plain exchange at 5-10), and a whole session of ordinary
// work now fits one page instead of paging three times to reach its start.
// What the DOM can hold is bounded above by the store window regardless
// (TRANSCRIPT_WINDOW_BUDGET), so this cannot admit more than one window's
// content.
export const RENDER_BUDGET = 600

// Every mounted transcript list registers here (see the mount effect). The
// budget above is sized for ONE full-height pane; a grid split shows several
// panes at once, each a fraction of the screen — yet each was still mounting
// the full budget. Four visible panes meant 4x the mounted message fibers,
// and every streaming flush pays selector re-runs and React commit traversal
// over ALL of them — measured as the 4-zone collapse in the long-session
// matrix (worst-second 8fps while 1-2 zones held 50+). Sharing the budget
// keeps "screens of scrollback" constant instead of "turns per pane": a pane
// gets its proportional share of the page (MIN_VISIBLE_GROUPS still floors the
// turn count regardless of weight).
// Panes that already backfilled keep their mounted content when the count
// changes — the share only caps where NEW backfills stop.
export const $mountedTranscriptPanes = atom(0)

// Never offer "Show earlier" over fewer turns than this, however heavy they
// are. A weight-only cut on a session of enormous turns put the button two
// turns from the bottom, where it reads as broken rather than as paging — the
// user has not been given enough transcript to have gone looking for more. The
// store window caps what the DOM can reach at all, so a floor here stays
// bounded.
export const MIN_VISIBLE_GROUPS = 8

// On session switch, paint a small budget first (enough for the bottom turn(s)
// the user actually sees after scroll-to-bottom), then bump to the full budget
// in a requestAnimationFrame — defers the heavy markdown+syntax-highlight render
// past the initial commit, so the switch feels instant.
//
// 20, down from 60: the first-paint commit is synchronous and uninterruptible,
// and at 60 cost units it measured 627ms on a real session (LoAF: block=575ms, no
// attributed script — pure commit). A viewport after scroll-to-bottom shows
// 1-2 normal turns ≈ 10-20 units; the transition backfill below fills the rest
// interruptibly, so the only thing a smaller budget changes is how much work
// blocks the click-to-paint path.
export const FIRST_PAINT_BUDGET = 20

// A hot-hidden transcript is retained for instant tab return, but keeping its
// full scrollback mounted defeats the bounded pane cache. Preserve only the
// live tail while hidden; revealing it resumes stepped backfill.
export const HIDDEN_TRANSCRIPT_RENDER_BUDGET = 40

export const transcriptPaneBudget = (mountedPanes: number, hidden: boolean): number =>
  hidden ? HIDDEN_TRANSCRIPT_RENDER_BUDGET : Math.ceil(RENDER_BUDGET / Math.max(1, mountedPanes))

// "Show earlier" raises renderBudget ABOVE paneBudget (one pane page per click).
// The render-phase cap must only snap a hot-hidden pane down to its retention
// budget — a visible pane's growth has to survive the next render or the click
// is a no-op. Parked panes are unmounted, so they never hit this path.
export const shouldClampTranscriptBudget = (hidden: boolean, renderBudget: number, paneBudget: number): boolean =>
  hidden && renderBudget > paneBudget

// Units the backfill adds per committed step (see the backfill effect). A
// 60-unit step produced ~10 visible prepend frames after FIRST_PAINT_BUDGET
// retune (#83681). 290 fills a 600-unit page in two interruptible commits —
// still well under the measured 780ms single-jump freeze.
export const BACKFILL_STEP = 290

// Auto-spent budget pages while a parked reading offset waits for the tree
// to cover it (see the grow effect). The real bound is the transcript
// itself; this only stops a truncated-window fetch that never lands from
// re-arming forever.
export const PARKED_OFFSET_MAX_PAGES = 96

export const transcriptBackfillFrameCount = (
  firstPaint = FIRST_PAINT_BUDGET,
  step = BACKFILL_STEP,
  budget = RENDER_BUDGET
): number => Math.ceil(Math.max(0, budget - firstPaint) / step)

// Group each user message with the assistant turn(s) that follow it so the
// human bubble can `position: sticky` against the scroller across its whole
// turn (see StickyHumanMessageContainer in thread.tsx).
export function buildGroups(signature: string): MessageGroup[] {
  if (!signature) {
    return []
  }

  const messages = signature.split('\n').map(row => {
    const [index, id, role, weight] = row.split(':')

    return { id, index: Number(index), role, weight: Number(weight) || 1 }
  })

  const groups: MessageGroup[] = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]

    if (message.role !== 'user') {
      groups.push({ id: message.id, index: message.index, kind: 'standalone', weight: message.weight })

      continue
    }

    const indices = [message.index]
    let weight = message.weight

    while (i + 1 < messages.length && messages[i + 1].role !== 'user') {
      weight += messages[++i].weight
      indices.push(messages[i].index)
    }

    groups.push({ id: message.id, indices, kind: 'turn', weight })
  }

  return groups
}

// Walk turns newest-first, summing their render weights until the budget is met;
// everything before the first kept turn is hidden. `minVisible` turns are kept
// regardless of weight (the exempt newest turn counts as one of them). With
// `exemptNewest` the newest turn is kept AND left out of the sum, so a turn
// whose weight is still changing cannot move the cut. Returns the index of that
// first visible group.
export function firstVisibleGroupIndex(
  groups: readonly MessageGroup[],
  budget: number,
  minVisible = 0,
  exemptNewest = false
): number {
  const budgetedEnd = exemptNewest ? Math.max(0, groups.length - 1) : groups.length
  let firstVisible = budgetedEnd

  for (let i = budgetedEnd - 1, weight = 0; i >= 0; i--) {
    weight += groups[i].weight
    firstVisible = i

    if (weight >= budget) {
      break
    }
  }

  return Math.min(firstVisible, Math.max(0, groups.length - minVisible))
}

// content-visibility:auto skips off-screen turns for perf, but with
// contain-intrinsic-size:auto the browser only remembers a turn's size AFTER
// it has rendered. A turn that finishes streaming near the bottom may have had
// its (smaller) mid-stream size remembered; when it scrolls just off the top
// edge and gets skipped, it snaps back to that stale height, shifting content
// down. With overflow-anchor:none (the viewport can't self-correct) the
// stick-to-bottom lock drifts and the view creeps up over older turns — the
// "long session eventually shows old responses" glitch.
//
// Keep the newest turns always-rendered so a turn is only ever virtualized
// once its layout has settled at its final size (remembered == real → skipping
// it changes no height). Off-screen OLDER turns still skip, so the dialog/popover
// recalc win on long transcripts is preserved.
//
// The tail is budgeted in render-cost units, not turns, because that is what the
// cost actually scales with — the same currency as RENDER_BUDGET /
// FIRST_PAINT_BUDGET.
// A turn-count tail silently defeats itself on agent transcripts: one tool-heavy
// turn is 50-200 units, so a 6-TURN tail exempted the entire visible transcript
// and nothing virtualized at all. Measured on a 5-tile window (7/3/5/3/2 groups
// per tile): zero content-visibility containers were active, and every Radix
// overlay open paid the full ~610ms whole-document recalc that #66470 fixed.
//
// 40 units ≈ the 1-2 turns a viewport shows after scroll-to-bottom (the same
// reasoning as FIRST_PAINT_BUDGET=20, doubled so a turn that grows mid-stream
// doesn't fall out of the tail as it settles).
export const LIVE_TAIL_PARTS = 40
// Floor: always exempt at least this many turns regardless of weight, so a
// transcript of very heavy turns still keeps the streaming one unvirtualized.
export const LIVE_TAIL_MIN_GROUPS = 2
// Ceiling: never exempt more than this many turns, however light they are. On a
// long transcript of tiny turns a weight-only budget would walk back further
// than the old turn-count tail did and virtualize LESS — this keeps the new
// policy a strict improvement on every shape.
export const LIVE_TAIL_MAX_GROUPS = 6

/**
 * Index of the newest group that still virtualizes — everything at or after it
 * is the live tail and stays rendered. Walks newest-first accumulating weight,
 * so the tail covers a viewport's worth of content rather than a fixed number
 * of turns, clamped to [MIN, MAX] turns. Computed once per render, not per row.
 */
export function liveTailStart(
  groups: readonly MessageGroup[],
  tailWeight = LIVE_TAIL_PARTS,
  minGroups = LIVE_TAIL_MIN_GROUPS,
  maxGroups = LIVE_TAIL_MAX_GROUPS
): number {
  let weight = 0
  let start = groups.length

  for (let i = groups.length - 1; i >= 0; i--) {
    weight += groups[i]?.weight ?? 1
    start = i

    if (weight > tailWeight) {
      break
    }
  }

  // Clamp the tail to [minGroups, maxGroups] turns: the floor keeps the live
  // turn rendered when turns are huge, the ceiling stops a tail of tiny turns
  // from sprawling past what the old turn-count policy rendered.
  const floor = Math.max(0, groups.length - minGroups)
  const ceiling = Math.max(0, groups.length - maxGroups)

  return Math.min(floor, Math.max(ceiling, start))
}
