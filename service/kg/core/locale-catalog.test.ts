import { describe, expect, it } from 'vitest'
import { catalogProblems, flattenCatalog } from './locale-catalog'

describe('a translation measured against English', () => {
  const english = { a: { label: 'Language', count_one: '{{count}} file', count_other: '{{count}} files' } }

  it('passes when it says everything English says', () => {
    expect(catalogProblems(english, { a: { label: 'Idioma', count_one: '{{count}} archivo', count_other: '{{count}} archivos' } })).toEqual([])
  })

  it('allows a language its own plural forms', () => {
    expect(catalogProblems(english, { a: { label: '言語', count_other: '{{count}} 件' } })).toEqual([])
  })

  it('names what is missing, extra, empty or mis-placeheld', () => {
    expect(catalogProblems(english, { a: { label: ' ', count_other: '{{n}} x' }, b: 'x' })).toEqual([
      'extra b',
      'empty a.label',
      'placeholders a.count_other: {n} where English has {count}',
    ])
    expect(catalogProblems(english, { a: { count_other: '{{count}}' } })).toEqual(['missing a.label'])
  })

  it('lets a plural form say the number English’s form leaves out, and only that', () => {
    const english = { changed_one: 'one change', changed_other: '{{count}} changes' }
    // Russian "one" also covers 21, 31…, so it must be able to say the number.
    expect(catalogProblems(english, { changed_one: '{{count}} изменение', changed_other: '{{count}} изменений' })).toEqual([])
    // Any other placeholder is still wrong, and so is the number outside a plural key.
    expect(catalogProblems(english, { changed_one: '{{n}} изменение', changed_other: '{{count}} изменений' })).toEqual([
      'placeholders changed_one: {n} where English has {}',
    ])
    expect(catalogProblems({ label: 'Done' }, { label: '{{count}} готово' })).toEqual([
      'placeholders label: {count} where English has {}',
    ])
  })

  it('flattens nested keys to dotted paths', () => {
    expect([...flattenCatalog(english).keys()]).toEqual(['a.label', 'a.count_one', 'a.count_other'])
  })
})
