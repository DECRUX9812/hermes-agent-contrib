/**
 * Fast, dependency-free vitest project for the orchestrator module.
 *
 * `src/orchestrator/**` is pure TypeScript — no React, no DOM, no gateway, no
 * locale catalogs. It should not need the app's full prepare step (or the 28
 * minute ui gate) to be tested. This config runs it in a node environment with
 * only the files it owns, so the loop is seconds:
 *
 *   cd apps/desktop && npx vitest run --config vitest.orchestrator.config.ts
 *
 * Kept separate from `vite.config.ts` on purpose: that config pulls the app's
 * plugin chain (rolldown/babel), which is exactly what a pure module does not
 * need and what a fresh worktree cannot resolve.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/orchestrator/**/*.test.ts'],
    reporters: ['default']
  }
})
