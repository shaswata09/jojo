import { describe, expect, it } from 'vitest'
import { EXPORT_NAME_SHAPE, EXPORT_PREFIX, exportFilename } from './export-name'

/**
 * The button, the toast, the guide and the file all name one thing.
 *
 * The defect this is written against: the Settings button read "Export
 * jojo-data.json" and `onExport` wrote `jojo-backup-2026-08-20.json`. Both
 * guide pages repeated the button. Four surfaces, one file, and the three that
 * a user reads named a file that is never written — with no gate that could
 * see it, because a label is prose and D20 rules out mounting the panel.
 *
 * So the sweep below is over `src` rather than over `DataPanel.tsx`: the
 * mismatch survived because the label lived somewhere the writer did not, and
 * scanning one file would only find the copy that was already right.
 */

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Every non-test source, with its comments stripped.
 *
 * Stripping matters here more than usual: this file, `DataPanel.tsx` and
 * `export-name.ts` all QUOTE the wrong label in the prose explaining why it was
 * wrong, and a scan that read prose would report the three files that document
 * the fix as the three that still carry the defect.
 */
const appSources = () =>
  Object.entries(sources)
    .filter(([path]) => !/\.test\.tsx?$/.test(path))
    .map(([path, source]) => [path, stripComments(source)] as const)

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the exported filename', () => {
  it('is the dated stem the guide publishes', () => {
    expect(exportFilename(new Date('2026-08-20T12:00:00Z'))).toBe('jojo-backup-2026-08-20.json')
    expect(EXPORT_NAME_SHAPE).toBe('jojo-backup-YYYY-MM-DD.json')
    // The published shape has to be the real one with the date blanked out, not
    // a second sentence about it.
    expect(EXPORT_NAME_SHAPE).toBe(
      exportFilename(new Date('2026-08-20T12:00:00Z')).replace('2026-08-20', 'YYYY-MM-DD'),
    )
  })

  it('pads a single-digit month and day, so the names sort', () => {
    expect(exportFilename(new Date('2026-01-05T12:00:00Z'))).toBe('jojo-backup-2026-01-05.json')
  })

  it('gives two exports on different days different names', () => {
    expect(exportFilename(new Date('2026-08-20T12:00:00Z'))).not.toBe(
      exportFilename(new Date('2026-08-21T12:00:00Z')),
    )
  })
})

describe('what the app tells the user to look for', () => {
  it('never labels the export with a filename it cannot write', () => {
    // `jojo-data.json` is the localhost bridge's mirror file and is a real name
    // in this app — see the Ladder guide and the README's tier table. It is no
    // longer in `ConnectionsSection`: that panel's bridge fields were removed,
    // so the name now lives only where the bridge is DESCRIBED rather than
    // where it looked configurable. What must not happen is a control or a
    // guide entry naming it as the EXPORT, which is where the two collided.
    const offenders = appSources()
      .filter(([, source]) => /Export\s+jojo-data\.json|Export\s*\{'\s*'\}\s*jojo-data/.test(source))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })

  it('publishes the shape from the module that builds it, wherever it says it', () => {
    const naming = appSources().filter(([, source]) => source.includes(EXPORT_NAME_SHAPE))
    // Both guide pages that describe the control print it.
    expect(naming.map(([path]) => path).sort()).toEqual([
      '/src/components/guide/overview/YourData.tsx',
      '/src/components/guide/screens/TopBarScreens.tsx',
    ])
  })

  it('is the only place the panel gets a filename from', () => {
    // Deleting the shared builder in favour of a literal inside the click
    // handler is exactly how the two came apart the first time, and every
    // assertion above reads the module rather than the panel.
    const panel = appSources().find(([path]) => path.endsWith('/settings/DataPanel.tsx'))
    expect(panel, 'DataPanel.tsx was not globbed').toBeDefined()
    expect(panel![1]).toContain('exportFilename(')
    expect(panel![1]).not.toMatch(/\.json/)
  })

  it('is scanning a source set that is really there', () => {
    // Guards the guard: an `every`/`filter` over an empty glob passes silently,
    // and the first two assertions above are both filters.
    expect(appSources().length).toBeGreaterThan(250)
    expect(
      appSources().some(([, source]) => source.includes(`'${EXPORT_PREFIX}'`)),
    ).toBe(true)
  })
})
