import esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  logLevel: 'info',
  sourcemap: watch ? 'inline' : false,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
}

const builds = [
  esbuild.context({
    ...shared,
    entryPoints: ['src/background/sw.ts'],
    outfile: 'background.js',
    format: 'esm', // MV3 service worker with "type": "module"
  }),
  esbuild.context({
    ...shared,
    entryPoints: ['src/content/content.ts'],
    outfile: 'content.js',
  }),
  esbuild.context({
    ...shared,
    entryPoints: ['src/options/options.ts'],
    outfile: 'options.js',
  }),
]

const ctxs = await Promise.all(builds)
if (watch) {
  await Promise.all(ctxs.map(c => c.watch()))
  console.log('[bot-room] watching for changes')
} else {
  await Promise.all(ctxs.map(c => c.rebuild()))
  await Promise.all(ctxs.map(c => c.dispose()))
}
