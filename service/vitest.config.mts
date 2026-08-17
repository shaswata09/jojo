import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * The package's own suite. Three configs now cover one source set: this one over
 * `service/`, web's over `web/src`, mobile's over `mobile/src`. No file is run
 * twice and the union is the coverage — which is why `include` below is
 * anchored at this package and does not reach up into the apps.
 *
 * `environment: 'node'` because nothing here renders. The graph, the reducer and
 * the tools are plain functions, and jsdom would cost seconds of startup per run
 * to provide a DOM the layer guards forbid these layers from touching. The
 * IndexedDB tests that DO need a browser-shaped world stayed in web with the
 * IndexedDB driver.
 */
export default defineConfig({
  resolve: {
    alias: {
      /*
       * TEMPORARY, and it mirrors the `paths` entry in tsconfig.base.json —
       * `repo/seed.ts` and `tools/memory.ts` compile the demo fixtures and the
       * fixtures are still `web/src/data`. Both mappings are deleted in the next
       * step, when the fixtures move to `service/data` and the 22 specifiers
       * become relative.
       */
      '@/data': path.resolve(import.meta.dirname, '../web/src/data'),
    },
  },
  test: {
    environment: 'node',
    include: ['kg/**/*.test.ts', 'data/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
