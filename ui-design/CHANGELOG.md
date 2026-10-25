# Warm Paper — applying `hermes-pretty-desktop-design` to the dev app

What this is: the attached design skill turned into a **shippable skin** plus the
few component decisions a palette can't express. Nothing in the existing
component tree was rewritten, so the other 13 skins keep rendering exactly as
before and `Warm Paper` can be judged (and dropped) on its own.

## Files

| File | What it is |
| --- | --- |
| `apps/desktop/src/themes/paper.ts` | The skin: light + dark palettes, terminal ANSI, typography, and a scoped `customCSS` payload. |
| `apps/desktop/src/themes/presets.ts` | One import + one line in `BUILTIN_THEMES`. That is the whole registration. |
| `apps/desktop/scripts/theme-contrast-audit.mts` | The "run the contrast checker" step: the ramp contract plus every hand-made text pair, exit 1 on failure. |
| `devloop/webapp-dev.config.ts` | **Bug fix** — the dev proxy's Origin rewrite (see below). |
| `ui-design/preview.html` | Component preview: sidebar, thread, tool lines, composer, status bar, popover, empty state, tokens — light and dark. |
| `ui-design/shot.mjs`, `ui-design/shot-app.mjs` | Full-page / in-app screenshot helpers used for the before/after set. |

## Design decisions worth knowing

- **The palette does the work.** Every surface reads `--dt-*` / `--ui-*` and
  `applyTheme` paints those from a `DesktopTheme`, so one palette restyles the
  entire app by construction. The `customCSS` payload only carries what a colour
  cannot: 15px/1.6 body leading, a 2px focus ring at 35% brand, caret and
  selection colour, 8px quiet scrollbars, headings at 500, sentence-case chrome,
  and no frost or wallpaper behind text.
- **The indigo was deepened, not copied.** The skill's `#5b6ee1` is 3.98:1 on
  paper — under AA for link text — and white on it is 4.41:1 for the send
  button. `primary` is `#4a5bd0` (5.13:1 on paper, 5.68:1 white-on), while
  `#5b6ee1` survives as `midground`, where it is only ever a ring or a stroke
  (non-text, 3:1 floor). Hue kept, AA met.
- **The hint grey is not `#9a9487`.** That value is 2.73:1 on paper. The app
  already solves this properly: `text-ramp.ts` lifts each skin's tertiary tier
  until it clears 4.5:1 and the contract test holds every built-in skin to it.
  For Warm Paper it resolves to `#716e69` (4.59:1) — so the shipped hint colour
  is the lifted one, not the skill's number.
- **Dark is neutral, not "warm".** The skill's dark tokens (`#17161a`, `#8d9bff`)
  are a different room: ink and lamplight. Calling both "paper" is fine as the
  skin's name; the dark palette is not pretending to be beige.
- **One accent, small footprint.** Brand colour appears on the active row, links,
  focus rings and the send button — nowhere else. Success/warning/error stay
  dots, thin borders and text.

## Verified

- `npx vitest run --config vitest.config.ts src/themes/` → **302 passed**, 16
  files, including `text-ramp.test.ts` (the AA contract) with Warm Paper in the
  list, light and dark.
- `node --import tsx scripts/theme-contrast-audit.mts paper` → **38 checks, 0
  failing** (body 14.1:1, secondary 5.2:1, accent 5.1:1, white-on-primary 5.7:1,
  tertiary 4.59:1, quaternary 3.07:1; dark mirrors all higher).
- Preview rendered and inspected at 1440 and 1130, light and dark
  (`ui-design/shots/after/`). Two layout bugs were found and fixed during that
  pass: a flex child's automatic minimum height was pushing the composer out of
  the frame, and the empty-state subcopy left an orphan word.

## The dev-loop bug this surfaced

`dev.decruxtech.com` was booting into **"Hermes couldn't start — 403
{"detail":"Cross-origin request refused"}"**.

Root cause: when the deployment puts the `hermes-plus` gate in front of the
backend, that gate demands a **strict same-origin** request — Host and Origin must
match in scheme+host+port — and replies 403 otherwise. The dev proxy rewrote
Origin to the *public* hostname (`https://desktop.decruxtech.com`) while
`changeOrigin` set Host to the bound interface, so every proxied request and every
WebSocket upgrade was the mismatch the gate exists to refuse.

Measured directly against the backend:

| Host | Origin | Result |
| --- | --- | --- |
| `100.84.81.81:9129` | `https://desktop.decruxtech.com` | 403 |
| `desktop.decruxtech.com` | `https://desktop.decruxtech.com` | 303 ✓ |
| `100.84.81.81:9129` | `http://100.84.81.81:9129` | 303 ✓ |
| `100.84.81.81:9129` | `https://desktop.decruxtech.com` (WS) | 403 |
| `100.84.81.81:9129` | `http://100.84.81.81:9129` (WS) | 101 ✓ |

Fix: `TRUSTED_ORIGIN` now defaults to the backend's own origin instead of the
public hostname, so Host and Origin agree and both the gate and the backend's own
host check are satisfied.

## Try it

1. Open `https://dev.decruxtech.com` (or the local dev server).
2. Appearance → **Warm Paper** (also reachable from ⌘K / `/skin`).
3. Light/dark/system is the normal mode switch; the skin follows it.

`ui-design/preview.html` is the static component sheet if you want to look at the
tokens and states without flipping the live app.
