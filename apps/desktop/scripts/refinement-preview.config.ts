import { resolve } from 'node:path'
import { defineConfig, mergeConfig } from 'vite'

import desktopConfig from '../vite.config'

export default defineConfig(async env => {
  const base = typeof desktopConfig === 'function' ? await desktopConfig(env) : await desktopConfig
  return mergeConfig(base, {
    build: {
      outDir: 'dist-review',
      target: 'esnext',
      rolldownOptions: { input: resolve('refinement-preview.html') }
    }
  })
})
