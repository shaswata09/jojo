import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * The test runner, for `src/kg` and nothing else.
 *
 * The graph layer arrived here as a copy of the web app's, and its 21 test files
 * came with it. Running them matters more here than the copy did: "unchanged
 * from a covered codebase" is an argument, and an argument does not catch the
 * one thing that genuinely differs — a storage driver written for this platform
 * that has to satisfy the same contract IndexedDB's does.
 *
 * `environment: 'node'`, which is what the web app uses for these same files.
 * Nothing under `src/kg` touches a DOM or a React Native API, which is the
 * property that made the port possible in the first place; a test runner that
 * had to boot a React Native environment to exercise it would be evidence that
 * property had been lost.
 *
 * Scoped to `src/kg` and `src/lib` deliberately. Both are plain TypeScript with
 * no renderer in them. The screens are React Native components and
 * testing them needs a renderer, a native module mock table and a decision about
 * which of the two this project wants — none of which this config should quietly
 * pre-empt. What is here covers the layer that holds the rules.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/kg/**/*.test.ts', 'src/lib/**/*.test.ts'],
  },
})
