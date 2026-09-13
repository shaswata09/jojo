/**
 * The judge's pure halves: who is asked about, and what an answer may say.
 *
 * The model itself is measured live (`test/live-duplicate.test.ts`). What is
 * pinned here is the fence around it: it is shown only the same employer's
 * records, and it can only point at one of those.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_CANDIDATES,
  duplicateCandidates,
  duplicateJudgeMessages,
  readDuplicateVerdict,
  sameEmployer,
} from './judge-duplicate'

const saved = [
  {
    id: 'a1',
    org: 'University of Tennessee, Knoxville',
    role: 'Assistant Professor of Computer Science',
  },
  { id: 'a2', org: 'UTK', role: 'Lecturer in Statistics' },
  { id: 'a3', org: 'Rice University', role: 'Assistant Professor of Statistics' },
  { id: 'a4', org: 'Stripe', role: 'Machine Learning Engineer' },
]

describe('which records are worth asking about', () => {
  it('is the same employer under its own spellings, and nobody else', () => {
    expect(sameEmployer('University of Tennessee, Knoxville', 'University of Tennessee')).toBe(true)
    expect(sameEmployer('Rice University', 'Rice')).toBe(true)
    expect(sameEmployer('Stripe', 'Stripe, Inc.')).toBe(true)
    // What people type instead of the name. Three models missed the same case
    // because it was never offered to them.
    expect(sameEmployer('UTK', 'University of Tennessee, Knoxville')).toBe(true)
    expect(sameEmployer('Massachusetts Institute of Technology', 'MIT')).toBe(true)
    expect(sameEmployer('UCL', 'University College London')).toBe(true)
    expect(sameEmployer('Rice University', 'Rutgers University')).toBe(false)
    // One word in common out of three is a coincidence, not an employer.
    expect(sameEmployer('Oxford Internet Institute', 'Alan Turing Institute')).toBe(false)
    expect(sameEmployer('Stripe', 'Square')).toBe(false)
    expect(sameEmployer(undefined, 'Stripe')).toBe(false)
  })

  it('offers only the same employer, and never the record being edited', () => {
    const ids = duplicateCandidates(saved, { org: 'University of Tennessee' }).map((r) => r.id)
    expect(ids).toEqual(['a1'])
    expect(duplicateCandidates(saved, { org: 'Rice' }, 'a3')).toEqual([])
  })

  it('caps what the model is shown', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `s${String(i)}`,
      org: 'Stripe',
      role: `Role ${String(i)}`,
    }))
    expect(duplicateCandidates(many, { org: 'Stripe' })).toHaveLength(MAX_CANDIDATES)
  })
})

describe('what the model is told', () => {
  it('says a different role at the same employer is not a duplicate', () => {
    const [system, user] = duplicateJudgeMessages({ org: 'UTK', role: 'Professor' }, [saved[0]!])
    expect(system?.content).toContain('NOT a duplicate')
    // Numbered, never the id: a model asked to copy a uuid gets it wrong.
    expect(user?.content).toContain('[1]')
    expect(user?.content).not.toContain('a1')
    expect(user?.content).toContain('Assistant Professor of Computer Science')
  })
})

describe('reading the answer', () => {
  const offered = [saved[0]!, saved[1]!]

  it('takes a position it offered, at a confidence that means yes', () => {
    expect(
      readDuplicateVerdict(
        '{"duplicateOf":1,"confidence":"likely","reason":"Same post."}',
        offered,
      ),
    ).toEqual({ duplicateOf: 'a1', confidence: 'likely', reason: 'Same post.' })
    // Written as text, or with its brackets, by a smaller model.
    expect(
      readDuplicateVerdict('{"duplicateOf":"2","confidence":"certain"}', offered)?.duplicateOf,
    ).toBe('a2')
    expect(
      readDuplicateVerdict('{"duplicateOf":"[2]","confidence":"certain"}', offered)?.duplicateOf,
    ).toBe('a2')
  })

  it('reads unsure, null, and a position it never offered as no', () => {
    expect(readDuplicateVerdict('{"duplicateOf":1,"confidence":"unsure"}', offered)).toBeNull()
    expect(readDuplicateVerdict('{"duplicateOf":null,"confidence":"certain"}', offered)).toBeNull()
    expect(readDuplicateVerdict('{"duplicateOf":3,"confidence":"certain"}', offered)).toBeNull()
    expect(readDuplicateVerdict('{"duplicateOf":0,"confidence":"certain"}', offered)).toBeNull()
    // An id, which the model was never given and cannot be right about.
    expect(readDuplicateVerdict('{"duplicateOf":"a1","confidence":"certain"}', offered)).toBeNull()
    expect(readDuplicateVerdict('not json', offered)).toBeNull()
  })

  it('survives prose around the object', () => {
    expect(
      readDuplicateVerdict(
        'Sure. ```json\n{"duplicateOf":2,"confidence":"certain","reason":"x"}\n```',
        offered,
      )?.duplicateOf,
    ).toBe('a2')
  })
})
