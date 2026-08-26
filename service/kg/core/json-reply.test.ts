/**
 * The parser that stands between a small model's reply and the person reading
 * what it found.
 *
 * Two directions matter and they are not symmetric. Failing to parse a good
 * reply costs a round trip. Parsing a BAD one into entries that look finished
 * puts half-written facts in front of somebody to approve, which is the one
 * outcome the salvage must never produce — so every truncation case below
 * asserts what came back, not merely that something did.
 */
import { describe, expect, it } from 'vitest'
import { firstJsonObject, salvageJsonObject } from './json-reply'

describe('firstJsonObject', () => {
  it('reads a bare object', () => {
    expect(firstJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('ignores the wrapping models add', () => {
    expect(firstJsonObject('Here is the JSON:\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('stops at the object, not at the last brace in the reply', () => {
    // The case `indexOf('{')`→`lastIndexOf('}')` gets wrong: the span runs to
    // the brace in the trailing sentence and parses as nothing at all.
    expect(firstJsonObject('{"a":1}\n\nI used {} to mean an empty set.')).toEqual({ a: 1 })
  })

  it('is not fooled by braces inside strings', () => {
    expect(firstJsonObject('{"note":"a } and a { inside"}')).toEqual({ note: 'a } and a { inside' })
    expect(firstJsonObject('{"note":"an escaped \\" quote }"}')).toEqual({
      note: 'an escaped " quote }',
    })
  })

  it('returns null for a reply with no object, and for a truncated one', () => {
    expect(firstJsonObject('I could not do that.')).toBeNull()
    expect(firstJsonObject('{"entries":[{"a":1},{"b"')).toBeNull()
  })
})

describe('salvageJsonObject', () => {
  it('reports a complete reply as complete', () => {
    expect(salvageJsonObject('{"entries":[{"a":1}]}')).toEqual({
      value: { entries: [{ a: 1 }] },
      truncated: false,
    })
  })

  it('keeps the finished entries when the reply stops mid-array', () => {
    // THE case this exists for. Before, all of this was discarded and the pass
    // was reported as "the model did not return JSON".
    const cut = '{"entries":[{"title":"A"},{"title":"B"},{"title":"C'
    expect(salvageJsonObject(cut)).toEqual({
      value: { entries: [{ title: 'A' }, { title: 'B' }] },
      truncated: true,
    })
  })

  it('drops a container that finished nothing rather than inventing an empty one', () => {
    // Stops right after opening the third object. Keeping the innermost
    // container would hand back `{}` as a third entry — a blank fact to approve.
    const cut = '{"entries":[{"title":"A"},{"title":"B"},{'
    expect(salvageJsonObject(cut)).toEqual({
      value: { entries: [{ title: 'A' }, { title: 'B' }] },
      truncated: true,
    })
  })

  it('never cuts inside a half-written value', () => {
    // Mid-string, mid-number, and mid-key. Each keeps only what finished.
    expect(salvageJsonObject('{"a":1,"b":"half wri').value).toEqual({ a: 1 })
    expect(salvageJsonObject('{"a":1,"b":123').value).toEqual({ a: 1 })
    expect(salvageJsonObject('{"a":1,"bb').value).toEqual({ a: 1 })
  })

  it('salvages through nesting', () => {
    const cut = '{"entries":[{"role":"A","tags":["x","y"]},{"role":"B","tags":["z"'
    expect(salvageJsonObject(cut)).toEqual({
      value: { entries: [{ role: 'A', tags: ['x', 'y'] }] },
      truncated: true,
    })
  })

  it('gives up rather than guess when nothing finished', () => {
    expect(salvageJsonObject('{"entries":[{"title":"A')).toEqual({ value: null, truncated: false })
    expect(salvageJsonObject('{')).toEqual({ value: null, truncated: false })
    expect(salvageJsonObject('no json here')).toEqual({ value: null, truncated: false })
  })

  it('is not fooled by a brace or bracket inside a truncated string', () => {
    // The string is unterminated, so everything after the opening quote is
    // string content — a `}` in it must not be read as closing anything.
    expect(salvageJsonObject('{"a":1,"b":"oops } ] more').value).toEqual({ a: 1 })
  })
})
