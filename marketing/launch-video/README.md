# Hermes launch video

Code-driven launch video built with [Remotion](https://remotion.dev) — the mock
UI uses the real desktop design tokens (`src/theme.ts`, lifted from
`apps/desktop/src/styles.css`) so scenes read as the product itself.

## Storyboard (≈49s, 30fps)

| # | Scene | Beat |
|---|-------|------|
| 1 | Hook | Phone streams a reply that survives a page reload |
| 2 | Problem | "one agent. one window. one hope." |
| 3 | Reveal | HERMES wordmark |
| 4 | Bot Mode | Team room — bots @mention each other and split work |
| 5 | Real work | Diff + terminal + `git_ship → open_pr` → PR card |
| 6 | Anywhere | Same session on desktop and phone |
| 7 | Flash | bots that learn → any model → open source → free |
| 8 | CTA | github.com/NousResearch/hermes-agent |

## Build

```bash
npm install
npx remotion browser ensure   # first time only: downloads headless Chrome
npm run render                # out/hermes-launch-9x16.mp4  (X/TikTok/Reels)
npm run render:wide           # out/hermes-launch-16x9.mp4  (YouTube/README)
npm run studio                # live-edit scenes in the Remotion studio
```

Timing constants live in `src/Root.tsx` (`CUTS`); scene content in
`src/scenes.tsx`; motion primitives in `src/primitives.tsx`.

## Dropping in real footage

Replace any scene's mock `<Frame>` with `<OffthreadVideo src={staticFile('rec.mp4')}>`
inside the same Frame shell — put recordings under `public/` and reference them
via `staticFile()`. Screen Studio (macOS) or `vhs` produce the cleanest sources.
