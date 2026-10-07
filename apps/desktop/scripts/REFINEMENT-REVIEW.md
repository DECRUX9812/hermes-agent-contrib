# Desktop refinement component review

This fixture renders the production BotCard, TeamPage and MissionRail components with isolated synthetic state. It does not start a gateway, call an inference provider, or connect to real profiles, and it is not an Electron production entry point.

## Run locally

Use a Node version accepted by the desktop package, such as Node 22.22.0. Install the repository dependencies from its root, then run the renderer:

```sh
npm ci
cd apps/desktop
npm run dev:renderer
```

Open `http://127.0.0.1:5174/refinement-preview.html`. A banner labels the synthetic data and the absence of a live agent connection.

## Repeat the browser checks

With the renderer running, use another terminal in `apps/desktop`. The script exercises actual production controls, but approval decisions only modify the fixture's synthetic team.

```sh
npx playwright install chromium
node scripts/refinement-preview-qa.mjs
```

The script checks light/dark appearance, all four rail destinations, keyboard focus and selection, activity details, team-delete cancellation, the create-team dialog, a fixture approval, and layouts at 1440, 800 and 375 pixels. It also verifies that the stacked compact rail can be scrolled into view and that there are no page errors.

Screenshots are written to the ignored `build/refinement-review` folder. Override the fixture URL with `HERMES_REVIEW_URL` or the output directory with `HERMES_REVIEW_OUTPUT`.

## Build a static review

The separate build configuration leaves the native desktop entry unchanged. Generated review files are ignored by Git.

```sh
npx vite build --config scripts/refinement-preview.config.ts
```

Serve `dist-review` and open `refinement-preview.html`. Do not treat this synthetic review as proof of a live provider conversation, remote routing, packaged installation, or cross-platform release readiness.
