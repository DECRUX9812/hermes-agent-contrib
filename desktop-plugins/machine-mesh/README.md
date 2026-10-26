# machine-mesh (desktop plugin)

One ops screen for this machine and its network: tailnet nodes and the Hermes stack's
listening daemons, with the systemd `--user` unit that actually owns each port.

## Surfaces

| id | area | what |
|---|---|---|
| `mesh-pane` | `panes` (right, 340px) | NODES + SERVICES, auto-refresh 15 s while visible, manual refresh |
| `mesh-chip` | `STATUSBAR_AREAS.right` (order 46) | `mesh 6/6`, polls at 60 s when the pane is closed |
| `mesh-refresh` | `PALETTE_AREA` | "Machine Mesh: refresh nodes and services now" |

## Backend

`~/.hermes/plugins/machine-mesh/dashboard/plugin_api.py` — mounts at `/api/plugins/machine-mesh/`:

- `GET /health` → `{ok, host, ts, plugin, version, tailscale_cli}`
- `GET /nodes` → this host (hostname, arch, kernel, uptime, primary IPs) + `tailscale status --json` peers.
  No tailscale CLI → `{"available": false, "reason": "tailscale CLI not found"}` and one local node. No invented peers.
- `GET /services` → probes the allowlist (9119, 8899, 8790, 8791, 8890, 8085) at `127.0.0.1`, then the tailnet
  address, then the LAN address; reports `tcp`/`reachable`/`probe_host`/`http_code`/`pid`/`unit`/`unit_state`.
  Unit ownership is discovered from `/proc/<pid>/cgroup` of the listening process — never guessed.
  Every subprocess call is capped at 3 s; a failure degrades one section, not the endpoint.

## Gates

```bash
node --check plugin.js
python3 ~/.hermes/skills/software-development/hermes-desktop-plugin-testing/scripts/smoke_plugin_esm.py plugin.js
node --test tests/*.test.mjs                                    # 28 tests: registration + pure logic + honest states
cd ~/.hermes/plugins/machine-mesh && ~/.hermes/hermes-agent/.venv/bin/python -m pytest tests -q   # 20 tests
```

## Honest states

- `ctx.rest` 404 → "backend not mounted yet" (chip shows `mesh ?`, never a fabricated count).
- Any other error → the real message, per section, so one broken half never hides the other.
- A service up on the tailnet but not on loopback shows `probe_host: 100.x.y.z` instead of claiming to be down.
- No uptime / no last-seen / zero Go timestamps render as `—`, not `0s` and not a date in the year 1.
