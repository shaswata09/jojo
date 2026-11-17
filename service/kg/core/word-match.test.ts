import { describe, expect, it } from 'vitest'
import { matchesQuery } from './text'
import { hasWords, haystackOf, matchesWords, searchWords } from './word-match'

describe('matchesWords — one search rule for the palette and the phone', () => {
  it('finds a record by words from different parts of it', () => {
    expect(matchesWords('rice stat', 'Rice — Statistics')).toBe(true)
    expect(matchesWords('rice statistics', 'Rice University', 'Statistics')).toBe(true)
    expect(matchesWords('dark theme', 'Theme', 'dark mode light mode appearance')).toBe(true)
  })

  it('ignores accents and case on both sides', () => {
    expect(matchesWords('theme', 'Thème')).toBe(true)
    expect(matchesWords('THÈME', 'theme')).toBe(true)
    expect(matchesWords('andre munoz', 'André Muñoz')).toBe(true)
  })

  it('needs every word', () => {
    expect(matchesWords('rice mit', 'Rice University', 'Statistics')).toBe(false)
  })

  it('matches everything when nothing was typed', () => {
    expect(matchesWords('', 'anything')).toBe(true)
    expect(matchesWords('   ', undefined, null)).toBe(true)
    expect(searchWords('  ')).toEqual([])
  })

  it('skips absent fields, and finds nothing in a record with none', () => {
    expect(matchesWords('note', 'Title', undefined, null, 'A note')).toBe(true)
    expect(matchesWords('note', undefined, null)).toBe(false)
  })

  it('agrees with matchesQuery on every one-word query', () => {
    const fields = ['Rice University', 'Statistics', 'André Muñoz', 'ML engineer']
    for (const word of ['rice', 'stat', 'munoz', 'André', 'mit', 'ml', 'engineer']) {
      expect(matchesWords(word, ...fields)).toBe(matchesQuery(word, ...fields))
    }
  })

  it('splits into a once-per-record haystack and a once-per-keystroke query', () => {
    const haystack = haystackOf('Thème', 'Apparence · Système')
    expect(hasWords(searchWords('theme systeme'), haystack)).toBe(true)
    expect(hasWords(searchWords('theme police'), haystack)).toBe(false)
  })
})
