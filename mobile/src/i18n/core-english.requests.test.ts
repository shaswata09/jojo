/**
 * Review 2026-11-17 (i18n-1, i18n-2, i18n-3, i18n-6, i18n-7): five places put
 * a sentence core writes in English into a translated screen — the
 * profile-read consent banner, the duplicate warning at Save, an offer's
 * "Respond by" date, the application picker's label and why a captured page
 * was refused. Each now goes through `domain`, whose English equals core's
 * (`domain-text.test.ts`). These guards keep the English helpers out of the
 * screens that show them.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')

/** Code only: a comment may still name the English helper it stands in for. */
const code = (rel: string) =>
  source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('core English kept out of translated screens', () => {
  for (const [file, english, translated] of [
    ['components/profile/ProfileUpdateOffer.tsx', 'twinOfferCopy', 'domain.twinOffer('],
    ['sheets/ApplicationSheet.tsx', 'duplicateMessage', 'domain.duplicate('],
    ['screens/ApplicationDetailScreen.tsx', 'respondByLabel', 'domain.shortDate(offer.respondBy)'],
    ['components/common/ApplicationPickerSheet.tsx', 'applicationsLabel', 'domain.picked('],
    ['screens/PostingBrowserScreen.tsx', 'CAPTURE_REJECTION_MESSAGE', 'domain.captureRejected('],
  ] as const) {
    it(`${file} says ${english}'s sentence in the language on screen`, () => {
      const text = code(file)
      expect(text).not.toContain(english)
      expect(text).toContain(translated)
    })
  }
})
