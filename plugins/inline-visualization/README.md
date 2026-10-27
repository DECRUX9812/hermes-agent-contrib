# inline-visualization

Give the agent a `create_visualization` tool that renders a rich, interactive card — chart,
stats dashboard, heatmap, timeline, diagram — **inline in the chat thread**.

## Why this is a plugin and not a core change

Hermes **already** renders inline cards: a `::preview{file="…"}` directive in an assistant
message becomes a sandboxed iframe with an opaque origin (`sandbox="allow-scripts"`,
deliberately no `allow-same-origin`), the app's theme tokens injected as CSS variables, live
content-driven sizing, and `window.hermes.send` / `data-hermes-send` talk-back.

This plugin only *produces* a file and the directive. It adds **no Desktop code and no core
changes**, so it works on a current, unmodified Hermes — no upstream release needed, no fork.

## What it does

```
create_visualization(html, title)
```

1. Validates the HTML (size cap; rejects network calls at render time; rejects frame-busting;
   rejects cookies/localStorage — the card runs in an opaque origin and cannot reach them;
   `<script src>` only from jsdelivr / unpkg / cdnjs, quoted **or** unquoted).
2. Writes it to `$HERMES_HOME/visualizations/frames/viz-<stamp>-<digest>-<title>.html`.
3. Records it, and the next `transform_llm_output` for that session appends
   `::preview{file="…"}` to that turn's reply.

The agent's own text is **never rewritten** — the card is additive. A turn that did not call
the tool returns `None` and is left byte-identical (contrast with a scraper-style canvas, which
re-renders the answer).

## Settings

Declared in `plugin.yaml` as `config_schema`, so the Desktop builds the form
(**Settings ▸ Plugins ▸ inline-visualization**) — no preference pane of its own:

| key | default | meaning |
|---|---|---|
| `enabled` | `true` | attach the card to the turn that made it |
| `max_chars` | `200000` | reject a bigger document |
| `keep_frames` | `40` | newest N frames kept before pruning |
| `state_dir` | `""` | override the frames directory |
| `allow_remote_scripts` | `true` | permit CDN `<script src>` (allow-list only) |

## Install

```bash
mkdir -p ~/.hermes/plugins/inline-visualization
cp plugin.yaml __init__.py viz_frames.py ~/.hermes/plugins/inline-visualization/
hermes plugins enable inline-visualization
```

Then **start a new session** — tools land on the next session, not the current one.

On a desktop session the card renders. On TUI / web / messaging surfaces the tool still works
and the reply still reads correctly; only the frame is not drawn.

## Test

```bash
python test_plugin.py     # 17 checks: frame write, directive attach, untouched turns, validation
```

## Not for installs that already provide it

If your Hermes already registers a built-in `create_visualization`
(`hermes plugins validate .` reports a *built-in tool collision*), it is already there — don't
install this.
