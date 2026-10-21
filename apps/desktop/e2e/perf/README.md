# Perf lane (e2e/perf)

Playwright specs that measure rather than assert. Each spec seeds a sandboxed
`HERMES_HOME` with the real backend path (a genuine `tui_gateway.entry`
session creates `state.db`; `fixture-generator.ts` then bulk-appends rows that
read like closed desktop sessions), launches Electron, and reports wall-clock
numbers as `PERF[metric]=value unit` console lines, plus `perf-*` attachments
in the Playwright report.

Run it:

```bash
cd apps/desktop && npm run test:e2e:perf
```

This is a separate Playwright config (`e2e/perf/playwright.config.ts`); the
default suite ignores `perf/**` so these heavier specs never slow down
`npm run test:e2e`. CI: `.github/workflows/e2e-desktop-perf.yml` runs the lane
on manual dispatch only — numbers, not gates.

Baseline numbers live in `apps/desktop/docs/revamp/baseline.md`. When a wave
PR changes cold start, session switching, transcript rendering, composer
latency, or the rail, re-run this lane on the same machine class and paste
the new `PERF[...]` lines alongside the baseline.
