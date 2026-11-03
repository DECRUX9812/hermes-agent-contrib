# Design debt: the gates, the numbers, and why the ceilings are what they are

This is the state of the desktop's design-debt programme after the sweep that
took colour literals to zero and arbitrary type sizes to zero. Read this before
adding a number to the list or "fixing" one of the ceilings.

## The three gates

One counter, one run:

```bash
cd apps/desktop
npm run lint:hex        # the gate (also runs in the pre-commit hook, repo-wide)
node scripts/hex-count.mjs "$(pwd)"   # the raw counts + offender list
```

| Gate | Rule | Baseline |
|---|---|---|
| `lint:hex` | colour literals outside the token layer | **0 — cliff** |
| `lint:type` | arbitrary font sizes | **0 — cliff** |
| `lint:inline` | inline style objects | **166 — no growth** |

Baselines live in `scripts/hex-baseline.json`; `--update` lowers them.

**What counts.** Production `.ts`/`.tsx` under `src/`, tests excluded, comments
stripped (an issue reference like `// #94570` is not a colour), only valid CSS
colour lengths (3/4/6/8 digits), `src/themes/` excluded because a theme preset is
a palette by definition. Twenty palette files are allowlisted with a one-line
reason each — ANSI terminal colours, brand marks, syntax themes, canvas colours,
colours injected into *inspected* pages that have none of our tokens.

## Why the inline-style ceiling is "no growth" and not 50

Measured, not assumed: of 166 inline styles, **38 are dynamic** — a computed
`width: ${pct}%` or a mask cannot be a class. Of the 128 static, most carry at
least one value Tailwind cannot express exactly (`color-mix(...)` strings, `top`
from a computed variable, canvas geometry).

The original 50 ceiling cannot be met without changing layouts. The gate's job is
therefore to stop new ones while the convertible residue is worked off component
by component — each conversion needs a screenshot behind it, which is what
`e2e/surface-visual.spec.ts` and the Bot Mode specs provide.

## Why `!important` is not on the list

111 declarations, 106 of them in `src/styles.css`, and sampling finds three kinds:
reduced-motion blocks (`animation-duration: 0.01ms !important` is *how* you honour
`prefers-reduced-motion`), vendor overrides (codicon, katex, shimmer), and
utilities that must beat a class loaded after them. Driving this to the 20 ceiling
would delete accessibility behaviour, not debt. It needs a per-declaration
justification pass, not a sweep.

## The surface contract

`src/components/surface/` holds `SurfaceHeader` and `SurfaceComposer`, exported
through the plugin SDK so any plugin can use them. `README.md` there states what
they own, the five rules, and the mock factory every new export must be added to
(`surfaceContractMock()` — otherwise the suite dies with
`No "X" export is defined on the plugin-sdk mock`; see that file's history).

**No `SurfaceRail` exists, deliberately.** Both rail variants are a single
`flex h-full flex-col` div; a kit over one div would be ceremony. The rail's real
problem was pane ownership, which was fixed separately.

**The contract has one consumer.** Neither app-side surface fits: `ChatHeader` is
titlebar chrome (calc widths, session-actions menu) and the chat bar is not a
form — it submits on keydown. Forcing either would be imitation of a pattern, not
adoption of one.

## First paint: measured, and where the time actually goes

`e2e/boot-budget.spec.ts` holds FCP under 3000ms and blocking under 900ms, and
logs both. On a cold render:

```
first-paint 148ms · FCP ~1400ms · DCL ~210ms · blocking ~450ms
v8.parseOnBackground ~1.0s · GC ~0.5s · mount+data ~0.4s
```

Two things this rules out, both of which were assumed for a long time:

1. **It is not the bundle being unsplit.** The entry already dynamically imports
   `./main`, and the heavy routes are already `lazy()` — capabilities, messaging,
   artifacts. `main` is the essential shell; splitting further would mean lazy
   loading the default chat screen.
2. **It is not a missing lazy library.** Neither CodeMirror nor mermaid is in the
   boot chunk (grep → 0 in `main-*.js`).

The remaining lever is reducing what the shell must parse, which is a product
decision about what the default screen needs — not a refactor.

One fix did land: theme fonts are remote stylesheets and were render-blocking;
they are now injected `media="print"` and swapped on load. That is a correctness
fix for a slow or blocked CDN (and the offline case); locally the FCP change is
inside the noise because the sandbox cannot reach the CDN either way.

## Running the visual harness

```bash
cd apps/desktop
npm run build                       # the e2e drives dist/, and refuses a stale one
xvfb-run -a npx playwright test e2e/ --workers=1 --reporter=line
```

`--workers=1` is not optional: parallel workers spawn several Electron instances
and `beforeAll` times out at 90s on a loaded box. Baselines are gitignored
`*-snapshots/`; `--update-snapshots` re-pins them.

When a change should be pixel-identical, run **without** `--update-snapshots` and
require no `[visual-diff]` lines. That has caught nothing yet and has proved
three migrations were exactly equivalent — which is worth as much.
