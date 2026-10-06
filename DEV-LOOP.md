# Desktop Dev Loop (hot reload)

Verified working on this host: 2026-10-04, repo `main` @ `6093b46577`.
Every command below was actually run.

## What this is for

`/opt/hermes-desktop/Hermes` is a **packaged, standalone** build. It loads its own
renderer bundle from inside its own `app.asar` and its own filesystem/mount
namespace — it never reads `apps/desktop/src`. So editing repo source has **zero
effect** on that running window. That is the hot-reload failure, and no amount of
rebuilding `apps/desktop/dist` changes it.

To iterate on frontend code you run a **second** desktop instance from the repo,
with its renderer served by vite. Saving a `.ts`/`.tsx` file then updates the UI
without a rebuild or a restart.

## 1. One-time prerequisites

```bash
cd /home/decrux/.hermes/hermes-agent
node apps/desktop/scripts/assert-root-install.mjs   # must exit 0
```

It verifies the hoisted root install covers everything the build consumes and that
`react` and `react-dom` resolve to the *same* installed version (a split pair
throws Minified React error #527 and renders a blank window before first paint).

## 2. Environment

Do not reuse the live profile. An isolated `HERMES_HOME` + user-data-dir keeps the
dev instance off the running gateway/webapp on `:9119` / `:9129`.

```bash
cat > "$TMPDIR/devloop-env.sh" <<'EOF'
export REPO=/home/decrux/.hermes/hermes-agent
export D="$TMPDIR/hermes-devloop"
mkdir -p $D/.hermes/shared $D/userdata $D/work

export DISPLAY=:103                       # any X display; see §5
export HERMES_HOME=$D/.hermes
export HERMES_DESKTOP_USER_DATA_DIR=$D/userdata
export HERMES_DESKTOP_CWD=$D/work
export HERMES_DESKTOP_HERMES_ROOT=$REPO   # pin the checkout the backend runs from

# NOT $REPO/venv/bin/python -- that tree is broken; see "Backend" below.
export HERMES_DESKTOP_PYTHON=$(ls -d /home/decrux/.hermes/tools/python-3.14.7*/bin/python3 | head -1)

export HERMES_DESKTOP_CDP_PORT=9344       # renderer debugger; 'off' to disable
export HERMES_GUEST_ONBOARDING=1
export HERMES_DESKTOP_IGNORE_EXISTING=1
export HERMES_DISABLE_LAZY_INSTALLS=1      # see "Backend" below
EOF
source "$TMPDIR/devloop-env.sh"
```

`HERMES_DESKTOP_HERMES_ROOT` and `HERMES_DESKTOP_PYTHON` are what make the spawned
`hermes serve` backend run *this* checkout's code. Without them the app resolves a
packaged/managed install instead.

If you have no X display, start a throwaway one (do not reuse `:99`/`:100`/`:101`,
which belong to other things on this host):

```bash
Xvfb :103 -screen 0 1920x1080x24 -ac -nolisten tcp \
  -extension RENDER +extension GLX +extension COMPOSITE +extension XINERAMA \
  -fp built-ins -br &
DISPLAY=:103 xdpyinfo | head -3
```

## 3. Start the loop

```bash
source "$TMPDIR/devloop-env.sh"
cd $REPO/apps/desktop
npx tsc --build tsconfig.electron.json      # electron main -> build/electron-types
node scripts/bundle-electron-main.mjs --dev # main/preload -> dist/
npx vite --host 127.0.0.1 --port 5174       # renderer dev server
```

Then, in a second shell with the same env:

```bash
source "$TMPDIR/devloop-env.sh"
cd $REPO/apps/desktop
XCURSOR_SIZE=24 HERMES_DESKTOP_DEV_SERVER=http://127.0.0.1:5174 \
  npx electron . --no-sandbox --disable-gpu --disable-dev-shm-usage
```

`HERMES_DESKTOP_DEV_SERVER` is the real switch (read at `electron/main.ts:715` as
`DEV_SERVER`). It also opens the renderer debugger on `HERMES_DESKTOP_CDP_PORT`
and registers the `hermes-dev://` scheme; with it unset the app behaves like the
packaged build and loads `dist/`.

### `--no-sandbox` is required on this host

Without it Electron aborts:

```
FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166] The SUID sandbox
helper binary was found, but is not configured correctly.
```

`node_modules/electron/dist/chrome-sandbox` is not `root`-owned mode `4755` here.
The packaged app is launched the same way (`xpra … --start-child=/opt/hermes-desktop/Hermes
--no-sandbox`), and `e2e/fixtures.ts` passes the same flags. Fixing it properly
needs `sudo chown root:root chrome-sandbox && chmod 4755`.

### `npm run dev` does not work as-is here

`npm run dev` = `concurrently dev:renderer dev:electron`. Both halves work, but
`dev:electron` runs a bare `electron .` with no `--no-sandbox`, so it dies with the
FATAL above and `-k` tears down vite with it. Run the steps in §3 separately, or
patch the script to append the flags.

First load is slow (~3–5 min): vite dev transforms ~1500 modules on demand. The
window shows the boot screen ("Starting Hermes Desktop…") while that happens. This
is a cold-start cost only — later edits apply in about a second.

## 3a. Backend: two real blockers

The renderer hot-reloads regardless, but the window only reaches a usable chat
surface once the spawned `hermes serve` backend comes up. Two things on this host
stop it. Both are fixed by the env in §2.

**1. `$REPO/venv/bin/python` is broken.** Pointing `HERMES_DESKTOP_PYTHON` at the
repo venv makes the backend die in ~6s:

```
The dashboard can't start: its web-server packages (fastapi, uvicorn) are missing
Details: No module named 'pydantic_core._pydantic_core'
```

**2. The lazy source-update retry loop outlasts the app's patience.** With the
default env, each backend launch stalls for minutes printing
`hermes: a source update could not be finished automatically (6 attempts)`
(`hermes_cli/venv_sync.py:390`) and never announces a port, so the renderer
reports `Timed out waiting for Hermes backend port announcement (90000ms)`.
`HERMES_DISABLE_LAZY_INSTALLS=1` skips that tail (`venv_sync.py:364`).

With both set, the backend announces in ~13s:

```
[boot] Hermes backend is ready. Finalizing desktop startup
HERMES_BACKEND_READY port=<random>
```

A `⚠ install out of sync (ffmpeg: not installed or outdated; venv: out of sync with
uv.lock)` line is printed and is harmless for renderer work — the backend serves
fine. Fixing it properly means `hermes pm install`, which is out of scope here and
would touch the live install's dependencies.

## 4. Verify hot reload

Attach to the renderer over CDP — `http://127.0.0.1:9344/json/list` gives the
page's `webSocketDebuggerUrl` — and evaluate in the live page. Edit something that is unconditionally on screen, then read it back out of the live
page over CDP:

```bash
# add data-hmr-probe="9274" to a rendered element, e.g. the intro wrapper in
# src/components/chat/intro.tsx (data-slot="aui_intro")
node "$TMPDIR/cdp-eval.mjs" \
  'document.querySelector(\'[data-hmr-probe="9274"]\') ? "HMR_OK" : "HMR_FAIL"'
```

Confirmed on this host, twice:

- boot screen — an `en.ts` string edit and a `guide-loading.tsx` DOM node both
  appeared in the running window within ~10s, no rebuild, no restart;
- fully-booted chat surface — the same `.tsx` probe on `intro.tsx` appeared while
  the backend was live.

Reverting with `git checkout --` removed both from the running window in both
cases; the app did not need a reload.

Gotcha: the composer placeholder rotates randomly from a pool, so a one-string
edit there may not be the one currently rendered. Assert on a stable element, or
confirm vite is serving the edit with
`fetch('/src/i18n/en.ts').then(r => r.text()).then(t => t.includes('MARKER'))`.

`$TMPDIR/cdp-eval.mjs` is a ~40-line `Runtime.evaluate` client (uses `ws` from the
repo's root `node_modules`). It is scratch tooling, not committed; use any CDP
client against `HERMES_DESKTOP_CDP_PORT` instead.

`apps/desktop/scripts/connector-rehearsal.mjs` is the in-repo harness for the same
thing with a fixed port (5194) and CDP (9344); it needs `HERMES_DESKTOP_PYTHON` set.

## 5. Stop

Vite and Electron are foreground processes — Ctrl-C each. If either is orphaned:

```bash
pkill -f "electron/dist/electron .*--no-sandbox"
pkill -f "vite --host 127.0.0.1 --port 5174"
```

Ports 5174 (renderer) and 9344 (CDP) must be free before the next start; vite is
`strictPort`, so it will not fall back to another port.

## 6. Fall back to the packaged app

Close the dev instance and use `/opt/hermes-desktop/Hermes` as before. Nothing in
the dev loop writes to it. To smoke-test the packaged path from source instead,
run `electron .` **without** `HERMES_DESKTOP_DEV_SERVER` — it then loads
`apps/desktop/dist` and behaves like the packaged app (no CDP, per `dev-cdp.ts`).

## What is and isn't fixed

The **dev loop is fixed and verified**. The **packaged app's blank window is
diagnosed, not fixed** — the cause is its own connection config, and fixing it
means changing the user's saved connection in
`/home/streamuser/.config/Hermes/`, which is their call, not a build fix.

The renderer bundle is *also* stale in the packaged app (4000 commits behind), but
that is not what the blank window is.

## Note on the blank blue window

The packaged app's blank/blue window is **not** a stale renderer bundle. Its log
(`/home/streamuser/.hermes/logs/desktop.log`) shows the renderer running and
retrying REST calls that all fail:

```
[hermes:api GET /api/plugins/…] Error: Remote Hermes gateway uses OAuth, but you
are not signed in. Open Settings → Gateway and click "Sign in", or switch back to Local.
```

`/home/streamuser/.config/Hermes/connections.json` has `primary` =
`100-84-81-81-9119` with `"authMode": "oauth"`, so the app is pointed at the
remote gateway on `:9119` and is unauthenticated against it. The renderer itself
loads and runs; every data call fails, so the window paints empty. That is a
configuration/sign-in state, not a build problem.

The user can resolve it in the running app: **Settings → Gateway → Sign in**, or
switch the connection back to Local. Either is a decision about which backend they
want, so it is left to them.

## If the packaged app ever needs a rebuild

`/opt/hermes-desktop/resources/` is byte-identical to
`apps/desktop/release/linux-unpacked/resources/` — both from commit
`2a05208012`, built 2026-09-26, i.e. ~4000 commits behind `main`. It is a copy of
`npm run dist:linux`'s unpacked output. Refreshing it means rebuilding that target
and replacing `/opt/hermes-desktop` wholesale; do not do that without explicit
instruction. Per `apps/desktop/BUILDING.md`, Linux desktop *release* legs are
disabled — the local builder produces an AppImage.