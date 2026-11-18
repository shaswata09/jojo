import { describe, expect, it } from 'vitest'

/**
 * Review round 3 (i18n-10): German, Spanish, French and Russian write a space
 * between a number and '%' — and a plain space there is a line break waiting to
 * happen. In a narrow Statistics card German read "typisch: 38" on one line and
 * "%" on the next. The catalogs use a no-break space (U+00A0), the one
 * `Intl.NumberFormat(…, { style: 'percent' })` puts there too.
 *
 * The phone's catalogs are held to the same rule here — all of them, not only
 * the domain and advice files it shares with the web: its own screens and
 * components wrote "38 %" with a breaking space too.
 */

const web = import.meta.glob<string>('./locales/*/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const phone = import.meta.glob<string>('../../../mobile/src/i18n/locales/*/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** A number or a placeholder, then an ordinary space, then '%'. */
const BREAKING = /(\}\}|\d) %/g

describe('a percentage in the catalogs (i18n-10)', () => {
  it('reads every web catalog and the phone’s domain and advice', () => {
    expect(Object.keys(web).length).toBeGreaterThan(20 * 10)
    // Every phone catalog: twenty languages, each with every namespace.
    expect(Object.keys(phone).length).toBeGreaterThan(20 * 8)
  })

  it('never breaks the line between the number and its % sign', () => {
    const offenders = Object.entries({ ...web, ...phone }).flatMap(([path, text]) =>
      [...text.matchAll(BREAKING)].map(
        (m) => `${path}: …${text.slice(Math.max(0, m.index - 20), m.index + 3)}`,
      ),
    )
    expect(offenders).toEqual([])
  })

  it('would catch one', () => {
    expect('typisch: {{value}} %'.match(BREAKING)).toHaveLength(1)
    expect('typisch: {{value}} %'.match(BREAKING)).toBeNull()
  })
})
