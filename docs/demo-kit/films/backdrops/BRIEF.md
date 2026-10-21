# backdrops — launch film for the Backdrops desktop plugin

One claim: **your chat doesn't have to wear the same gray** — the Backdrops plugin puts fresh
drops and your own photo behind the whole app.

## Source layout

- `index.html` — 1920x1080 HyperFrames composition. 14 video tracks on the 118 BPM bar grid
  (bar = 2.0339s), `#cam` transform-driven camera over a 1700x1063 app window slot, whip-zoom
  reveals, spark arcs on clicks, lockup pull-out at 26.44s.
- `compositions/` — `bg` (nebula plate + dust motes), `words` (the slam lines), `fx` (streaks,
  flash, ring), `lockup` (wordmark). Each registers `window.__timelines['<id>']`.
- `plan.json` — score plan for `harness/score.py` (118 BPM, drop on bar 2, hits on every cut).

## Assets (generated, not committed)

`assets/` and `renders/` are local build products:

- `assets/seg-v*.mp4` — per-segment footage cut from the raw capture. **Slice one file per
  video track** — concurrent seeks into a single mp4 tear frames at screenshot-capture time
  even with dense keyframes. Each segment starts at media 0.
- `assets/plate.jpg` — nebula still for the bg composition (any moody space art works).
- `assets/gsap.min.js` — from `node_modules/gsap`.
- `assets/score.wav` — `.venv/bin/python harness/score.py films/backdrops/plan.json` (needs numpy).

## Footage capture (macOS)

`harness/record-backdrops.cjs` drives the real app: boots `boot-mac.cjs` against a local
manifest server on :8100 (must send `access-control-allow-origin: *` or the plugin's fetch is
CORS-blocked while `<img>` thumbs still load), sets dark mode + vivid strength via
`localStorage` (`hermes-desktop-mode-v1`, `hermes.desktop.backdrop.strength.v1`) — do NOT use
`page.emulateMedia` or `recordVideo`, both hang on Electron's CDP — then captures the screen
with `ffmpeg -f avfoundation -capture_cursor 1 -i "Capture screen 0:none"` and writes
`markers-backdrops.json` via `mark(name)` calls.

Prereqs: `npm run dev:renderer` already on 127.0.0.1:5174, `dist/electron-main.mjs` built,
`demo_mock.py` on :18999.

## Cut points

Markers → tracks: cold open on the plain chat, gallery drop at bar 2, three whip-cut reveals
(Abyssal / Rainline / Ember), upload beat with the generated dog photo, three one-bar montage
flips (Glowcap / Nebula / Topo), pull-out lockup over the dog backdrop at bar 13.
