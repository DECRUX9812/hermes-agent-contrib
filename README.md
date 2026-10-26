# hermes-plus-overlay

DECRUX9812's additions to Hermes, kept **outside** the Hermes source tree so Nous main can
update cleanly.

## Rules

- Nous main (`NousResearch/hermes-agent`) is pull-only. We never push, open PRs, or comment there.
- All work lives on `DECRUX9812/hermes-agent-contrib`. This overlay is the `overlay/main`
  branch of that repo.
- Nous main stays a clean, detached checkout (`~/Code/hermes-nous-main`). No edits there.
- A feature that cannot be a plugin goes in `patches/` as a small, rebased patch on
  a contrib branch, and is kept as short as possible.

## Layout

| Folder | Installed into | Loaded by |
|---|---|---|
| `desktop-plugins/<id>/plugin.js` | `$HERMES_HOME/desktop-plugins/<id>` | Desktop renderer (Electron; webapp needs patch P1) |
| `plugins/<name>/` (`plugin.yaml`) | `$HERMES_HOME/plugins/<name>` | Python plugin loader (`hermes plugins enable <name>`) |
| `skills/<name>/SKILL.md` | `$HERMES_HOME/skills/<name>` | Skills loader |
| `patches/` | contrib branch `overlay/core-patches` | rebased on each Nous main pull |
| `apps/` | stays here | standalone apps (browser extension, mobile) |

## Install

```bash
./install.sh                    # dry run against ~/.hermes-webapp
./install.sh --apply            # create the symlinks
./install.sh --apply ~/.hermes  # another Hermes home
```

The installer only creates symlinks. It never overwrites a real file or folder, and it never
touches `config.yaml`, `.env`, or the Hermes checkout.

## Update flow

1. `~/Code/hermes-deploy/sync-upstream.sh` moves `~/Code/hermes-nous-main` to the newest Nous main.
2. Rebase `overlay/core-patches` onto it (keep it tiny).
3. Restart the webapp gateway. The overlay symlinks keep working.

See `FEATURES.md` for what moves here and in what order.
