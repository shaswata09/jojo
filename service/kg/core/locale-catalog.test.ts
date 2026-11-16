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

  it('flattens nested keys to dotted paths', () => {
    expect([...flattenCatalog(english).keys()]).toEqual(['a.label', 'a.count_one', 'a.count_other'])
  })
})
