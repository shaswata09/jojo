/**
 * A tailoring job's label in the language on screen (review 3, translation
 * leftovers).
 *
 * `titleFor` (`core/tailoring.ts`) names the snippet a tailoring run stores, in
 * English, because the agent and the tools read it. The job list and the
 * "ready" toast used the same English, so a person reading the app in German
 * was told "Research statement — Rice" was ready. `useTailoring` now labels the
 * job through `DomainText.tailoredTitle`; this holds that the English it says is
 * exactly `titleFor`'s, and that another catalog's words come through.
 */
import { describe, expect, it } from 'vitest'
import { domainText, englishT, englishTranslator } from './domain-text'
import { PROFILE_DOCUMENTS } from './model'
import { titleFor } from './tailoring'

describe('the tailoring job’s label', () => {
  it('says in English exactly what titleFor stores', () => {
    const text = domainText(englishT)
    for (const kind of PROFILE_DOCUMENTS) {
      expect(text.tailoredTitle(kind, 'Rice University')).toBe(titleFor(kind, 'Rice University'))
      expect(text.tailoredTitle(kind, '  ')).toBe(titleFor(kind, '  '))
    }
    expect(text.tailoredTitle('research-statement', ' Rice ')).toBe('Research statement — Rice')
  })

  it('names the document and frames the employer in the language on screen', () => {
    const german = domainText(
      englishTranslator('domain', {
        document: { 'research-statement': 'Forschungsexposé', 'cover-letter': 'Anschreiben' },
        tailoredTitle: '{{document}} – {{org}}',
      }),
    )
    expect(german.tailoredTitle('research-statement', 'Rice')).toBe('Forschungsexposé – Rice')
    expect(german.tailoredTitle('cover-letter', '')).toBe('Anschreiben')

    const turkish = domainText(
      englishTranslator('domain', {
        document: { 'cover-letter': 'ön yazı' },
        tailoredTitle: '{{document}} — {{org}}',
      }),
    )
    // Kept in running-text case by the catalog, raised because it heads a line.
    expect(turkish.tailoredTitle('cover-letter', 'ODTÜ')).toBe('Ön yazı — ODTÜ')
  })
})
