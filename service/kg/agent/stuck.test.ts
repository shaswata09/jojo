/**
 * The stuck detector, against the failures that produced it.
 *
 * Every case here is a shape a small model actually emits, not a shape that is
 * easy to write a test for. The three that matter most, because they are the
 * ones `loop.ts`'s raw-string counter got wrong when this was measured against
 * the real loop:
 *
 *   - the same call with the spacing jittered, which burned all eight rounds;
 *   - the same call with the keys reordered, which was caught two rounds late;
 *   - a failing call, which was put on the same schedule as a working one.
 *
 * The negative tests are load-bearing and are half the file. A detector that
 * stops everything is trivially green on every positive case above and useless:
 * a read run twice, an answer that legitimately repeats a heading ten times, and
 * a call whose arguments genuinely changed all have to come back `continue`.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_STUCK,
  STUCK_LIMITS,
  chanting,
  createStuckDetector,
  fingerprintCall,
  hashString,
  observeStuck,
} from './stuck'
import type { StuckObservation, StuckVerdict } from './stuck'

/** One successful call. */
const ok = (name: string, args: unknown = {}): StuckObservation => ({
  call: { name, args },
  ok: true,
})
/** One failed call — a bad id, a refused approval. */
const bad = (name: string, args: unknown = {}): StuckObservation => ({
  call: { name, args },
  ok: false,
})
/** An answer, with nothing run. */
const said = (text: string): StuckObservation => ({ call: null, text })

/** Feed a whole run and keep every verdict, so a schedule can be asserted at once. */
const runAll = (observations: readonly StuckObservation[]): StuckVerdict[] => {
  const d = createStuckDetector()
  return observations.map((o) => d.observe(o))
}
const actions = (observations: readonly StuckObservation[]) =>
  runAll(observations).map((v) => v.action)

/**
 * The verdict at one step, narrowed to the ones that carry a sentence.
 *
 * `noUncheckedIndexedAccess` is on, so a bare `verdicts[2].text` does not
 * compile — and the obvious workaround, `v.action === 'nudge' && v.text`,
 * silently passes when the step was a `continue` because `false` satisfies
 * nothing anybody asserted about it.
 */
const sentenceAt = (verdicts: readonly StuckVerdict[], i: number) => {
  const v = verdicts[i]
  if (v === undefined || v.action === 'continue')
    throw new Error(`no sentence at step ${String(i + 1)}`)
  return v
}

describe('fingerprintCall — the identity that survives a small model', () => {
  it('ignores the spacing the sampler jitters', () => {
    // The measured failure: `{"query":"rice"}` and `{"query": "rice"}` counted
    // as two different calls, so the run went round eight times and stopped on
    // the cap with no answer.
    expect(fingerprintCall({ name: 'memory_search', args: { query: 'rice' } })).toBe(
      fingerprintCall({
        name: 'memory_search',
        args: { query: 'rice' },
        raw: '{ "query" : "rice" }',
      }),
    )
  })

  it('ignores key order, at every depth', () => {
    const a = fingerprintCall({ name: 't', args: { b: 1, a: { d: 4, c: 3 } } })
    const b = fingerprintCall({ name: 't', args: { a: { c: 3, d: 4 }, b: 1 } })
    expect(a).toBe(b)
  })

  it('treats an absent key and an undefined one as the same call', () => {
    // They serialise identically on the wire — `JSON.stringify` drops
    // `undefined` — so a fingerprint that told them apart would be counting a
    // difference the model never expressed.
    expect(fingerprintCall({ name: 't', args: { a: 1 } })).toBe(
      fingerprintCall({ name: 't', args: { a: 1, b: undefined } }),
    )
  })

  it('still tells genuinely different calls apart', () => {
    const one = fingerprintCall({ name: 'memory_search', args: { query: 'rice' } })
    expect(one).not.toBe(fingerprintCall({ name: 'memory_search', args: { query: 'baylor' } }))
    expect(one).not.toBe(fingerprintCall({ name: 'memory_list', args: { query: 'rice' } }))
    // Array ORDER is meaning, unlike key order: [a,b] and [b,a] are two calls.
    expect(fingerprintCall({ name: 't', args: { ids: ['a', 'b'] } })).not.toBe(
      fingerprintCall({ name: 't', args: { ids: ['b', 'a'] } }),
    )
    // "1" and 1 are what an argument-repair layer exists to reconcile. Until it
    // has, they are different calls and must not be merged by this.
    expect(fingerprintCall({ name: 't', args: { n: 1 } })).not.toBe(
      fingerprintCall({ name: 't', args: { n: '1' } }),
    )
  })

  it('falls back to the raw string when the arguments were not JSON, and normalises it too', () => {
    // A model re-sending the SAME broken JSON is the spiral most worth catching,
    // and it reaches the loop with `args: null`.
    const a = fingerprintCall({ name: 't', args: null, raw: '{"id": "x",,}' })
    const b = fingerprintCall({ name: 't', args: null, raw: '{"id":  "x",,}' })
    expect(a).toBe(b)
    expect(a).not.toBe(fingerprintCall({ name: 't', args: null, raw: '{"id": "y",,}' }))
  })

  it('bounds itself on arguments that carry a whole document', () => {
    const long = { text: 'x'.repeat(50_000) }
    const fp = fingerprintCall({ name: 'cv_read', args: long })
    expect(fp.length).toBeLessThan(100)
    expect(fp).toBe(fingerprintCall({ name: 'cv_read', args: { text: 'x'.repeat(50_000) } }))
    expect(fp).not.toBe(fingerprintCall({ name: 'cv_read', args: { text: 'y'.repeat(50_000) } }))
  })
})

describe('hashString — deterministic, and not node:crypto', () => {
  it('is stable and 16 hex characters', () => {
    expect(hashString('rice')).toBe(hashString('rice'))
    expect(hashString('rice')).toMatch(/^[0-9a-f]{16}$/)
    expect(hashString('rice')).not.toBe(hashString('Rice'))
    expect(hashString('')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('uses both lanes, so single-lane collisions do not survive', () => {
    // Guards the second `Math.imul`: with one lane this pair of anagram-length
    // strings still differs, so the assertion that matters is that the two
    // halves are not equal to each other for a non-empty input.
    const h = hashString('application.delete {"id":"a1"}')
    expect(h.slice(0, 8)).not.toBe(h.slice(8))
  })
})

describe('the same call, succeeding', () => {
  it('lets a read run twice without saying anything', () => {
    // Reading a record, writing, then reading it back is ordinary work and the
    // most common honest reason a call repeats. `loop.ts` warned on the second
    // one; this does not.
    expect(
      actions([
        ok('memory_overview'),
        ok('application_create', { org: 'Rice' }),
        ok('memory_overview'),
      ]),
    ).toEqual(['continue', 'continue', 'continue'])
  })

  it('tells the model on the third and stops it on the fifth', () => {
    const verdicts = runAll(Array.from({ length: 5 }, () => ok('memory_search', { query: 'rice' })))
    expect(verdicts.map((v) => v.action)).toEqual([
      'continue',
      'continue',
      'nudge',
      'continue',
      'stop',
    ])
    const nudge = sentenceAt(verdicts, 2)
    const stop = sentenceAt(verdicts, 4)
    expect(nudge).toMatchObject({ action: 'nudge', kind: 'repeat', count: 3 })
    expect(stop).toMatchObject({ action: 'stop', kind: 'repeat', count: 5 })
    // The nudge is addressed TO THE MODEL and the stop is addressed to the
    // person. Swapping them shows the user an instruction and the model a
    // status line, which is why they are asserted apart.
    expect(nudge.text).toContain('You have now called memory_search')
    expect(stop.text).toContain('The model called memory_search')
    expect(stop.text).toContain('5 times')
  })

  it('says it once, not on every step after', () => {
    // A nudge repeated every round is noise the model learns to skip, and it
    // costs tokens in the window the answer needs.
    const verdicts = runAll(Array.from({ length: 4 }, () => ok('memory_search', { query: 'rice' })))
    expect(verdicts.filter((v) => v.action === 'nudge')).toHaveLength(1)
  })

  it('counts the jittered spelling as one call — the measured cap-burn', () => {
    // Byte-for-byte this is five different argument strings. `loop.ts`'s counter
    // saw five different calls and burned the run; this sees one call, five times.
    const raws = [
      '{"query":"rice"}',
      '{"query": "rice"}',
      '{ "query":"rice" }',
      '{"query" :"rice"}',
      '{\n "query": "rice"\n}',
    ]
    const d = createStuckDetector()
    const verdicts = raws.map((raw) =>
      d.observe({ call: { name: 'memory_search', args: { query: 'rice' }, raw }, ok: true }),
    )
    expect(verdicts.map((v) => v.action)).toEqual([
      'continue',
      'continue',
      'nudge',
      'continue',
      'stop',
    ])
  })

  it('does not confuse two different searches for one', () => {
    expect(
      actions([
        ok('memory_search', { query: 'rice' }),
        ok('memory_search', { query: 'baylor' }),
        ok('memory_search', { query: 'ut' }),
        ok('memory_search', { query: 'a&m' }),
        ok('memory_search', { query: 'tulane' }),
      ]),
    ).toEqual(['continue', 'continue', 'continue', 'continue', 'continue'])
  })
})

describe('the same call, failing', () => {
  it('tells the model on the second and stops it on the fourth', () => {
    // The common small-model spiral: an id that does not exist, re-sent
    // verbatim. Told earlier than a succeeding repeat because a failure that
    // repeats never resolves itself — the arguments are the problem.
    const verdicts = runAll(
      Array.from({ length: 4 }, () => bad('application_move', { id: 'app-nope' })),
    )
    expect(verdicts.map((v) => v.action)).toEqual(['continue', 'nudge', 'continue', 'stop'])
    expect(verdicts[1]).toMatchObject({ action: 'nudge', kind: 'failing', count: 2 })
    expect(verdicts[3]).toMatchObject({ action: 'stop', kind: 'failing', count: 4 })
    expect(sentenceAt(verdicts, 1).text).toContain('application_move has failed 2 times')
  })

  it('counts failures, not calls', () => {
    // A call that worked twice and then broke is one failure, not three. Scored
    // on calls it would be one step from a stop before it had failed once.
    const verdicts = runAll([ok('stats_report'), ok('stats_report'), bad('stats_report')])
    expect(verdicts.map((v) => v.action)).toEqual(['continue', 'continue', 'continue'])
  })

  it('never diagnoses a failing call as a stale answer', () => {
    // A call that failed four times has also been MADE four times, so both rules
    // match. Saying "the result has been the same every time" about a call that
    // is erroring sends the model hunting for a cache that does not exist.
    const verdicts = runAll(
      Array.from({ length: 4 }, () => bad('application_move', { id: 'app-nope' })),
    )
    for (const v of verdicts) {
      if (v.action !== 'continue') expect(v.kind).toBe('failing')
    }
  })

  it('does not treat a failure without ok:false as a failure', () => {
    // `ok` is optional on the observation, and an integrator that forgets it
    // gets the succeeding schedule rather than a silent early stop.
    expect(actions([{ call: { name: 't', args: {} } }, { call: { name: 't', args: {} } }])).toEqual(
      ['continue', 'continue'],
    )
  })
})

describe('cycles, which a last-call comparison cannot see', () => {
  it('catches A,B,A,B,A,B and names both tools', () => {
    // Neither call has reached the repeat threshold of 5 — each has been made
    // three times — so nothing but the cycle scan can see this.
    const verdicts = runAll([
      ok('memory_search', { q: 'rice' }),
      ok('memory_list', { of: 'applications' }),
      ok('memory_search', { q: 'rice' }),
      ok('memory_list', { of: 'applications' }),
      ok('memory_search', { q: 'rice' }),
      ok('memory_list', { of: 'applications' }),
    ])
    // Two sentences, and the order is worth reading. On the fifth step the FIRST
    // call reaches three occurrences and gets the plain repeat nudge — the block
    // is not complete yet, so there is no cycle to see. On the sixth the block
    // closes and the cycle is named. Nothing suppresses the earlier one: doing
    // that would need the detector to know a step ahead of time what the model
    // is about to call.
    expect(verdicts.map((v) => v.action)).toEqual([
      'continue',
      'continue',
      'continue',
      'continue',
      'nudge',
      'nudge',
    ])
    expect(verdicts[4]).toMatchObject({ kind: 'repeat' })
    const nudge = sentenceAt(verdicts, 5)
    expect(nudge).toMatchObject({ action: 'nudge', kind: 'cycle' })
    expect(nudge.text).toContain('memory_search, then memory_list')
  })

  it('escalates to a stop when the cycle survives being told about', () => {
    const two = [ok('a_one'), ok('b_two')]
    const verdicts = runAll([...two, ...two, ...two, ...two])
    // The whole sequence, not just the two interesting entries — the step after
    // the nudge is the one that matters and asserting only the stop lets a
    // detector that stops one step EARLY pass, which is the version that ends a
    // run over a call the model had already committed to before it was told.
    expect(verdicts.map((v) => v.action)).toEqual([
      'continue',
      'continue',
      'continue',
      'continue',
      'nudge', // a_one reaches three occurrences, one step before the block closes
      'nudge', // the block closes: the cycle is named
      'continue', // told, and given a full block to break out of it
      'stop',
    ])
    expect(verdicts[5]).toMatchObject({ action: 'nudge', kind: 'cycle' })
    expect(verdicts[7]).toMatchObject({ action: 'stop', kind: 'cycle' })
  })

  it('finds a three-step cycle too', () => {
    const three = [ok('a_one'), ok('b_two'), ok('c_three')]
    const verdicts = runAll([...three, ...three, ...three])
    expect(verdicts[8]).toMatchObject({ action: 'nudge', kind: 'cycle' })
  })

  it('leaves a plain repeat to the counting rules', () => {
    // A,A,A,A,A,A satisfies "a block of two, three times over" and is not a
    // cycle. If this rule claimed it, one behaviour would have two owners with
    // different thresholds and whichever fired first would surprise everybody —
    // so the fifth A is a `repeat` stop, never a `cycle` anything.
    const verdicts = runAll(Array.from({ length: 5 }, () => ok('memory_search', { q: 'rice' })))
    expect(verdicts.every((v) => v.action === 'continue' || v.kind !== 'cycle')).toBe(true)
    expect(verdicts[4]).toMatchObject({ action: 'stop', kind: 'repeat' })
  })

  it('still leaves it alone when the counting rules are turned off', () => {
    // The test above cannot see the guard it is about: the repeat stop fires on
    // the fifth call and a two-long block needs six, so a detector with no
    // distinctness check at all passes it. Measured — that mutant survived.
    // With the counting rules pushed out of reach, the cycle scan is the only
    // thing left that could speak, and it must still say nothing.
    const d = createStuckDetector({ ...STUCK_LIMITS, repeatNudge: 99, repeatStop: 99 })
    const verdicts = Array.from({ length: 8 }, () => d.observe(ok('memory_search', { q: 'rice' })))
    expect(verdicts.map((v) => v.action)).toEqual(Array.from({ length: 8 }, () => 'continue'))
  })

  it('does not see a cycle in ordinary varied work', () => {
    expect(
      actions([
        ok('memory_overview'),
        ok('memory_search', { q: 'rice' }),
        ok('application_move', { id: 'a1', stage: 'interview' }),
        ok('memory_search', { q: 'rice' }),
        ok('note_add', { id: 'a1', text: 'called back' }),
        ok('memory_overview'),
      ]),
    ).toEqual(['continue', 'continue', 'continue', 'continue', 'continue', 'continue'])
  })

  it('remembers only as far back as a cycle can reach', () => {
    /*
     * The cap is a MEMORY bound and nothing else, which is worth writing down
     * because the obvious test for it is a lie. "Without the cap, an A,B at the
     * start would join an A,B,A,B at the end into a false cycle" — it would not:
     * the scan reads the last `len * reps` entries, and the tail of a list is
     * the same tail whether or not the front is still attached. That test was
     * written, it passed, and the mutant that removes the cap survived it.
     *
     * So what is asserted is the thing that is actually true: a run of any
     * length carries a bounded amount of state.
     */
    const d = createStuckDetector()
    const long = Array.from({ length: 40 }, (_, i) => ok(`f${String(i)}`))
    const verdicts = long.map((o) => d.observe(o))
    expect(verdicts.map((v) => v.action)).not.toContain('stop')
    expect(d.state().recent).toHaveLength(STUCK_LIMITS.cycleMax * STUCK_LIMITS.cycleRepeats)
    expect(d.state().steps).toBe(40)
  })
})

describe('the same answer, over and over', () => {
  it('tells the model on the second and stops on the third', () => {
    const verdicts = runAll([
      said('I cannot find it.'),
      said('I cannot find it.'),
      said('I cannot find it.'),
    ])
    expect(verdicts.map((v) => v.action)).toEqual(['continue', 'nudge', 'stop'])
    expect(verdicts[1]).toMatchObject({ kind: 'echo' })
  })

  it('sees through re-wrapping and re-capitalisation', () => {
    // The same sentence generated twice arrives with different line breaks and
    // often a different first letter; a byte comparison would miss both.
    const verdicts = runAll([said('I cannot find it.'), said('i cannot   find\nit.')])
    expect(verdicts[1]).toMatchObject({ action: 'nudge', kind: 'echo' })
  })

  it('says nothing about two different answers, or about an empty one', () => {
    expect(actions([said('Filed it.'), said('Moved it.'), said('   '), said('')])).toEqual([
      'continue',
      'continue',
      'continue',
      'continue',
    ])
  })
})

describe('a reply that comes apart', () => {
  const phrase = 'I will check the application status for you again. '

  it('stops on a chant, without waiting for a second one', () => {
    // A degenerate sampler does not recover by being told; the run is over.
    const verdict = createStuckDetector().observe(said(phrase.repeat(12)))
    expect(verdict).toMatchObject({ action: 'stop', kind: 'chant' })
  })

  it('catches a chant broken across lines', () => {
    expect(chanting(phrase.trim().split(' ').join('\n ').concat('\n').repeat(12))).toBe(true)
  })

  it('leaves a long answer that repeats a line alone', () => {
    // Ten applications rendered with the same 50-character header is ten
    // occurrences of one chunk — and not a chant, because they are spread out.
    // This negative is why the packing check exists at all.
    const row = (i: number) =>
      `Application status: waiting to hear back from them — record number ${String(i)}, filed in the spring of 2026, no interview scheduled yet and no follow-up sent.\n`
    const page = Array.from({ length: 12 }, (_, i) => row(i)).join('')
    expect(chanting(page)).toBe(false)
  })

  it('leaves short and ordinary text alone', () => {
    expect(chanting('Filed it.')).toBe(false)
    expect(chanting('')).toBe(false)
    expect(chanting('yes '.repeat(200))).toBe(true) // a short phrase chanted IS one
  })

  it('needs the full count, not nearly it', () => {
    expect(chanting(phrase.repeat(STUCK_LIMITS.chantRepeats - 2))).toBe(false)
    expect(chanting(phrase.repeat(STUCK_LIMITS.chantRepeats + 1))).toBe(true)
  })
})

describe('the shape of the thing', () => {
  it('does not mutate the state it is given', () => {
    // The reducer is what makes a run replayable and a test able to start
    // halfway through one; a hidden mutation would make both lie.
    const first = observeStuck(EMPTY_STUCK, ok('memory_overview'))
    expect(EMPTY_STUCK.counts.size).toBe(0)
    expect(EMPTY_STUCK.recent).toHaveLength(0)
    expect(first.state.counts.size).toBe(1)
    const second = observeStuck(first.state, ok('memory_overview'))
    expect(first.state.counts.get([...first.state.counts.keys()][0] as string)).toBe(1)
    expect(second.state.counts.size).toBe(1)
  })

  it('takes tighter limits from a caller', () => {
    // The benchmark runs a larger `maxSteps` than the app and can afford
    // Gemini's real numbers; the app cannot.
    const d = createStuckDetector({ ...STUCK_LIMITS, repeatNudge: 2, repeatStop: 3 })
    const seq = [ok('t'), ok('t'), ok('t')].map((o) => d.observe(o))
    expect(seq.map((v) => v.action)).toEqual(['continue', 'nudge', 'stop'])
  })

  it('keeps two runs apart', () => {
    // One detector per run. Shared, the second conversation would be stopped for
    // what the first one did.
    const a = createStuckDetector()
    Array.from({ length: 4 }, () => a.observe(ok('t')))
    const b = createStuckDetector()
    expect(b.observe(ok('t')).action).toBe('continue')
  })
})
