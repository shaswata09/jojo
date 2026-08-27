/**
 * Mapping what a model called a relation onto what the graph calls it.
 *
 * The tests fall into two halves that pull against each other, which is the
 * design: the taxonomy has to be generous enough that four spellings of one
 * relation meet, and strict enough that two different relations never do. A
 * fact filed under the wrong predicate is wrong and looks right; one filed
 * under an unfamiliar name is honest and still findable.
 */

import { describe, expect, it } from 'vitest'
import { aliasOwners, canonicalise, labelOf, normalise, PREDICATES, specOf } from './ontology'

const id = (surface: string) => canonicalise(surface).id

/**
 * The module's stemmer, restated.
 *
 * Not imported, deliberately: this test asserts a property of the TABLE, and
 * borrowing the implementation would make it agree with a broken stemmer as
 * readily as with a working one. Written out, the two have to agree by being
 * right rather than by being the same code.
 */
const stemLike = (phrase: string): string => {
  const [head, ...rest] = phrase.split(' ')
  if (head === undefined) return phrase
  const base = head
    .replace(/ies$/u, 'y')
    .replace(/(ss|us|is)$/u, '$1')
    .replace(/([^s])s$/u, '$1')
    .replace(/ing$/u, '')
    .replace(/ed$/u, '')
  return [base, ...rest].join(' ').trim()
}

describe('the table itself', () => {
  it('claims no alias twice', () => {
    /*
     * A shared alias means whichever predicate was declared last silently wins,
     * and a relation is then filed under a name nobody chose. The table is
     * hand-written, so this is the check that keeps it honest as it grows.
     */
    const clashes = [...aliasOwners()].filter(([, owners]) => owners.length > 1)
    expect(clashes).toEqual([])
  })

  it('has no two predicates whose words stem to the same thing', () => {
    /*
     * The invariant that makes stemming safe, and the reason the exact lookup
     * runs before it.
     *
     * Measured: removing the exact-alias lookup entirely leaves this suite
     * green, because nothing in the table currently collides once stemmed. That
     * makes the exact lookup unkillable by mutation today — and it stays,
     * because it is the guarantee, not an optimisation. The moment somebody
     * adds an alias whose stem is already claimed, stemming would resolve a
     * word to the wrong predicate and the exact form is what saves it.
     *
     * So the assertion is on the property rather than on the line: this fails
     * loudly when the table grows into a collision, which is the only time the
     * ordering could ever matter.
     */
    const owners = new Map<string, Set<string>>()
    for (const spec of PREDICATES) {
      for (const surface of [spec.id, spec.label, ...spec.aliases]) {
        const key = stemLike(normalise(surface))
        const held = owners.get(key) ?? new Set<string>()
        held.add(spec.id)
        owners.set(key, held)
      }
    }
    const clashes = [...owners]
      .filter(([, ids]) => ids.size > 1)
      .map(([key, ids]) => `${key} => ${[...ids].join(' / ')}`)
    expect(clashes).toEqual([])
  })

  it('declares every inverse in both directions', () => {
    /*
     * A one-sided inverse is exactly how "A employed_by B" and "B employs A"
     * end up as two facts — `keysOf` only produces the reversed key when the
     * spec names an inverse, so a missing back-reference silently disables the
     * deduplication in one direction.
     */
    for (const spec of PREDICATES) {
      if (spec.inverse === undefined) continue
      const other = specOf(spec.inverse)
      expect(other, `${spec.id} names ${spec.inverse}, which does not exist`).toBeDefined()
      expect(other?.inverse, `${spec.inverse} does not name ${spec.id} back`).toBe(spec.id)
    }
  })

  it('does not give a symmetric relation an inverse', () => {
    // They are two different answers to the same question and `keysOf` checks
    // symmetry first, so a spec with both would silently ignore the inverse.
    for (const spec of PREDICATES) {
      if (spec.symmetric === true) expect(spec.inverse).toBeUndefined()
    }
  })

  it('names every predicate in a way a sentence can use', () => {
    for (const spec of PREDICATES) {
      expect(spec.label).not.toBe(spec.id)
      expect(labelOf(spec.id)).toBe(spec.label)
    }
  })
})

describe('normalising a surface form', () => {
  it('treats the three spellings a model returns as one', () => {
    // Asked for a predicate, a model returns `worked_at`, `worked-at` and
    // `worked at` interchangeably, sometimes within one reply.
    expect(normalise('worked_at')).toBe(normalise('worked-at'))
    expect(normalise('worked-at')).toBe(normalise('Worked At'))
  })

  it('strips the auxiliaries a model puts in front', () => {
    /*
     * The difference between a canonical hit and an open predicate meaning the
     * same thing. Models write `was_supervised_by` and `has been funded by` for
     * relations the table lists without the auxiliary.
     */
    expect(normalise('was supervised by')).toBe('supervised by')
    expect(normalise('has been funded by')).toBe('funded by')
    expect(normalise('is a member of')).toBe('member of')
  })

  it('does not strip a word that only starts with an auxiliary', () => {
    // "based in" begins with `b-a-s`, not with `be`.
    expect(normalise('based in')).toBe('based in')
  })
})

describe('mapping onto the taxonomy', () => {
  it('brings four words for one relation together', () => {
    /*
     * THE case. `built`, `developed`, `worked on` and `contributed to` are one
     * relation and share no keyword, so nothing textual would ever join them —
     * and until they are joined, deduplication cannot work at all.
     */
    for (const surface of ['built', 'developed', 'worked on', 'contributed to', 'implemented']) {
      expect(id(surface), surface).toBe('BUILT')
    }
  })

  it('reads a tense it has never seen', () => {
    // The stemmer's job, and its whole job: `developing` and `develops` are not
    // in the table and must not become open predicates.
    expect(id('developing')).toBe('BUILT')
    expect(id('develops')).toBe('BUILT')
    expect(id('supervises')).toBe('SUPERVISED')
  })

  it('keeps two genuinely different relations apart', () => {
    /*
     * The other half of the design. A CV that says somebody both led and built
     * a system has drawn a distinction, and a taxonomy that merged them on a
     * resemblance would lose it.
     */
    expect(id('led')).not.toBe(id('built'))
    expect(id('supervised')).not.toBe(id('supervised by'))
    expect(id('funded')).not.toBe(id('funded by'))
  })

  it('accepts a canonical id straight back', () => {
    // A model that has seen the vocabulary answers in it, and a round trip
    // through the table must not turn its own output into an open predicate.
    for (const spec of PREDICATES) expect(id(spec.id)).toBe(spec.id)
  })
})

describe('the open lane', () => {
  it('keeps a relation nobody enumerated', () => {
    /*
     * Nothing is dropped for being unrecognised. The alternative — refusing an
     * unfamiliar predicate — loses exactly the facts a curated list was never
     * going to anticipate, which is the reason a fixed vocabulary was rejected.
     */
    const out = canonicalise('peer reviewed for')
    expect(out.known).toBe(false)
    expect(out.id).toBe('peer reviewed for')
  })

  it('makes two spellings of one unfamiliar relation meet', () => {
    // Open does not mean unnormalised. If it did, an open predicate would
    // duplicate itself on punctuation alone.
    expect(id('peer-reviewed for')).toBe(id('peer reviewed for'))
    expect(id('Peer_Reviewed_For')).toBe(id('peer reviewed for'))
  })

  it('does not force an unfamiliar relation into a familiar one', () => {
    /*
     * There is deliberately no fuzzy matching. "served on" is in the table as
     * MEMBER_OF and "peer reviewed for" is not, and guessing that they are the
     * same would file a review under a membership — wrong, and looking right.
     */
    expect(canonicalise('peer reviewed for').known).toBe(false)
    expect(id('peer reviewed for')).not.toBe('MEMBER_OF')
  })

  it('says a relation with no name is not a relation', () => {
    expect(canonicalise('   ').id).toBe('')
    expect(canonicalise('!!!').id).toBe('')
  })

  it('keeps what was actually said, whatever it decided', () => {
    // The record of the model's own wording survives canonicalisation, so a
    // person checking a surprising relation can see the sentence it came from.
    expect(canonicalise('WORKED_ON').surface).toBe('WORKED_ON')
    expect(canonicalise('peer reviewed for').surface).toBe('peer reviewed for')
  })
})

/**
 * Every script, not just the one the regex was written in.
 *
 * `normalise` filtered with `[^a-z0-9 ]+`, which deletes anything that is not
 * Latin. Measured before the fix: `曾任职于`, `работал в`, `εργάστηκε στο`,
 * `עבד ב`, `حاصل على` and `勤務先` all reduced to the empty string —
 * `canonicalise` answers `id: ''` for that and `checkClaim` rejects it with "A
 * relation needs a name."
 *
 * So a Chinese or Russian CV kept its people and organisations and lost EVERY
 * relation between them, silently, against this module's own contract — and
 * `ProfileUpdateOffer` counts only the successes, so the screen reported it had
 * worked.
 */
describe('normalise, across scripts', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['worked at', 'worked at'],
    ['travaillé à', 'travaille a'],
    ['worked_at', 'worked at'],
    ['曾任职于', '曾任职于'],
    ['работал в', 'работал в'],
    ['עבד ב', 'עבד ב'],
    ['حاصل على', 'حاصل على'],
    ['勤務先', '勤務先'],
  ]

  for (const [surface, expected] of cases) {
    it(`keeps ${surface}`, () => {
      expect(normalise(surface)).toBe(expected)
    })
  }

  it('still strips the punctuation it is there to strip', () => {
    // The filter has a job — widening it must not turn it off.
    expect(normalise('worked @ (Rice)!')).toBe('worked rice')
  })

  it('is still empty for a predicate with no name in it', () => {
    // `canonicalise` treats '' as "no relation", and that must stay reachable
    // or the rejection it drives becomes dead code.
    expect(normalise('!!! ---')).toBe('')
  })

  it('lets two spellings of one non-Latin predicate meet', () => {
    // The whole point of normalising: comparability, in any script.
    expect(normalise('работал_в')).toBe(normalise('работал в'))
  })
})
