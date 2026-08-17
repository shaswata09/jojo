/**
 * Identity, which is the decision the rest of Wave 1 cannot recover from.
 *
 * An id that is not unique loses a record; an id that is not ordered reorders
 * the board on every reload; an id that parses loosely reintroduces the guess
 * between the six seeded records that answer to 'stripe'. All three are silent.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { NODE_TYPES } from './model'
import {
  TYPE_PREFIX,
  edgeId,
  foldName,
  isNodeId,
  newNodeId,
  parseEdgeId,
  parseNodeId,
  resetIdCounterForTests,
  slugify,
  typeOfId,
  uniqueSlug,
  uuidv7,
} from './ref'

const AT = Date.UTC(2026, 9, 12, 9, 14, 22, 311)

beforeEach(() => {
  resetIdCounterForTests()
})

describe('uuidv7', () => {
  it('sets the version and variant nibbles', () => {
    const id = uuidv7(AT)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  // The first 48 bits are the timestamp, so a lexicographic sort of the ids is
  // a chronological sort of the records. `ofType` depends on it outright.
  it('encodes the millisecond in the leading 48 bits', () => {
    const hex = uuidv7(AT).replace(/-/g, '').slice(0, 12)
    expect(Number.parseInt(hex, 16)).toBe(AT)
  })

  /**
   * The counter is the whole point.
   *
   * Every node minted inside one transaction shares `ctx.now` to the
   * millisecond. Without the counter their order would be decided by the random
   * tail, so an application and the timeline item created with it would swap
   * places between reloads and the board would look like it had reordered
   * itself while the user was away.
   */
  it('stays ordered inside a single millisecond', () => {
    const ids = Array.from({ length: 500 }, () => uuidv7(AT))
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stays ordered when the clock goes backwards', () => {
    const first = uuidv7(AT)
    const second = uuidv7(AT - 10_000)
    expect(second > first).toBe(true)
  })

  // 4096 ids in one millisecond exhausts rand_a. Borrowing from the next
  // millisecond keeps them ordered and unique rather than wrapping to 0.
  it('borrows the next millisecond rather than repeating on counter overflow', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7(AT))
    expect(new Set(ids).size).toBe(5000)
    expect([...ids].sort()).toEqual(ids)
  })
})

describe('node ids', () => {
  it('gives every type a distinct prefix', () => {
    const prefixes = NODE_TYPES.map((t) => TYPE_PREFIX[t])
    expect(new Set(prefixes).size).toBe(NODE_TYPES.length)
  })

  it('round-trips every type', () => {
    for (const type of NODE_TYPES) {
      const id = newNodeId(type, AT)
      expect(parseNodeId(id)).toEqual({ type, uuid: id.slice(id.indexOf(':') + 1) })
      expect(typeOfId(id)).toBe(type)
      expect(isNodeId(id, type)).toBe(true)
    }
  })

  /**
   * The break from `parseRef`, stated as a test.
   *
   * `parseRef` in `ids.ts` read a bare key as an application, because the label
   * store keyed most records by one. It has since been deleted — this function
   * is what replaced it. That tolerance is exactly what let a keyword written
   * against 'stripe' find the wrong one of six records, so here a bare id is
   * rejected outright.
   */
  it('rejects a bare id rather than reading it as an application', () => {
    expect(parseNodeId('stripe')).toBeNull()
    expect(parseNodeId('0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33')).toBeNull()
    expect(isNodeId('stripe')).toBe(false)
  })

  it('rejects a known prefix carrying something that is not a uuid', () => {
    expect(parseNodeId('app:stripe')).toBeNull()
  })

  // A pasted URL must not come back as `{ type: 'https', uuid: '//stripe.com' }`.
  it('rejects an unknown prefix outright', () => {
    expect(parseNodeId('https://stripe.com/jobs/4482')).toBeNull()
    expect(isNodeId(42)).toBe(false)
  })

  it('answers false when the id is real but the type is wrong', () => {
    expect(isNodeId(newNodeId('application', AT), 'keyword')).toBe(false)
  })
})

describe('edge ids', () => {
  it('is a pure function of its ends, so linking twice writes one key', () => {
    const from = newNodeId('keyword', AT)
    const to = newNodeId('application', AT)
    expect(edgeId(from, 'TAGS', to)).toBe(edgeId(from, 'TAGS', to))
    expect(parseEdgeId(edgeId(from, 'TAGS', to))).toEqual({ from, rel: 'TAGS', to })
  })

  it('rejects an unknown relation and a malformed key', () => {
    const from = newNodeId('keyword', AT)
    const to = newNodeId('application', AT)
    expect(parseEdgeId(`${from}|LIKES|${to}`)).toBeNull()
    expect(parseEdgeId(`${from}|TAGS`)).toBeNull()
    expect(parseEdgeId('kw:x|TAGS|app:y')).toBeNull()
  })
})

describe('slugify and uniqueSlug', () => {
  it('lowercases and hyphenates runs of whitespace', () => {
    expect(slugify('UT Austin')).toBe('ut-austin')
    expect(slugify('  Texas   A&M  ')).toBe('texas-a&m')
  })

  /**
   * The same five inputs `src/lib/ids.test.ts` runs through `toLabelId` and the
   * old `slugify`, pinned to literals here.
   *
   * That file asserts the two agree; `core` may import nothing outside itself,
   * so this one asserts what they agree ON. Three implementations of one rule
   * is a question nobody should have to answer twice, and these ids are read in
   * exports and in the URL.
   */
  it('produces the same strings the two rules it replaces produce', () => {
    expect(slugify('Machine Learning')).toBe('machine-learning')
    expect(slugify('  Remote  ')).toBe('remote')
    expect(slugify('C++')).toBe('c++')
    expect(slugify('a  b   c')).toBe('a-b-c')
  })

  it('hands back the base when nothing has claimed it', () => {
    expect(uniqueSlug('unt', [])).toBe('unt')
    expect(uniqueSlug('unt', ['rice', 'tamu'])).toBe('unt')
  })

  // Counting from 2, not 1: the first duplicate is the SECOND record of that
  // name, and 'unt-1' would imply an 'unt-0' nobody ever minted.
  it('counts from 2 and fills gaps rather than tracking a high-water mark', () => {
    expect(uniqueSlug('unt', ['unt'])).toBe('unt-2')
    expect(uniqueSlug('unt', ['unt', 'unt-2', 'unt-3'])).toBe('unt-4')
    expect(uniqueSlug('unt', ['unt', 'unt-3'])).toBe('unt-2')
  })
})

describe('foldName', () => {
  // Matched on the folded NAME, never on the slug: after a rename the id says
  // nothing about what the keyword is called, so a slug match would miss it and
  // mint a twin. Whitespace inside is kept — 'Waiting on them' is one keyword
  // whose name has spaces in it, and slugify would answer differently.
  it('folds case and edges only', () => {
    expect(foldName('  Waiting On Them ')).toBe('waiting on them')
    expect(foldName('Referral')).toBe(foldName('referral'))
    expect(foldName('UT Austin')).not.toBe(slugify('UT Austin'))
  })
})
