import { describe, expect, it } from 'vitest'
import { withAdded, without } from './profile-lists'

describe('withAdded', () => {
  it('appends a trimmed new term', () => {
    expect(withAdded(['nlp'], '  vision ')).toEqual(['nlp', 'vision'])
  })
  it('writes nothing for a blank entry', () => {
    expect(withAdded(['nlp'], '   ')).toBeNull()
    expect(withAdded([], '')).toBeNull()
  })
  it('writes nothing for a term already on the list, after trimming', () => {
    expect(withAdded(['nlp'], ' nlp')).toBeNull()
  })
  it('does not mutate the list it was given', () => {
    const list = ['a']
    withAdded(list, 'b')
    expect(list).toEqual(['a'])
  })
})

describe('without', () => {
  it('removes every copy of the term and keeps the rest in order', () => {
    expect(without(['a', 'b', 'a', 'c'], 'a')).toEqual(['b', 'c'])
    expect(without(['a'], 'z')).toEqual(['a'])
  })
})
