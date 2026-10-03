// macOS port of boot.cjs — boots the real Hermes desktop app (vite dev server +
// real Electron via playwright-core) in an isolated sandbox HERMES_HOME against
// the demo mock model. Requires `npm run dev:renderer` on 127.0.0.1:5174 and a
// built `dist/electron-main.mjs` (tsc --build tsconfig.electron.json &&
// node scripts/bundle-electron-main.mjs --dev).
const { _electron } = require('/Users/devin/repos/hermes-agent-contrib/node_modules/playwright-core')
const fs = require('fs'), path = require('path'), cp = require('child_process')
const REPO = '/Users/devin/repos/hermes-agent-contrib', DESK = REPO + '/apps/desktop', D = __dirname

exports.boot = async function boot({ recordDir, fresh = true, scale = 1, W = 1600, H = 1200, plugins = [] } = {}) {
  const root = path.join(D, 'sandbox-mac')
  if (fresh) fs.rmSync(root, { recursive: true, force: true })
  const home = path.join(root, 'hermes-home'), userData = path.join(root, 'electron-user-data')
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(path.join(userData, 'window-state.json'),
    JSON.stringify({ x: 0, y: 0, width: Math.round(W / scale), height: Math.round(H / scale), isMaximized: false }))
  fs.writeFileSync(path.join(userData, 'zoom-state.json'), JSON.stringify({ zoomLevel: 0 }))
  if (fresh) fs.writeFileSync(path.join(home, 'config.yaml'), [
    'model:', '  default: demo-model', '  provider: custom', '  base_url: http://127.0.0.1:18999/v1', '  context_length: 64000',
    'custom_providers:', '  - name: Demo', '    base_url: http://127.0.0.1:18999/v1', '    key_env: OPENAI_API_KEY',
    'auxiliary:', '  title_generation:', '    enabled: false',
    'approvals:', '  mode: "off"', '_config_version: 49', ''
  ].join('\n'))
  for (const p of plugins) {
    const dir = path.join(home, 'desktop-plugins', p.id)
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(p.src, path.join(dir, 'plugin.js'))
  }
  fs.writeFileSync(path.join(home, '.env'), 'OPENAI_API_KEY=demo-key\nOPENAI_BASE_URL=http://127.0.0.1:18999/v1\n')
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (/_API_KEY$|_TOKEN$/.test(k)) delete env[k]
  Object.assign(env, {
    HERMES_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: userData, HERMES_DESKTOP_IGNORE_EXISTING: '1',
    HERMES_DESKTOP_ISOLATED_BACKEND: '1', HOME: root, HERMES_DESKTOP_HERMES_ROOT: REPO,
    HERMES_DESKTOP_APP_NAME: 'HermesDemo', HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1',
    HERMES_DESKTOP_DEV_SERVER: 'http://127.0.0.1:5174',
    OPENAI_API_KEY: 'demo-key',
    PATH: `${REPO}/.venv/bin:${process.env.PATH}`, HERMES_PYTHON: REPO + '/.venv/bin/python'
  })
  const app = await _electron.launch({
    executablePath: DESK + '/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    args: [DESK, `--force-device-scale-factor=${scale}`],
    env, cwd: DESK,
    ...(recordDir ? { recordVideo: { dir: recordDir, size: { width: Math.round(W / scale), height: Math.round(H / scale) } } } : {})
  })
  const page = await app.firstWindow()
  return { app, page, home, root }
}
