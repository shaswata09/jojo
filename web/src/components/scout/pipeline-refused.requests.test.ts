/**
 * The pipeline dialogs say why a site will not be read (2026-11-21).
 *
 * LinkedIn's, Indeed's, Glassdoor's and ZipRecruiter's terms forbid automated
 * reading, and the scout reads on a schedule with nobody watching, so it now
 * refuses them (`NO_AUTOMATED_ACCESS` in `core/board.ts`). The refusal reached
 * the model and the log, and never the person typing the address — they found
 * out from a pipeline that quietly read nothing there. Both dialogs now show
 * core's `refusedSources` as the field's error, as the address is typed.
 *
 * And it must NOT block Save: a pipeline stored before the rule existed has to
 * stay editable, and its other boards are still read. Pinned on the source,
 * because the phone's screen is React Native and is not rendered here; the web
 * dialog is pinned the same way so the two read alike.
 */
import { describe, expect, it } from 'vitest'
import { refusedSources } from '@jojo/service/core/board'

// `node:*` through a dynamic import with a narrow cast: the web tsconfig has no
// Node types, and the house pattern (see Onboarding.requests.test.ts) keeps it so.
const { readFileSync } = (
  // @ts-expect-error TS2307 — node:fs has no types under tsconfig.app.json (house pattern, Onboarding.requests.test.ts).
  await import('node:fs')
) as {
  readFileSync: (p: string, enc: 'utf8') => string
}
const path = (
  // @ts-expect-error TS2307 — node:path has no types under tsconfig.app.json (house pattern, Onboarding.requests.test.ts).
  await import('node:path')
) as {
  join: (...parts: string[]) => string
  resolve: (...parts: string[]) => string
  dirname: (p: string) => string
}
const { fileURLToPath } = (
  // @ts-expect-error TS2307 — node:url has no types under tsconfig.app.json (house pattern, Onboarding.requests.test.ts).
  await import('node:url')
) as { fileURLToPath: (u: string | URL) => string }


const HERE = path.dirname(fileURLToPath(import.meta.url))
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = (...parts: string[]) => strip(readFileSync(path.join(HERE, ...parts), 'utf8'))

/** The body of the dialog's submit handler, which decides whether Save goes through. */
function submitOf(src: string, opener: string): string {
  const at = src.indexOf(opener)
  if (at === -1) throw new Error(`no ${opener} any more`)
  return src.slice(at, src.indexOf('onSave(', at))
}

describe('the sites a pipeline names that it will not read', () => {
  it('are found by core, whatever the spelling', () => {
    expect(refusedSources('linkedin.com/jobs, cra.org/ads, uk.indeed.com/q-ml')).toEqual([
      'linkedin.com',
      'indeed.com',
    ])
    expect(refusedSources('cra.org/ads')).toEqual([])
  })

  const dialogs = [
    {
      name: 'web',
      src: read('PipelineDialog.tsx'),
      key: "t('dialog.sourceRefused'",
      submit: 'const submit = (event',
    },
    {
      name: 'phone',
      src: read('..', '..', '..', '..', 'mobile', 'src', 'screens', 'JobScoutScreen.tsx'),
      key: "t('jobScout.editor.sourceRefused'",
      submit: 'const submit = () =>',
    },
  ]

  for (const { name, src, key, submit } of dialogs) {
    it(`are named in the ${name} dialog's source field`, () => {
      expect(src).toContain('refusedSources(source)')
      expect(src).toContain(key)
    })

    it(`do not stop the ${name} dialog from saving`, () => {
      expect(submitOf(src, submit)).not.toContain('refused')
    })
  }
})
