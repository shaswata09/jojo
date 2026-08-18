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
    /*
     * One React in the bundle, and under the workspace this has to be said.
     *
     * `mobile/` pins react 19.1.0 (Expo 54 / RN 0.81) and this app needs
     * >=19.2.7 for react-router, so the two genuinely cannot meet — npm hoists
     * mobile's copy to the root and nests web's. That is correct, and harmless
     * only for as long as nothing pulls the hoisted one into THIS bundle.
     *
     * `@jojo/service/react` is what changed the risk: it lives outside this
     * package and resolves its own `react`, so without deduping, a shared hook
     * and the component calling it could hold different React instances — which
     * surfaces as "invalid hook call" or, worse, two separate dispatchers with
     * silently unshared context.
     *
     * `tsconfig.app.json` pins the TYPE side through `paths` for the same
     * reason; this is the runtime half of that pair.
     */
    dedupe: ['react', 'react-dom'],
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
