# Wave 0 baseline — desktop perf + shape metrics

Baseline numbers for the agentic-desktop revamp. Every later wave PR should
re-run the harness on the same machine class and quote before/after against
these figures.

## Environment

| | |
|---|---|
| Machine | macOS 26.5.2 (Darwin 25.5.0), Apple M4 Virtual, 16 GiB RAM |
| Node | v24.20.0 (`node:sqlite` for fixture seeding) |
| Python backend | repo `.venv` (uv-managed, 3.14.7) |
| Backend provider | `tests-js` mock inference server (no network) |
| Base commit | `a1982c960c` — `fix(desktop): repair electron typecheck broken by menu-bar status (#38)` |
| Date | 2026-09-26 |

## How to run

```bash
cd apps/desktop
PATH="<repo>/.venv/bin:$HOME/.local/bin:$PATH" \
HERMES_PYTHON="<repo>/.venv/bin/python" \
  npm run test:e2e:perf
```

Each spec prints `PERF[<metric>]=<value><unit>` lines; a CI job
(`.github/workflows/e2e-desktop-perf.yml`, `workflow_dispatch` only —
non-blocking by construction) runs the same suite on `ubuntu-latest` under
xvfb and uploads `apps/desktop/test-results/perf` as an artifact.

The fixture generator (`e2e/perf/fixture-generator.ts`) seeds real
`SessionDB`-schema `state.db` rows — schema comes from the repo's own
`SessionDB` bootstrap, so migrations stay honest — then bulk-inserts closed
sessions/messages via `node:sqlite`. Named profiles get a full
`profiles/<name>/` home with the mock provider config so any profile can boot
without the onboarding glass.

## Baseline numbers (2026-09-26)

### Cold start — launch to interactive, 3 runs

```
PERF[cold_start.run1]=5972ms
PERF[cold_start.run2]=5512ms
PERF[cold_start.run3]=5079ms
PERF[cold_start.p50]=5512ms
PERF[cold_start.max]=5972ms
```

### Session switch — 60-session home, first open + 6 alternating switches

```
PERF[session_switch.first_open]=197ms
PERF[session_switch.p50]=168ms
PERF[session_switch.p95]=383ms
PERF[session_switch.max]=383ms
```

### 2,000-message transcript — open, scroll to oldest, scroll back

History paginates behind a "Show earlier messages" gate; `earlier_page_load`
is the per-gate-click cost (14–15 loads to reach turn 0), `scroll_to_oldest`
the end-to-end walk.

```
PERF[transcript.open_to_latest]=212ms      # click row → newest message painted
PERF[transcript.scroll_to_oldest]=61335ms  # scroll up + 15 history-page loads
PERF[transcript.earlier_page_loads]=15loads
PERF[transcript.earlier_page_load.p50]=718ms
PERF[transcript.earlier_page_load.p95]=13593ms
PERF[transcript.earlier_page_load.max]=13593ms
PERF[transcript.scroll_frames.p50]=17.3ms
PERF[transcript.scroll_frames.p95]=131.6ms
PERF[transcript.scroll_frames.max]=7000.4ms
PERF[transcript.scroll_to_latest]=87ms     # jump back to bottom
```

### Composer keystroke latency while a stream is held open

```
PERF[keystroke_while_streaming.p50]=13ms
PERF[keystroke_while_streaming.p95]=21ms
PERF[keystroke_while_streaming.max]=21ms
PERF[keystroke_idle.p50]=9ms               # same loop with no stream
```

### 500-session rail across 3 profiles — grouped "all profiles" view

Seeds alpha/beta/gamma with 167 closed sessions each (501 total), switches to
"Show all profiles" + Filters → Grouping → "Gateway & profile", then expands
every group and scrolls the rail to the bottom.

```
PERF[session_rail.grouped_render]=919ms        # click "Show all" → all 3 group headers
PERF[session_rail.rendered_rows]=15rows        # 5-row window per group at rest
PERF[session_rail.expand_all_groups]=4627ms    # clicking every "Show more" to full
PERF[session_rail.expand_clicks]=42clicks
PERF[session_rail.rendered_rows_expanded]=200rows
PERF[session_rail.scroll_to_bottom]=142ms
PERF[session_rail.scroll_frames.p50]=16.8ms
PERF[session_rail.scroll_frames.p95]=18.6ms
PERF[session_rail.scroll_frames.max]=18.6ms
```

**Known ceiling:** the recents slice is a *global* window
(`_pinned_window` over the merged list in `hermes_cli/web_routers/profiles.py`)
while `Load more` is gated on per-profile "slice came back full" flags. Once
the fetch limit outgrows every profile's row count (~200 here: 50→100→150→200
climb, then each profile's 167 < 200 reports truncated=false), the footer
hides with ~300 rows still on disk. So the deepest reachable row isn't seed 0
— the spec asserts the scroller bottomed out over the loaded DOM, and this
pagination gap is itself a baseline observation for the revamp.

## Shape metrics — `node scripts/ts-shape-metrics.mjs`

```
# apps/desktop TypeScript shape
ts files:            3298
total lines:         754183
files > 1000 lines:  98
files > 1500 lines:  50
store atoms:         197 (src/store/* non-test files; 178 test files excluded)
```

Largest files: `electron/main.ts` (19,091 lines), `src/i18n/fr.ts` (6,515),
`src/i18n/de.ts` (6,507), `src/app/session/hooks/use-prompt-actions/index.test.tsx`
(6,177), `src/i18n/en.ts` (6,032). Full ranked list: run
`node scripts/ts-shape-metrics.mjs`.
