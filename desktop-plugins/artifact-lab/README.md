# Artifact Lab — desktop plugin

A live preview bench for the artifacts the agents produce. Right-rail pane (`panes`, placement
right, 360px) plus a command-palette entry.

- **List** — newest-first rows from the plugin backend: name, kind tag, size, age, root tag.
  Refresh button; auto-refresh every 20s while the pane is visible (`host.paneVisibility`).
- **Preview** — click a row:
  - `.html` / `.svg` → fetched as text, injected as `srcdoc` into `<iframe sandbox="allow-scripts">`
    (no `allow-same-origin`, no `allow-top-navigation` — guest content renders itself and can do
    nothing else; it can never open an OS window or steer the app)
  - images → `<img>` from the backend's base64 payload
  - `.md` → `<pre>` (raw markdown, no renderer is claimed)
- **Compare** — when two rows in the same directory share a stem (`poster-v1`/`poster-v2`,
  `draft-report`/`final-report`, `poster.png`/`poster-v1.png`), a `compare N` toggle appears and
  renders both previews side by side with their names as headers. No pair found → no toggle. Pairs
  are derived only from rows that are actually in the list; nothing is invented.
- **Honest states** — `backend not mounted yet` when `/api/plugins/artifact-lab` 404s (with the fix
  spelled out), `no artifacts in the watched roots` plus the root list and the file count when the
  scan is empty, `partial scan` when the walk hit its work cap, and the backend's own refusal text
  when it refuses a file.

Data comes from the sibling backend plugin (`~/.hermes/plugins/artifact-lab/`), which allowlists the
artifact roots in code and realpath-checks every request. The pane consumes `format=json` because the
desktop REST door JSON-parses every response.

## Tests

```
node --check plugin.js
python3 ~/.hermes/skills/software-development/hermes-desktop-plugin-testing/scripts/smoke_plugin_esm.py plugin.js
node --test tests/*.test.mjs
```

`tests/artifact-lab.test.mjs` runs `plugin.js` in a `node:vm` context with the SDK surface stubbed
and asserts the registration shape (pane + palette, unique ids, lazy render), the pure helpers
(kind mapping, version-pair detection, size/age formatting, backend-error classification), and the
two safety invariants: sandboxed frames only, theme variables only (no hardcoded colors).
