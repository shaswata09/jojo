import path from 'node:path'
// `vitest/config` rather than `vite`: it is the same `defineConfig` widened to
// accept the `test` block below. Imported from 'vite', `test` is an excess
// property and the config fails to typecheck.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  /**
   * Vitest reads this file, so the `@/` alias above is the one the tests get —
   * there is no second copy to keep in step.
   *
   * `environment: 'node'` because nothing under test renders. The graph, the
   * reducer and the whole of `src/kg` are plain functions, and jsdom would cost
   * seconds of startup per run to provide a DOM none of them touch. A test that
   * needs IndexedDB imports `fake-indexeddb/auto` itself rather than paying for
   * a browser-shaped environment globally.
   */
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
