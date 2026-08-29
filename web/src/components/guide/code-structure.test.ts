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
 * So the rows are measured here and the page fails the build when they drift.
 *
 * ## Why the service rows are covered now, when they were not
 *
 * This used to measure the `web/` rows only, and said so: `import.meta.glob` is
 * rooted at the app, and reaching outside it looked like it would mean
 * `node:fs`, which `tsconfig.app.json` does not grant.
 *
 * That was half right. The glob cannot be ROOT-relative, but it can be
 * FILE-relative, and a relative pattern walks out of the app the same way an
 * import does — no `node:fs`, no new grant. The cost of not doing it was
 * measured on 2026-08-27: every one of the seven service rows had drifted, and
 * `service/kg/core` was printing 77 files and 20,173 lines for a directory
 * holding 120 and 31,826. The page's own argument — that a stale claim on a
 * guide is invisible to every gate and read by somebody who cannot check it —
 * was true of the page itself for as long as the unguarded half existed.
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

/*
 * The service layer, reached by a FILE-relative glob rather than a root-relative
 * one. Vite resolves these the way it resolves an import, so this walks out of
 * the app without `node:fs` and without a new tsconfig grant.
 *
 * `check-no-copies` forbids an app reaching into the package by a relative
 * path, because Metro does not consult the exports map for one and the module
 * then arrives as a second instance of something the graph holds as a
 * singleton. A `query: '?raw'` glob cannot do that — it yields the file's TEXT
 * and instantiates nothing — and the guard reads that option to tell the two
 * apart. Writing the `?raw` into the pattern instead would have been simpler
 * for the guard to check, and returns NOTHING from Vite; the "nothing globbed"
 * assertion below is what caught that, which is the reason it is there.
 *
 * Keyed back to repo-relative paths so `under('service/kg/core')` asks the same
 * question of both halves.
 */
const service = import.meta.glob('../../../../service/{kg,data}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const serviceSources = Object.fromEntries(
  Object.entries(service).map(([path, source]) => [
    `/${path.replace(/^.*?\/service\//, 'service/')}`,
    source,
  ]),
)

const sources: Record<string, string> = { ...globbed, ...serviceSources, [SELF]: selfSource }

/** `wc -l` counts newlines, so a file with no trailing newline is one short. */
const newlines = (source: string) => (source.match(/\n/g) ?? []).length

const under = (dir: string) => {
  // `service/kg/log.ts` is a FILE row, not a directory: no trailing slash, or
  // it matches nothing and the row silently reports zero.
  const key = dir.replace(/^web\//, '')
  const prefix = dir.endsWith('.ts') ? `/${key}` : `/${key}/`
  return Object.entries(sources).filter(([path]) => path.startsWith(prefix))
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path)

describe('the directory table', () => {
  it('covers every row on the page, with nothing left unmeasured', () => {
    /*
     * Guards the guard, and it has to be an EQUALITY rather than a count: a
     * glob that matched nothing would make every assertion below vacuous, and
     * a table of measurements is exactly where that hides. The service half
     * drifted for months behind a `filter` that quietly excluded it.
     */
    expect(SHAPE.map((r) => r.dir).sort()).toEqual(
      [
        'service/data',
        'service/kg/agent',
        'service/kg/core',
        'service/kg/log.ts',
        'service/kg/react',
        'service/kg/repo',
        'service/kg/storage',
        'service/kg/tools',
        'web/src/components',
        'web/src/data',
        'web/src/kg/storage',
        'web/src/lib',
        'web/src/routes',
      ].sort(),
    )
  })

  for (const row of SHAPE) {
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
    /*
     * WEB_TEST_FILES is this app's share, so it is counted from the app's own
     * glob and not from `sources` — which now also holds the service layer, and
     * counting that in turned 57 into 169. The number on the page says "web",
     * so the set it is checked against has to say "web" too.
     */
    const here = [...Object.keys(globbed), SELF].filter(isTest)
    expect(here.length).toBe(WEB_TEST_FILES)
  })

  it('counts more test files across the workspaces than in this app alone', () => {
    // Guards the guard above: if the service glob ever returned nothing, every
    // service row would measure zero and the equality check would be the only
    // thing standing. This says the second glob is actually loaded.
    const everywhere = Object.keys(sources).filter(isTest)
    expect(everywhere.length).toBeGreaterThan(WEB_TEST_FILES)
  })
})
