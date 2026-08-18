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
/*
 * There is no `resolve.alias` block, and its absence is the point. It used to
 * map `@/data` at `../web/src/data` so `repo/seed.ts` and `tools/memory.ts`
 * could reach the fixtures while they still lived in the web app. The fixtures
 * are `service/data` now and all 22 specifiers are relative, so the mapping and
 * its twin in tsconfig.base.json are both gone. Nothing replaces them: an alias
 * here would resolve for vitest and for nobody else, and Metro would keep
 * binding the same specifier to `mobile/src/data`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['kg/**/*.test.ts', 'data/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
