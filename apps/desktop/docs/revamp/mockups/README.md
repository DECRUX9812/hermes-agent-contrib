# Target mockups (reference, not shipping code)

Static HTML rendered from the app's **own** design tokens, so they show what Wave V / Wave B should look like
*inside the current desktop* — real chrome, real type scale, real Simple/Advanced modes, real skin seeds.
Open one in a browser (or render it), implement the real React components to match, and put your before/after
next to these PNGs in the PR. Specs: [`../../revamp-visual-plan.md`](../../revamp-visual-plan.md) and
[`../../bot-mode-plan.md`](../../bot-mode-plan.md).

| Page | Query params | Shows |
|---|---|---|
| `simple.html` | `scheme=dark` | **Simple mode**: sidebar + chat; state badge + **Watch**; plan card; approval; learned receipt |
| `advanced.html` | `scheme=dark`, `skin=ember\|midnight` | **Advanced mode**: + right zone (Now/Files/Review/Terminal), chips, approvals control, statusbar |
| `teammate.html` | `ui=simple\|advanced`, `tab=work\|profile` | Teammate panel: Work (Now/Next/Done), Profile (Brain · Trust · Where · Reachable; Advanced adds Persona/tools + Developer) |
| `hire.html` | — | **Hire a teammate** gallery + team packs over the Simple app |
| `first-run.html` | — | "Give Hermes a brain" (free tier · own key · local) |
| `mission-control.html` | — | One needs-you queue with keyboard triage and an "answered elsewhere" row |
| `states.html` | — | Honest states: one-problem-one-card, teammate empty state, answered-elsewhere, outcome-unknown |
| `real-tokens.css` | — | **Verbatim** copy of `src/styles.css` token blocks (regenerate when it changes — do not hand-edit) |
| `tokens.css` | — | The only NEW tokens v2 adds — all aliases of existing ones |
| `app.css` / `app.js` | `ui`, `skin`, `scheme` | Component specs copied from Button/Badge/PaneTab/WIDGET_SHELL; `applyTheme` seeds from `apps/shared/src/theme-presets.ts` |
| `png/` | | Rendered 1440×900 references (light, dark, ember skin) |

## Caveats

- **Fonts/icons are stand-ins:** Inter for the system stack, a serif for Collapse (`@nous-research/ui`), hand-drawn
  Tabler-like icons. The real app uses its own — these fix hierarchy, spacing and behaviour, not final type.
- **The sidebar is opaque here.** The real one is glass (29% tint + vibrancy) — v2 surfaces there must use the
  existing sidebar tokens, never opaque hex.
- **Teammate faces are a stand-in** for `BotFace` (blobatars); hues come from the semantic palette so every skin recolours them.
- **Data and copy are fake** but internally consistent (3 needs-you items everywhere). Free-tier wording must come
  from `free_tier.status` and obey the ruled copy in `src/AGENTS.md`.

## Render

```bash
# any Chromium; new-headless viewports are ~87px shorter than --window-size, so add 87 and crop
chromium --headless=new --hide-scrollbars --window-size=1440,987 \
  --screenshot=out.png "file://$PWD/simple.html?ui=simple&scheme=light"
```
