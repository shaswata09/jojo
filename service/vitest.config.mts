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

    /**
     * What the coverage number is a number OF.
     *
     * `npm run test:coverage`. Two exclusions, and both are the difference
     * between a figure someone can act on and one they learn to ignore.
     *
     * `kg/react/use-*.ts` are React hooks. This suite is `environment: 'node'`
     * and renders nothing, so every one of them sits at 0% and drags the total
     * down by about nine points — not because they are untested in effect, but
     * because they are thin wrappers over the tools underneath, and those tools
     * are covered here directly. Counting them scores this suite on work it is
     * not the right suite to do. If they ever get a renderer, delete this line
     * before the tests, not after.
     *
     * `*-conformance.ts` are test HARNESSES — the shared driver and file-store
     * suites that web and mobile run against their own implementations. Their
     * uncovered branches are the harness's own failure paths, which only fire
     * when an implementation is broken. Measuring a ruler with itself.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['kg/**/*.ts'],
      exclude: ['**/*.test.ts', 'kg/react/use-*.ts', 'kg/**/*-conformance.ts'],
    },
  },
})
