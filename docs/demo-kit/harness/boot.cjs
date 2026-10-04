// Boot the real Hermes desktop app for the demo: isolated sandbox, demo mock model, MCP launch app.
const { _electron } = require('/home/user/hermes-agent-contrib/node_modules/playwright-core')
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process')
const REPO = '/home/user/hermes-agent-contrib', DESK = REPO + '/apps/desktop', D = __dirname

// hire: seed only the project; the main bot creates the crew on camera. scale: device pixels per DIP.
exports.boot = async function boot({ recordDir, fresh = true, seed = true, hire = false, history = false, scale = 1, W = 1600, H = 1000 } = {}) {
  const root = path.join(D, 'sandbox')
  if (fresh) fs.rmSync(root, { recursive: true, force: true })
  const home = path.join(root, 'hermes-home'), userData = path.join(root, 'electron-user-data')
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(path.join(root, 'projects', 'launch-site'), { recursive: true })
  fs.writeFileSync(path.join(userData, 'window-state.json'), JSON.stringify({ x: 0, y: 0, width: Math.round(W / scale), height: Math.round(H / scale), isMaximized: false }))
  fs.writeFileSync(path.join(userData, 'zoom-state.json'), JSON.stringify({ zoomLevel: 0 }))
  // A 4-bot crew + the main bot: room for every seat (Settings > Backends); the default 3 retires bots mid-demo.
  fs.writeFileSync(path.join(userData, 'pool-limits.json'), JSON.stringify({ maxBackends: 6, idleMs: 600000 }))
  if (fresh) fs.writeFileSync(path.join(home, 'config.yaml'), [
    'model:', '  default: demo-model', '  provider: custom', '  base_url: http://127.0.0.1:18999/v1', '  context_length: 64000',
    'custom_providers:', '  - name: Demo', '    base_url: http://127.0.0.1:18999/v1', '    key_env: OPENAI_API_KEY',
    'auxiliary:', '  title_generation:', '    enabled: false',
    'approvals:', '  mode: "off"', '_config_version: 49',
    'mcp_servers:', '  launch:', `    command: ${REPO}/.venv/bin/python`, `    args: ["${D}/launch_app_server.py"]`, ''
  ].join('\n'))
  if (fresh && seed && !hire) {
    const cli = (...a) => cp.execFileSync(REPO + '/.venv/bin/python', ['-m', 'hermes_cli.main', 'bots', ...a],
      { cwd: REPO, env: { ...process.env, HERMES_HOME: home, HOME: root }, stdio: 'pipe' }).toString().trim()
    cli('create', 'scout', '--title', 'Scout', '--role', 'Research lead — finds, reads and cites', '--persona', 'Cite every claim.')
    cli('create', 'forge', '--title', 'Forge', '--role', 'Engineer — small, tested diffs')
    cli('create', 'pilot', '--title', 'Pilot', '--role', 'Ops — checks, schedules and deploys')
    cli('team', 'create', 'Launch crew', '--mission', 'Ship v2 on Thursday')
    cli('team', 'add', 'Launch crew', 'scout', '--lead', '--title', 'Lead')
    cli('team', 'add', 'Launch crew', 'forge', '--reports-to', 'scout', '--title', 'Engineer')
    cli('team', 'add', 'Launch crew', 'pilot', '--reports-to', 'scout', '--title', 'Ops')
  }
  if (fresh && seed) {
    cp.execFileSync(REPO + '/.venv/bin/python', ['-m', 'hermes_cli.main', 'project', 'create', 'Launch site', path.join(root, 'projects', 'launch-site'), '--color', '#7c5cff'],
      { cwd: REPO, env: { ...process.env, HERMES_HOME: home, HOME: root }, stdio: 'pipe' })
  }
  // A week of past usage (Spend page), recorded through SessionDB's own accounting.
  if (fresh && history) cp.execFileSync(REPO + '/.venv/bin/python', [path.join(D, 'seed_history.py'), home],
    { cwd: REPO, env: { ...process.env, HERMES_HOME: home, HOME: root }, stdio: 'pipe' })
  fs.writeFileSync(path.join(home, '.env'), 'OPENAI_API_KEY=demo-key\nOPENAI_BASE_URL=http://127.0.0.1:18999/v1\n')
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (/_API_KEY$|_TOKEN$/.test(k)) delete env[k]
  Object.assign(env, {
    HERMES_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: userData, HERMES_DESKTOP_IGNORE_EXISTING: '1',
    HERMES_DESKTOP_ISOLATED_BACKEND: '1', HOME: root, HERMES_DESKTOP_HERMES_ROOT: REPO,
    HERMES_DESKTOP_APP_NAME: 'HermesDemo', HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1',
    OPENAI_API_KEY: 'demo-key', XDG_RUNTIME_DIR: path.join(root, 'xdg'),
    PATH: `${REPO}/.venv/bin:${process.env.PATH}`, HERMES_PYTHON: REPO + '/.venv/bin/python', NODE_EXTRA_CA_CERTS: '/root/.ccr/ca-bundle.crt'
  })
  fs.mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 })
  const app = await _electron.launch({
    executablePath: DESK + '/node_modules/electron/dist/electron',
    args: [DESK, '--disable-gpu', '--no-sandbox', `--force-device-scale-factor=${scale}`],
    env, cwd: DESK,
    ...(recordDir ? { recordVideo: { dir: recordDir, size: { width: Math.round(W / scale), height: Math.round(H / scale) } } } : {})
  })
  const page = await app.firstWindow()
  return { app, page, home, root }
}

if (require.main === module) {
  (async () => {
    const { app, page } = await exports.boot({})
    page.on('console', m => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 200)) })
    for (let i = 0; i < 24; i++) { await page.waitForTimeout(5000); await page.screenshot({ path: D + '/boot.png' }); 
      const t = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => ''); console.log(i, JSON.stringify(t.replace(/\s+/g, ' ').slice(0, 160)))
      if (/Ask|Message|New chat|Bots/.test(t) && i > 3) break }
    await app.close()
  })().catch(e => { console.error(e); process.exit(1) })
}
