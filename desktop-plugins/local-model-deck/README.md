# local-model-deck (desktop plugin)

The deck for the local LLM runtimes on this machine — the readout you would otherwise get by
scrolling a terminal.

| Surface | Contribution | What it shows |
| --- | --- | --- |
| Right rail pane | `pane` (`panes`, placement `right`, 320px) | model file + quant type, ctx, slots busy/total, RSS, pid, uptime, health dot, metrics state |
| Status-bar chip | `deck-chip` (`STATUSBAR_AREAS.right`) | `bonsai ok · 5.5 GB` / `bonsai down` / `deck ?` |
| Command palette | `deck-refresh` | refresh the deck, report the current line |

Data comes from the sibling backend (`~/.hermes/plugins/local-model-deck/`): `GET /runtimes`
(probes `/health`, `/props`, `/slots`, `/v1/models`, `/metrics` on each configured runtime) and
`GET /process?port=…` (`ss` + `/proc` for the process behind the socket).

## Truth rules

- **No fabricated throughput.** llama.cpp answers `/metrics` with HTTP 501 unless it was started
  with `--metrics`. The pane then says *“metrics disabled on this server (start with --metrics for
  tok/s)”*, echoes the server's own message, and shows no tokens/sec — a render test asserts no
  `tok/s` number can appear in that state.
- **Unknown is not zero.** Unmeasured slots render `?/2`, a missing pid renders `—`; `busy: null`
  is never coerced to `0`.
- **Three distinct failure states**, never a spinner that hangs: `probing the configured runtime
  endpoints…` (bounded: 1 s per probe, 8 s rest timeout), `no local runtime is up`, and
  `backend not mounted yet` (ctx.rest 404) vs `backend unreachable`.
- **Read-only.** The plugin never starts, stops, or reconfigures a runtime, and never writes.

## Polling

Pane: 5 s while the pane is visible, off while hidden (`host.paneVisibility('local-model-deck:pane')`
— the id the host scopes from the `pane` contribution). Chip: 15 s. Process readout: 15 s.
`retry: 0` everywhere so a dead backend surfaces immediately instead of backing off quietly.

## Adding a runtime

Append `{id, label, host, port}` to `RUNTIME_ENDPOINTS` in the backend's `dashboard/plugin_api.py`.
The allowlist is a module constant on purpose: a caller can never make the deck dial an arbitrary
host, and `GET /process` refuses ports outside it with HTTP 400.

## Tests

```bash
node --check plugin.js && node --test tests/*.test.mjs          # 36 vm tests
~/.hermes/hermes-agent/.venv/bin/python -m pytest ../plugins/local-model-deck/tests -q   # 41 backend tests
```

`tests/fixtures/*.live.json` are verbatim captures from this box's llama-server, so the mapping is
tested against what the runtime really sends.
