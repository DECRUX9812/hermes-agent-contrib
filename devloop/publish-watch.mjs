// Auto-publish watcher: rebuild apps/desktop/dist-webapp whenever renderer
// source changes, so a browser refresh of the live site shows the edit.
//
// Why this is enough for the live origin: the dashboard server reads
// index.html (and the hashed assets it points at) off disk per request, so a
// finished build is served on the next refresh with NO service restart.
//
// Cost is a full rolldown build (~70s on this host, React Compiler babel pass
// dominates). For sub-second iteration use devloop/webapp-dev.sh instead.
//
// Usage: devloop/publish-watch.mjs [--once]
import { spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const WATCH = [join(REPO, 'apps/desktop/src'), join(REPO, 'apps/shared/src')]
const DEBOUNCE_MS = 2500

let building = false
let dirty = false
let timer = null

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function build(reason) {
  if (building) {
    dirty = true

    return
  }
  building = true
  console.log(`[${stamp()}] build:webapp — ${reason}`)
  const started = Date.now()
  const child = spawn('npm', ['run', 'build:webapp', '--', '--no-install'], {
    cwd: join(REPO, 'apps/desktop'),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let tail = ''
  const keep = (buf) => { tail = (tail + buf.toString()).slice(-2000) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  child.on('exit', (code) => {
    building = false
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    if (code === 0) {
      console.log(`[${stamp()}] published in ${secs}s — refresh desktop.decruxtech.com`)
    } else {
      console.error(`[${stamp()}] BUILD FAILED (exit ${code}) after ${secs}s\n${tail}`)
    }
    if (dirty) {
      dirty = false
      build('changes landed during the build')
    }
  })
}

if (process.argv.includes('--once')) {
  build('manual run')
} else {
  for (const dir of WATCH) {
    if (!existsSync(dir)) continue
    watch(dir, { recursive: true }, (_event, name) => {
      if (!name || !/\.(ts|tsx|css|json)$/.test(String(name))) return
      clearTimeout(timer)
      timer = setTimeout(() => build(`changed ${name}`), DEBOUNCE_MS)
    })
  }
  // A watcher that silently dies is worse than no watcher: say it is up.
  console.log(`[${stamp()}] watching ${WATCH.map((p) => p.replace(REPO + '/', '')).join(', ')}`)
  console.log(`[${stamp()}] dist target: apps/desktop/dist-webapp (served by hermes-webapp-test.service on :9129)`)
  // Always publish once at start so the live bundle matches the checkout even if
  // nothing is edited during this session.
  build(existsSync(join(REPO, 'apps/desktop/dist-webapp/index.html')) ? 'startup catch-up' : 'initial')
}
