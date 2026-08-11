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
    /**
     * Only so that `import css from '@/index.css?raw'` returns the stylesheet.
     *
     * Vitest stubs every id matching `.css` with an empty module by default,
     * and it matches on the id, so the `?raw` query does not escape it — the
     * import silently yields `''`. A test that reads an empty stylesheet finds
     * no tokens and no selectors, and then passes, which is the failure mode
     * this whole test suite exists to avoid.
     *
     * The cost is nil: no test imports a stylesheet for its styles, and the one
     * that reads `index.css` reads it as text. Turning this on does not put a
     * DOM anywhere — `environment` above is still `node`.
     */
    css: true,
  },
})
