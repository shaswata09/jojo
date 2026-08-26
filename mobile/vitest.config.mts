import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * The test runner, for what is left of this app's own code.
 *
 * It used to cover 21 copied graph-layer test files plus `tools/coverage.test.ts`
 * — 333 tests, of which roughly 313 re-ran assertions the web app was already
 * making about the same source. That copy is gone: the graph layer is
 * `@jojo/service` and its suite runs there, once. What remains under `src/kg` is
 * `storage/rn-driver.ts`, the one genuinely platform-specific file in this
 * repo, and `storage/rn-conformance.test.ts`, which runs the SHARED `Driver`
 * contract over it. That file is the reason `src/kg` is still in the glob.
 *
 * `environment: 'node'`. Neither of the two included directories touches a DOM
 * or a React Native API — `rn-driver` reaches AsyncStorage through a mock — and
 * a runner that had to boot a React Native environment to exercise them would be
 * evidence that property had been lost.
 *
 * `src/theme` joined them, for one file. `tokens.ts` is numbers — no DOM, no
 * React Native API, nothing to render — and `slopFor` is the rule that decides
 * how big a control is under a thumb. There is no way to MEASURE a rendered
 * target here, which is exactly why the arithmetic behind them should not also
 * go unchecked: a `slopFor` that quietly stopped reaching 44 would leave every
 * call site reading correctly and every target too small.
 *
 * Still scoped to those three, and the screens are still out. They
 * are React Native components, and testing them needs a renderer, a native
 * module mock table and a decision about which of the two this project wants.
 * The cost of leaving them out is higher than it was: with the graph layer gone
 * from this package, `buildMonth`'s today marker and the label-tone swatches are
 * the sort of thing only a person looking at a phone will catch, which is why
 * the migration carries a written behavioural checklist alongside this file.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/kg/**/*.test.ts', 'src/lib/**/*.test.ts', 'src/theme/**/*.test.ts'],
  },
})
