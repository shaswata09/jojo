/**
 * Deciding whether the graph already holds a relation.
 *
 * The requirement in one sentence: the same information must not go in twice
 * under a different name — and a keyword search cannot answer that, because the
 * two names share no keyword. Every test here is a shape of "different words,
 * one fact".
 */

import { describe, expect, it } from 'vitest'
import { checkClaim, indexClaims, keysOf, sameClaim } from './claim'
import type { Claim } from './claim'

const claim = (subject: string, predicate: string, object: string): Claim => ({
  subject,
  predicate,
  object,
})

const known = (...claims: Claim[]) => indexClaims(claims)

describe('the same fact in different words', () => {
  it('recognises a relation already stored under another verb', () => {
    /*
     * THE case, and the one keyword search cannot do: `built` and `developed`
     * are the same relation and share no letters. They only meet because both
     * were canonicalised before the comparison.
     */
    const out = checkClaim(
      { subject: 'person:1', predicate: 'developed', object: 'project:aurelia' },
      known(claim('person:1', 'BUILT', 'project:aurelia')),
    )
    expect(out.verdict).toBe('known')
  })

  it('recognises the fact written backwards', () => {
    // "A was employed by B" and "B employed A" are one fact. Without the
    // inverse rule they are two, and neither finds the other.
    const out = checkClaim(
      { subject: 'org:cloudflare', predicate: 'employs', object: 'person:1' },
      known(claim('person:1', 'WORKED_AT', 'org:cloudflare')),
    )
    expect(out.verdict).toBe('known')
  })

  it('recognises a symmetric relation from either end', () => {
    const out = checkClaim(
      { subject: 'person:2', predicate: 'worked with', object: 'person:1' },
      known(claim('person:1', 'COLLABORATED_WITH', 'person:2')),
    )
    expect(out.verdict).toBe('known')
  })

  it('recognises an unfamiliar relation spelled differently', () => {
    // Open does not mean unchecked. Two spellings of one relation nobody
    // enumerated still have to meet, or the open lane duplicates on punctuation.
    const out = checkClaim(
      { subject: 'person:1', predicate: 'Peer-Reviewed_For', object: 'org:acm' },
      known(claim('person:1', 'peer reviewed for', 'org:acm')),
    )
    expect(out.verdict).toBe('known')
  })

  it('says which name the graph already holds it by', () => {
    /*
     * A bare "already known" looks like a bug to whoever proposed it — they
     * searched for "developed", found nothing, and were refused. Naming the
     * stored predicate is what makes the refusal checkable.
     */
    const out = checkClaim(
      { subject: 'person:1', predicate: 'developed', object: 'project:aurelia' },
      known(claim('person:1', 'BUILT', 'project:aurelia')),
    )
    expect(out.verdict === 'known' && out.why).toContain('BUILT')
    expect(out.verdict === 'known' && out.existing.predicate).toBe('BUILT')
  })
})

describe('what is genuinely new', () => {
  it('adds a relation nothing else says', () => {
    const out = checkClaim(
      { subject: 'person:1', predicate: 'built', object: 'project:corvus' },
      known(claim('person:1', 'BUILT', 'project:aurelia')),
    )
    expect(out.verdict).toBe('new')
    expect(out.verdict === 'new' && out.claim.predicate).toBe('BUILT')
  })

  it('keeps two different relations between the same pair', () => {
    /*
     * The other half of the design. Somebody who both led and built a system
     * has drawn a distinction, and collapsing it because the endpoints match
     * would lose what their CV actually said.
     */
    const out = checkClaim(
      { subject: 'person:1', predicate: 'led', object: 'project:aurelia' },
      known(claim('person:1', 'BUILT', 'project:aurelia')),
    )
    expect(out.verdict).toBe('new')
  })

  it('does not confuse a relation with its inverse between different pairs', () => {
    const out = checkClaim(
      { subject: 'person:1', predicate: 'worked at', object: 'org:eth' },
      known(claim('person:1', 'WORKED_AT', 'org:cloudflare')),
    )
    expect(out.verdict).toBe('new')
  })

  it('records an unfamiliar predicate rather than refusing it', () => {
    // Nothing is dropped for being unrecognised — the reason a fixed
    // vocabulary was rejected in the first place.
    const out = checkClaim(
      { subject: 'person:1', predicate: 'served as external examiner for', object: 'org:ucl' },
      known(),
    )
    expect(out.verdict).toBe('new')
    expect(out.verdict === 'new' && out.predicate.known).toBe(false)
    expect(out.verdict === 'new' && out.claim.predicate).toBe('served as external examiner for')
  })
})

describe('what it refuses outright', () => {
  it('refuses a relation with an end missing', () => {
    expect(checkClaim({ subject: '', predicate: 'built', object: 'x' }, known()).verdict).toBe(
      'invalid',
    )
  })

  it('refuses a record related to itself', () => {
    /*
     * Almost always a model resolving two mentions of different things to one
     * id, and the result is unfalsifiable: "Aurelia is part of Aurelia" cannot
     * be checked against the document, because the document does not say it.
     */
    const out = checkClaim({ subject: 'x:1', predicate: 'part of', object: 'x:1' }, known())
    expect(out.verdict).toBe('invalid')
  })

  it('refuses a relation with no name', () => {
    expect(checkClaim({ subject: 'a', predicate: '   ', object: 'b' }, known()).verdict).toBe(
      'invalid',
    )
  })
})

describe('the keys', () => {
  it('gives a symmetric relation one key, not two', () => {
    /*
     * Both orderings have to produce one identical string. Two keys that merely
     * compare equal would mean the index stored it twice and a lookup from the
     * far end missed.
     */
    const a = keysOf(claim('person:1', 'COLLABORATED_WITH', 'person:2'))
    const b = keysOf(claim('person:2', 'COLLABORATED_WITH', 'person:1'))
    expect(a).toHaveLength(1)
    expect(a).toEqual(b)
  })

  it('gives a relation with an inverse both readings', () => {
    expect(keysOf(claim('person:1', 'WORKED_AT', 'org:x'))).toHaveLength(2)
  })

  it('gives a plain relation exactly one', () => {
    expect(keysOf(claim('person:1', 'LED', 'project:x'))).toHaveLength(1)
  })

  it('agrees with the readable comparison', () => {
    // One definition of equivalence: the fast path and the obvious path cannot
    // be allowed to disagree about what a duplicate is.
    const a = claim('person:1', 'WORKED_AT', 'org:x')
    const b = claim('org:x', 'EMPLOYED', 'person:1')
    expect(sameClaim(a, b)).toBe(true)
    expect(sameClaim(a, claim('person:1', 'LED', 'org:x'))).toBe(false)
  })
})

describe('the index', () => {
  it('finds a claim from either of its readings', () => {
    const index = known(claim('person:1', 'WORKED_AT', 'org:x'))
    expect(index.size).toBe(2)
    expect(
      checkClaim({ subject: 'org:x', predicate: 'hired', object: 'person:1' }, index).verdict,
    ).toBe('known')
  })

  it('reports the older claim when two say the same thing', () => {
    // They should not both exist. If they do, the one that has been there
    // longest is the one to point at.
    const index = known(claim('person:1', 'BUILT', 'p:1'), claim('person:1', 'BUILT', 'p:1'))
    const out = checkClaim({ subject: 'person:1', predicate: 'made', object: 'p:1' }, index)
    expect(out.verdict).toBe('known')
  })
})
