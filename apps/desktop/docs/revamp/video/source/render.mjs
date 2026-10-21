import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chromium } from '/home/user/hermes-agent-contrib/node_modules/playwright-core/index.mjs'
const [, , idx, of, fps, out, W = '1920', H = '1080', page = 'index.html'] = process.argv
const FF = readFileSync('ff.path', 'utf8').trim()
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: +W, height: +H } })
p.on('pageerror', e => console.error('pageerror', String(e)))
await p.goto(`http://127.0.0.1:5301/${page}`, { waitUntil: 'networkidle' })
await p.evaluate(() => window.ready)
const dur = await p.evaluate(() => window.DURATION)
const total = Math.round(dur * +fps), per = Math.ceil(total / +of), a = +idx * per, z = Math.min(total, a + per)
const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', fps, '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-g', fps, out], { stdio: ['pipe', 'inherit', 'inherit'] })
for (let i = a; i < z; i++) {
  await p.evaluate(t => render(t), i / +fps)
  const buf = await p.screenshot({ type: 'jpeg', quality: 97 })
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r))
  if ((i - a) % 120 === 0) console.log(`w${idx} ${i - a}/${z - a}`)
}
ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close(); console.log(`w${idx} done`)
