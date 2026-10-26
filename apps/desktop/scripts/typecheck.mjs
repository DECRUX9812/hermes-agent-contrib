// Typecheck every tsconfig the Desktop ships, with a heap that can hold them.
//
// `tsc -p .` on this project peaks around 2 GB of V8 heap and OOMs
// ("Ineffective mark-compacts near heap limit") on Node's default ~4 GB
// old-space ceiling once the whole src graph is in memory — reliably so in a
// container or a busy host. Raising the ceiling here (not in the caller's
// environment) keeps `npm run typecheck` working for a fresh checkout and for
// CI, on every platform: NODE_OPTIONS is set for the child, so no shell
// prefixing and no cross-env dependency.
import { spawnSync } from 'node:child_process'

const STEPS = [
  ['tsc', ['-p', '.', '--noEmit']],
  ['tsc', ['-p', 'tsconfig.electron.json', '--noEmit']],
  ['tsc', ['-p', 'tsconfig.e2e.json', '--noEmit']],
  [
    'tsc',
    [
      '--ignoreConfig',
      '--allowJs',
      '--checkJs',
      '--noEmit',
      '--skipLibCheck',
      '--module',
      'nodenext',
      '--moduleResolution',
      'nodenext',
      '--target',
      'es2022',
      'electron-builder.config.cjs'
    ]
  ]
]

// 10 GiB: comfortably above the observed ~2 GB peak, still modest for a
// developer machine. V8 only commits what it touches.
const heap = '--max-old-space-size=10240'
const env = { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, heap].filter(Boolean).join(' ') }

for (const [command, args] of STEPS) {
  const result = spawnSync(command, args, { env, stdio: 'inherit', shell: process.platform === 'win32' })

  if (result.error) {
    console.error(`typecheck: could not run ${command} ${args.join(' ')}: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
