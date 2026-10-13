// Hot-reload dev server for the browser-hosted Desktop ("Webapp") surface.
//
// The live site (desktop.decruxtech.com) is a *static bundle*: the dashboard
// server serves apps/desktop/dist-webapp, so a source edit only appears after a
// full `npm run build:webapp` (~70s) plus a browser refresh. This config runs
// the renderer through Vite's dev server instead: modules are transformed on
// demand and pushed to the page over HMR, so a save shows up in well under a
// second.
//
// It reuses apps/desktop/vite.config.ts verbatim (aliases, react dedupe,
// tailwind, emojibase/excalidraw middleware, React Compiler) and adds only what
// a browser-hosted dev page needs:
//
//   1. the bootstrap globals the dashboard server normally injects into
//      index.html — without them the renderer does not classify itself as
//      browser-hosted and never installs the window.hermesDesktop bridge;
//   2. a proxy for /api (+ /api/ws), /login and /auth/* to a running backend, so
//      the dev page is a real client of a real backend (same HERMES_HOME, same
//      bots, same sessions) instead of an empty shell.
//
// The bootstrap is probed from the backend at startup, so both flavours work:
//   * gated backend  (:9129, :9119 — non-loopback bind) → inject
//     __HERMES_AUTH_REQUIRED__=true and sign in once at /login;
//   * loopback backend (auth_required:false) → inject the session token the
//     backend prints on its own index page, no sign-in needed.
//
// Usage: devloop/webapp-dev.sh
import { defineConfig, mergeConfig, type Plugin, type UserConfig } from 'vite'

import base from '../apps/desktop/vite.config'

const APP_ROOT = new URL('../apps/desktop', import.meta.url).pathname.replace(/\/$/, '')

/** Backend the dev page talks to. Default: the live webapp backend on :9129. */
const BACKEND = process.env.HERMES_DEV_BACKEND || 'http://100.84.81.81:9129'

/** Public hostname when the dev server is reached through the Cloudflare tunnel. */
const PUBLIC_HOST = (process.env.HERMES_DEV_PUBLIC_HOST || '').trim()

const PORT = Number(process.env.HERMES_DEV_PORT || 5174)

/**
 * The backend trusts exactly ONE public hostname: `dashboard.public_url`
 * (`_dashboard_public_hosts()` in hermes_cli/web_server.py). That single value
 * feeds BOTH the HTTP Host check and the WebSocket Origin check
 * (`_ws_host_origin_reason`, web_server_chat.py), so a page served from any
 * other hostname is refused at the WS upgrade — the browser reports
 * "WebSocket error before open" and every profile dial fails.
 *
 * The dev server is a different hostname by definition, so its proxied requests
 * present the deployment's trusted origin instead. This is not a loosening of
 * the auth boundary: the WS still needs a valid ticket/session cookie, and the
 * Host header is already rewritten to the bound interface by `changeOrigin`.
 */
const TRUSTED_ORIGIN = (process.env.HERMES_DEV_TRUSTED_ORIGIN || 'https://desktop.decruxtech.com').trim()

// Minimal structural types for the http-proxy hooks we attach (vite's proxy
// options are typed loosely here; we only need these two members).
interface OutgoingHeaders { setHeader: (name: string, value: string) => void }
interface ProxyEvents { on: (event: 'proxyReqWs', listener: (proxyReq: OutgoingHeaders) => void) => void }

const TOKEN_RE = /__HERMES_SESSION_TOKEN__\s*=\s*"((?:\\.|[^"\\])*)"/
const SURFACE_RE = /__HERMES_UI_SURFACE__\s*=\s*"([^"]*)"/

/**
 * Mirror what `_serve_index()` (hermes_cli/web_server_dashboard.py) injects for
 * this surface. `__HERMES_AUTH_REQUIRED__` is the load-bearing one:
 * `hasBrowserHostBootstrap()` (src/lib/platform.ts) keys the bridge install on
 * it, and `connectionFor()` (src/lib/browser-connection.ts) then picks the
 * scheme — gated cookie auth + /api/auth/ws-ticket, or a plain session token.
 */
async function bootstrapScript(): Promise<string> {
  const forced = process.env.HERMES_DEV_AUTH_REQUIRED
  let token = ''
  let surface = 'dashboard'

  if (forced !== '1') {
    try {
      const res = await fetch(`${BACKEND}/`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })

      if (res.status === 200) {
        const html = await res.text()
        token = (TOKEN_RE.exec(html)?.[1] || '').replace(/\\"/g, '"')
        surface = SURFACE_RE.exec(html)?.[1] || surface
      }
    } catch { /* fall through to the gated shape */ }
  }

  const gated = !token
  const lines = [
    `window.__HERMES_AUTH_REQUIRED__=${gated};`,
    "window.__HERMES_BASE_PATH__='';",
    `window.__HERMES_UI_SURFACE__='${surface}';`,
    'window.__HERMES_DASHBOARD_EMBEDDED_CHAT__=true;',
    "window.__HERMES_INITIAL_PROFILE__='';",
    "window.__HERMES_DASHBOARD_PROFILE__='default';"
  ]

  if (!gated) lines.push(`window.__HERMES_SESSION_TOKEN__=${JSON.stringify(token)};`)
  console.log(`[webapp-dev] backend ${BACKEND} → ${gated ? 'gated (sign in at /login once)' : 'token injected, no sign-in'}`)

  return lines.join('')
}

const bootstrapPlugin = (script: string): Plugin => ({
  name: 'hermes:webapp-dev-bootstrap',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => ({
      html,
      tags: [{ children: script, injectTo: 'head-prepend', tag: 'script' }]
    })
  }
})

const resolvedBase = (
  typeof base === 'function'
    ? (base as unknown as (env: Record<string, unknown>) => UserConfig)({
        command: 'serve',
        isPreview: false,
        isSsrBuild: false,
        mode: 'development'
      })
    : base
) as UserConfig

// The React Compiler pass (babel) is ~half of a cold transform. Keep it by
// default so dev matches the shipped renderer; skip it for a faster loop with
// HERMES_DEV_NO_REACT_COMPILER=1.
const basePlugins = resolvedBase.plugins || []
const plugins = process.env.HERMES_DEV_NO_REACT_COMPILER === '1'
  ? basePlugins.filter((plugin) => {
      const name = plugin && typeof plugin === 'object' ? String((plugin as { name?: string }).name || '') : ''

      return name !== '@rolldown/plugin-babel' && name !== 'babel'
    })
  : basePlugins

export default defineConfig(async () => {
  const script = await bootstrapScript()

  return mergeConfig({ ...resolvedBase, plugins }, {
    // The dev server owns the file watching; no build receipt is written, so a
    // dev session can never publish a half-built dist-webapp.
    root: APP_ROOT,
    // mergeConfig concatenates plugin arrays — pass only the addition, never the
    // base list again, or every base plugin (react refresh preamble included)
    // is registered twice.
    plugins: [bootstrapPlugin(script)],
    server: {
      allowedHosts: [
        '.decruxtech.com',
        '100.84.81.81',
        'localhost',
        ...(PUBLIC_HOST ? [PUBLIC_HOST] : [])
      ],
      // Through the tunnel the socket must be wss/443 (Cloudflare terminates
      // TLS); locally the default (page host) is right. Vite 8 key: server.ws.
      ws: PUBLIC_HOST
        ? { clientPort: 443, host: PUBLIC_HOST, protocol: 'wss' }
        : undefined,
      host: '127.0.0.1',
      port: PORT,
      proxy: {
        // `changeOrigin` is required: the backend rejects a Host header that is
        // not the interface it bound to (host_header_middleware, web_server.py).
        // `headers` + the `proxyReqWs` hook do the same for Origin — the WS
        // upgrade carries the page's origin, which must be the trusted public
        // hostname or the backend closes it before the RPC handshake.
        '/api': {
          changeOrigin: true,
          configure: (proxy: ProxyEvents) => {
            proxy.on('proxyReqWs', (proxyReq: OutgoingHeaders) => { proxyReq.setHeader('origin', TRUSTED_ORIGIN) })
          },
          headers: { origin: TRUSTED_ORIGIN },
          target: BACKEND,
          ws: true
        },
        // The auth gate lives outside /api: /login renders the password page and
        // /auth/* carries the login/logout/callback routes. Without these the
        // dev origin cannot sign in (the SPA is a hash router, so nothing in it
        // claims these paths) and every API call stays 401.
        '/auth': { changeOrigin: true, headers: { origin: TRUSTED_ORIGIN }, target: BACKEND },
        '/login': { changeOrigin: true, headers: { origin: TRUSTED_ORIGIN }, target: BACKEND }
      },
      strictPort: true
    }
  })
})
