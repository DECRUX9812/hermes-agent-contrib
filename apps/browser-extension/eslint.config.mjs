import config from '../../eslint.config.shared.mjs'

export default [
  {
    // Build outputs at the app root are esbuild bundles, not source.
    ignores: ['background.js', 'content.js', 'options.js'],
  },
  ...config,
]
