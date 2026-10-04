# Demo kit (not shipped)

Everything used to make the fork's launch films, kept so another agent can
reproduce or extend them. Nothing here is loaded by Hermes, and none of it is
meant for an upstream PR: per `apps/desktop/src/plugins/README.md`, demo plugins
belong in the companion `hermes-example-plugins` repo, which is where these
should go if they are published.

## plugins/ — runtime desktop plugins

Drop a folder into `$HERMES_HOME/desktop-plugins/<id>/plugin.js`; the app
hot-loads it. Each imports only `@hermes/plugin-sdk`, `react` and
`react/jsx-runtime`.

| Plugin | What it shows |
|---|---|
| `synthwave` | Theme with `colors` + `darkColors` + motion `customCSS` (drifting light, horizon grid) |
| `focus-timer` | `::timer{minutes label}` directive card + `statusBar.right` countdown chip, shared `atom` |
| `mission-control` | Route + sidebar nav + palette: every chat as a star, working ones lit (`session.list`, `dotStateBySession`) |
| `pulse` / `pulse-gold` | Floating pane orb that flares while the agent thinks; gold is the "remixed by asking" edit |
| `spend` | Route: week's spend, cache-share donut, per-model costs from `insights.get {report: true}` |
| `flow` | `::flow{title steps="A|B|C"}` directive you edit in place (rename, add, remove steps) |
| `chart`, `cyanotype` | v1 film: inline bar chart directive; a sun-print theme |

## harness/ — the real app, scripted

- `demo_mock.py PORT LOG` — OpenAI-compatible scripted model (streams, tool calls) keyed on natural prompts.
- `boot.cjs` — boots the real Electron app in an isolated sandbox `HERMES_HOME` against the mock.
- `seed_history.py HOME` — a week of usage through SessionDB's own accounting (Spend page).
- `record4.cjs` ("We heard you" footage), `record5.cjs` (Teknium special footage) — drive the app with a
  visible cursor and capture with ffmpeg x11grab (`FFMPEG`, `DISPLAY` env). `dry` saves screenshots instead.
- `score.py OUT.wav PLAN.json` — synthesized 118 BPM score timed to a plan (`films/*/plan.json`).

Run under Xvfb (`Xvfb :99 -screen 0 1920x1200x24`). The Teknium recording needs a VS Code server on
PATH (`code`, `code-insiders` or `openvscode-server`).

## films/ — HyperFrames sources

`hermes-plugins` (v1), `we-heard-you` (v2, `src/build.py` generates `index.html` from a scene table),
`teknium-special` (terminal style). Footage (`assets/app.mp4`), score and fonts are not committed:
record with the harness, generate the score, copy GSAP into `assets/`, then
`npx hyperframes@0.8.98 check && npx hyperframes@0.8.98 render`.
