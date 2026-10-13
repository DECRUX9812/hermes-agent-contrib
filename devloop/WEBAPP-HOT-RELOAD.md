# Webapp hot reload (desktop.decruxtech.com)

Everything here is about the **browser-hosted Desktop** surface — the one the
Cloudflare tunnel publishes. It is *not* the Electron dev loop (see
`DEV-LOOP.md` for that).

## The pipeline (verified on this host)

```
browser  →  Cloudflare tunnel (9484af73…, ~/.cloudflared/config.yml)
              desktop.decruxtech.com → http://100.84.81.81:9129
         →  hermes-webapp-test.service   (systemd --user)
              hermes dashboard --isolated --host 100.84.81.81 --port 9129 --skip-build
              HERMES_HOME=/home/decrux/.hermes-webapp
              HERMES_WEB_DIST=/home/decrux/Code/hermes-webapp/apps/desktop/dist-webapp
         →  static bundle on disk (index.html + hashed assets)
```

Two consequences worth knowing:

* **The site is a build artifact.** `dist-webapp/` is gitignored and produced by
  `npm run build:webapp`. Nothing rebuilds it automatically — not the service
  (`--skip-build`), not a file watcher. If you edit `apps/desktop/src` and only
  refresh, you are looking at the last build, which is exactly how a session of
  Bot Mode work looked "missing" on the site.
* **No service restart is needed after a build.** `_serve_index()` reads
  `index.html` and the hashed assets off disk per request, so a finished build is
  live on the next refresh. (`sync-upstream.sh` restarts the unit anyway; that is
  harmless, not required.)

## Three ways to see an edit

### 1. Dev server with HMR — `devloop/webapp-dev.sh`

```bash
devloop/webapp-dev.sh                     # http://127.0.0.1:5174
devloop/webapp-dev-public.sh              # + https://dev.decruxtech.com (tunnel)
HERMES_DEV_NO_REACT_COMPILER=1 devloop/webapp-dev.sh   # faster cold start
HERMES_DEV_BACKEND=http://127.0.0.1:9129 devloop/webapp-dev.sh
```

Vite serves `apps/desktop` directly: modules are transformed on demand and
pushed to the page over HMR, so a save lands in well under a second with no
rebuild and no refresh. It is a real client of the real backend — `/api`,
`/api/ws`, `/login` and `/auth/*` are proxied to `:9129`, so the same
`HERMES_HOME`, the same bots and the same sessions are there.

It reuses `apps/desktop/vite.config.ts` unchanged and adds only two things: the
bootstrap globals the dashboard server normally injects into `index.html`
(`__HERMES_AUTH_REQUIRED__` is the load-bearing one — without it
`hasBrowserHostBootstrap()` never installs the `window.hermesDesktop` bridge),
and the `/api` proxy.

### Reaching it as `dev.decruxtech.com`

Wired into the **existing** tunnel, so `desktop.decruxtech.com` keeps serving the
production bundle and stays up whether or not the dev server runs:

```
~/.cloudflared/config.yml (tunnel 9484af73-…)
  - hostname: dev.decruxtech.com
    service: http://127.0.0.1:5174
```

DNS: `cloudflared tunnel route dns 9484af73-1972-4bd8-a451-f2ffe93e3f0b dev.decruxtech.com`
(one CNAME, already created). Then `systemctl --user restart hermes-web-tunnel.service`
(~10 s blip on every hostname of that tunnel).

`HERMES_DEV_PUBLIC_HOST=dev.decruxtech.com` (set by `webapp-dev-public.sh`) does
two things: whitelists the hostname in `server.allowedHosts` and pins
`server.ws` to `wss`/443 so the HMR socket survives Cloudflare. Verified
end-to-end over the public URL: save → page updates with **0 reloads**.

The bootstrap is **probed from the backend at startup**, so both flavours work:

* **gated** backend (`:9129`, `:9119` — any non-loopback bind) → injects
  `__HERMES_AUTH_REQUIRED__=true`. Sign in once at `/login` with the dashboard
  password; until then every `/api` call is 401 and the SPA redirects to `/login`.
* **loopback** backend (`auth_required:false`) → the token the backend prints on
  its own index page is injected, so the dev page is signed in with no prompt.

*First load* transforms ~1.7k modules (React Compiler babel pass dominates);
measured ~10 s cold on this host, then sub-second per edit.

### 2. Auto-publish to the live origin — `devloop/publish-watch.mjs`

```bash
node devloop/publish-watch.mjs        # watch + rebuild on save, then refresh the browser
node devloop/publish-watch.mjs --once # single catch-up build
```

Watches `apps/desktop/src` and `apps/shared/src`, debounces, and runs
`build:webapp` into `dist-webapp`. Save → ~70 s build → refresh
`desktop.decruxtech.com` and the change is there, with the real origin, the real
auth and no second URL. This is the path to use when the thing you are checking
only reproduces on the live site.

### 3. Manual publish

```bash
cd apps/desktop && npm run build:webapp -- --no-install
```

Measured **68 s** wall on this host (rolldown build; `@rolldown/plugin-babel` is
~53 % of it, `vite:asset` ~38 %).

## Gotchas that cost time before

* **Host header check.** The backend rejects any request whose `Host` is not the
  interface it bound to (`host_header_middleware`, `hermes_cli/web_server.py`).
  The dev proxy therefore needs `changeOrigin: true`; without it `/api` returns
  `400 Invalid Host header` and looks like a broken proxy. This is also why the
  tunnel entry sets `httpHostHeader`.
* **Auth lives outside `/api`.** `/login` renders the password page and `/auth/*`
  handles login/logout. The SPA is a hash router, so nothing in it claims those
  paths — proxy them or the dev origin can never sign in.
* **Dev never writes a build receipt.** `build:webapp` records
  `dist-webapp/hermes-build.json` (source + output hashes) so a stale bundle
  cannot be published under a current receipt. The dev server writes nothing, so
  a dev session can't half-publish `dist-webapp`. Editing a built `index.html` by
  hand (e.g. to inject a live-reload tag) *does* invalidate that receipt — the
  next non-`--skip-build` launch then rebuilds.
* **`--configLoader runner`** is required for a config that imports
  `apps/desktop/vite.config.ts`: the default config bundler CJS-interops
  `@rolldown/plugin-babel`'s default export into `not a function`. The build
  scripts pass the same loader.
* **`mergeConfig` concatenates plugin arrays.** Pass only the addition, or every
  base plugin registers twice (visible as a duplicated React Refresh preamble).
* **The backend trusts exactly ONE hostname — this is the big one.** 
  `trusted_public_hosts` comes from `dashboard.public_url` alone
  (`_dashboard_public_hosts()`, `hermes_cli/web_server.py`), and that single
  value gates **both** the HTTP `Host` check **and** the WebSocket `Origin`
  check (`_ws_host_origin_reason`, `web_server_chat.py`). Serve the same backend
  on any *second* hostname and the browser's WS upgrade is refused — the client
  reports `Could not connect to Hermes gateway (WebSocket error before open)`
  for every profile dial, while the original hostname keeps working. The dev
  proxy therefore rewrites `Origin` (and `changeOrigin` rewrites `Host`) to the
  trusted public host: `HERMES_DEV_TRUSTED_ORIGIN`, default
  `https://desktop.decruxtech.com`. The WS still requires a valid
  ticket/session, so this is not a loosening of the auth boundary.
* **Multiple connectors of one tunnel serve different configs.** Cloudflare
  load-balances across every running connector for a tunnel id, so a stale
  `cloudflared` left over from an earlier `nohup` keeps answering with the OLD
  ingress and its catch-all `http_status:404`. Symptom: a newly added hostname
  returns 404 while its sibling hostnames work, intermittently. Keep exactly one
  connector — the systemd-managed one — and kill the rest.
  (`pgrep -af "cloudflared tunnel"` to find them.)
* **`server.ws`, not `server.hmr`.** Vite 8 deprecates the `server.hmr.*`
  protocol/host/port/clientPort keys in favour of `server.ws.*`; same values,
  new key.
* **Starting the app on a fresh `HERMES_HOME` prunes the checkout.** An isolated
  `hermes dashboard` (or `hermes webapp`) prepares dependencies with
  `npm ci --workspace …` **against the repo root** (`scripts/build/node-deps.mjs`),
  and `npm ci` wipes `node_modules` first — so dev-only packages that are not in
  the selected workspaces disappear. Observed: `playwright`, `@playwright/test`
  and `@rolldown/plugin-babel` removed, which breaks the dev tooling and the
  Vite config. Recover with `npm install` at the repo root.

## Files

| Path | What |
| --- | --- |
| `devloop/webapp-dev.sh` | launcher for the HMR dev server |
| `devloop/webapp-dev.config.ts` | dev-only Vite config (bootstrap injection + proxy) |
| `devloop/publish-watch.mjs` | save → rebuild `dist-webapp` watcher |
