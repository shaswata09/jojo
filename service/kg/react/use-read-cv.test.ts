/**
 * One assertion, and it is the COMPILER that makes it.
 *
 * `useReadCv` is a hook and nothing in this package renders (D20), so the thing
 * that went wrong here cannot be caught by running it: the reader was already
 * putting `linking` into its successful result, and the result type did not say
 * so. Every consumer that tried to read the field got TS2339 and the only way
 * past that is an assertion, which is how a reported number becomes an
 * unreported one.
 *
 * `tsconfig.react.json` includes `kg/react`, `.test.ts` files and all, so this
 * file is compiled by `tsc -b` under the same flags as the source it is about.
 * Delete the `linking` declaration from `CvOutcome` and the build fails here —
 * on the literal below, which cannot carry an undeclared field, and on the read
 * beneath it. That is the regression test; the `expect` is only what gives
 * vitest something to run.
 */

import { expect, it } from 'vitest'
import type { CvOutcome } from './use-read-cv'

it('declares `linking` on the success arm, so a caller can read what the pass cost', () => {
  const outcome: CvOutcome = {
    ok: true,
    background: [],
    relations: [],
    skipped: [],
    // Nine batches asked, one of them lost — the case the field exists for. A
    // caller seeing this says the graph is thin, not that it is complete.
    linking: { relations: [], asked: 9, failed: 1 },
  }

  expect(outcome.ok && outcome.linking?.failed).toBe(1)
})

it('leaves `linking` off entirely when no pass ran, rather than carrying undefined', () => {
  // `exactOptionalPropertyTypes`: an absent key and a present-and-undefined one
  // are different values below the seam, and a structured clone keeps the
  // second. The reader spreads conditionally for that reason, so the type has to
  // permit the key being missing rather than requiring `linking: undefined`.
  const outcome: CvOutcome = { ok: true, background: [], relations: [], skipped: [] }

  expect('linking' in outcome).toBe(false)
})
