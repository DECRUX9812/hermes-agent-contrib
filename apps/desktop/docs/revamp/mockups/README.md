# Target mockups (reference, not shipping code)

Static HTML that shows the **look and information hierarchy** Wave V should reach. They are the
visual spec for `docs/revamp-visual-plan.md`: open one in a browser, or render it, then
implement the real React components to match — and put your before/after next to these PNGs
in the PR.

| File | Shows |
|---|---|
| `team-desk.html` | Team rail · conversation (plan card, learned receipt, approval) · Desk (Now / changes / PR / learned / replay). `?theme=dark` for dark. |
| `first-run.html` | "Give Hermes a brain" — free tier, bring-your-key, local model |
| `mission-control.html` | One "needs you" queue with keyboard triage and an "answered elsewhere" row |
| `states.html` | Four honest states: one-problem-one-card, teammate empty state, answered-elsewhere, outcome-unknown |
| `tokens.css` | Design language v2 tokens (light + dark). New names are `--v2-*`; existing `--ui-*` / `--theme-*` are reused |
| `png/` | Rendered 1600×1000 references |

## Caveats

- **Fonts:** Inter and a serif stand-in are used for rendering. The app's real display face is
  Collapse (`@nous-research/ui`); pick the final UI face deliberately (Wave V1), don't just adopt Inter.
- **Copy is illustrative.** Free-tier wording must come from `free_tier.status` and follow the ruled copy in
  `src/AGENTS.md` (never "guest", "anonymous", "claim", "Nous Portal").
- **Data is fake** and internally consistent (3 needs-you items everywhere). Real screens read stores.
- Icons are hand-drawn placeholders — use the app's existing icon set.

## Render

```bash
# any Chromium; new-headless viewports are ~87px shorter than --window-size, so add 87 and crop
chromium --headless=new --hide-scrollbars --window-size=1600,1087 \
  --screenshot=out.png "file://$PWD/team-desk.html?theme=light"
```
