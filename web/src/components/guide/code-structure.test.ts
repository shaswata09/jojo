/**
 * The published measurements, re-measured.
 *
 * `CodeStructure` prints a table of files, tests and lines per directory and
 * argues, correctly, that "a line count in prose is stale within a week and
 * there is no way for a reader to tell". It then printed the command to re-run
 * and left the numbers to be re-run by hand, which is the same problem one
 * remove: the 2026-08 audit re-measured all twelve rows and found two already
 * wrong. A guide page is the one surface where a stale claim is invisible to
 * every gate and is read by somebody who cannot check it.
 *
 * So the rows this app can measure are measured here and the page fails the
 * build when they drift. `import.meta.glob` is rooted at the app, which is why
 * this covers the four `web/` rows and not the `service/` ones — a limit worth
 * stating rather than working around, because working around it would mean
 * giving this test `node:fs` and `tsconfig.app.json` grants `vite/client` and
 * nothing else (see `lib/links.test.ts` for the same constraint).
 */

import { describe, expect, it } from 'vitest'
import { SHAPE, WEB_TEST_FILES } from './CodeStructure'
// Vite's `import.meta.glob` leaves out the module that calls it, so without this
// every count below is one short and the one it is short by is this file — the
// off-by-one that is hardest to notice, because it only shows up in the row this
// file happens to live in. Imported by name and merged back.
import selfSource from './code-structure.test.ts?raw'

const SELF = '/src/components/guide/code-structure.test.ts'

const globbed = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const sources: Record<string, string> = { ...globbed, [SELF]: selfSource }

/** `wc -l` counts newlines, so a file with no trailing newline is one short. */
const newlines = (source: string) => (source.match(/\n/g) ?? []).length

const under = (dir: string) => {
  const prefix = `/${dir.replace(/^web\//, '')}/`
  return Object.entries(sources).filter(([path]) => path.startsWith(prefix))
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path)

describe('the directory table', () => {
  const measurable = SHAPE.filter((row) => row.dir.startsWith('web/'))

  it('covers the four rows this app can see, and knows it cannot see the rest', () => {
    // Guards the guard: a `filter` that matched nothing would make every
    // assertion below vacuous, and this table is exactly where that hides.
    expect(measurable.map((r) => r.dir)).toEqual([
      'web/src/kg/storage',
      'web/src/components',
      'web/src/routes',
      'web/src/lib',
      'web/src/data',
    ])
    expect(SHAPE.length).toBeGreaterThan(measurable.length)
  })

  for (const row of SHAPE.filter((r) => r.dir.startsWith('web/'))) {
    it(`still counts ${row.dir} the way the page prints it`, () => {
      const found = under(row.dir)
      expect(found.length, `nothing globbed for ${row.dir}`).toBeGreaterThan(0)
      expect(found.length).toBe(row.files)
      expect(found.filter(([path]) => isTest(path)).length).toBe(row.tests)

      /*
       * Files and tests are pinned exactly; lines are pinned to a tolerance,
       * and the difference is deliberate.
       *
       * "31 files, 13 of them tests" is a claim that changes when somebody adds
       * a file, which is a moment worth stopping at — the row is one line away
       * from being right and the person who moved it is holding the number. A
       * line count changes on every comment, and pinning it exactly would fail
       * this build on every edit to two of the busiest directories in the repo
       * while teaching everyone to re-run a script rather than read the number.
       * The page's own caption says these were "counted on the tree these pages
       * were written against"; a percent or two is inside that sentence and a
       * fifth is not. This is a staleness alarm, not an exactness pin.
       */
      const lines = found.reduce((n, [, source]) => n + newlines(source), 0)
      const drift = Math.abs(lines - row.lines) / lines
      expect(
        drift,
        `${row.dir} now measures ${lines} lines; the page prints ${row.lines}`,
      ).toBeLessThan(0.03)
    })
  }
})

describe('the glob', () => {
  it('has this file merged back into it', () => {
    // Guards the correction above rather than trusting it: if Vite ever stops
    // excluding the caller, the merge is a no-op and this still passes; if the
    // path constant drifts, every row this file sits in goes one over and this
    // says which mistake it was.
    expect(globbed[SELF]).toBeUndefined()
    expect(sources[SELF]).toBe(selfSource)
    expect(selfSource).toContain('the directory table')
  })
})

describe('the test count in the section heading', () => {
  it('still counts this app’s test files the way the page prints it', () => {
    // The suite total spans three workspaces and only one of them is reachable
    // from here. This app's share is the part that can be held honest, and it is
    // the part that moved when the /graph page and the export name got covered.
    const here = Object.keys(sources).filter(isTest)
    expect(here.length).toBe(WEB_TEST_FILES)
  })
})
