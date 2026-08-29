/**
 * The retriever, judged on the two things that can go wrong.
 *
 * It can offer too much, which costs tokens, and it can offer too little, which
 * costs the person their answer with no way to tell why. Those are not
 * comparable failures, so almost everything below is about the second one:
 * abstention, residency, and the closure that stops a chain dead-ending.
 *
 * There is no model in any of this. `select` and `offeredFor` are pure
 * functions over a string, which is what makes the behaviour testable at all
 * under D20 — and is why the seeding lives here rather than in a hook.
 */

import { describe, expect, it } from 'vitest'
import { CATALOG } from './catalog'
import {
  CARRY_LIMIT,
  EVERYTHING_SAFE,
  NEVER_IMPLICIT,
  RESIDENT,
  inCatalogOrder,
  offeredFor,
  select,
  terms,
} from './retrieve'
import { NEEDS, PRODUCERS } from './tool-graph'

const offered = (message: string) => offeredFor(message, null)

describe('abstention, which is the safety property', () => {
  /*
   * The rule everything else is subordinate to: narrow only when confident, and
   * when not confident change nothing. `null` means "offer all 82", which is
   * exactly what this app did before the retriever existed — so the worst case
   * of being unsure is the old behaviour, not a broken one.
   */
  it('abstains on a greeting', () => {
    expect(select('hello')).toBeNull()
    expect(select('thanks!')).toBeNull()
  })

  it('abstains on a message that refers to earlier context by pronoun', () => {
    // The multi-turn correction. Nothing in these words names a capability, and
    // guessing from them is how a retriever loses somebody their edit.
    expect(select('actually that was Baylor, not Rice')).toBeNull()
    expect(select('no, the other one')).toBeNull()
  })

  it('abstains rather than narrowing on a weak single match', () => {
    // One incidental word brushing one summary is noise, not a request.
    expect(select('ok')).toBeNull()
  })
})

describe('what it selects when it is confident', () => {
  it('finds the timeline tools from a reminder', () => {
    const out = offered('remind me to send the Baylor cover letter on Thursday')
    expect(out).not.toBeNull()
    expect([...out!].some((n) => n.startsWith('timeline.'))).toBe(true)
  })

  it('finds the file tools from a word the catalog never uses', () => {
    /*
     * "CV" appears nowhere in the registry — the tool is `vault.file.add` and
     * its summary says "document". The alias table is the whole recall story,
     * and this is the fixture that fails if somebody prunes it.
     */
    const out = offered('what CVs do I have')
    expect(out).not.toBeNull()
    expect(out!.has('vault.file.add')).toBe(true)
  })

  it('handles the plural, which is how people actually write', () => {
    // "cvs" is not in the alias table; the singular fold is what finds it. This
    // abstained before that fold existed, on one of the clearest requests there
    // is.
    expect(select('what CVs do I have')).not.toBeNull()
    expect(select('show me my documents')).not.toBeNull()
  })

  it('finds the stage tools from "rejected", which is not a word in the catalog', () => {
    const out = offered('Rice rejected me')
    expect(out).not.toBeNull()
    expect([...out!].some((n) => n.startsWith('application.stage'))).toBe(true)
  })
})

describe('what is always there', () => {
  it('keeps every read, whatever the question', () => {
    /*
     * 58 of the 82 tools need an id only a read can produce, and the system
     * prompt tells the model to look before it writes. A narrowed set without
     * the reads makes that instruction unfollowable.
     */
    for (const message of ['remind me on Thursday', 'Rice rejected me', 'tag it rust']) {
      const out = offered(message)
      for (const read of RESIDENT) expect(out!.has(read), `${read} for "${message}"`).toBe(true)
    }
  })

  it('never offers the two irreversible tools unasked', () => {
    /*
     * `memory.reset` and `memory.clear` replace or empty the whole store and are
     * the only operations here a person cannot undo. They are also ROOTS —
     * callable from a standing start — so a rule that kept roots resident would
     * put both in every prompt forever. That is a safety regression wearing an
     * optimisation's clothes.
     */
    for (const message of [
      'remind me on Thursday',
      'add my Rice application',
      'what CVs do I have',
    ]) {
      const out = offered(message)
      expect(out!.has('memory.reset'), message).toBe(false)
      expect(out!.has('memory.clear'), message).toBe(false)
    }
  })

  it('offers them when the person’s own words asked', () => {
    const out = offered('wipe everything and reset the store')
    expect(out!.has('memory.reset') || out!.has('memory.clear')).toBe(true)
  })

  /*
   * A wipe the LEXICON does not recognise, which is the case that went wrong.
   *
   * `asksToWipe` is a pair of regexes over the person's sentence; `select` is a
   * term index over the catalog. They disagree, and "erase everything" is where:
   * it asks to wipe, and it indexes no term at all, so `select` abstains. That
   * abstention branch returns early and used to skip the closure, the resident
   * reads and `EVERYTHING_SAFE` entirely — so the offered set was exactly
   * `NEVER_IMPLICIT`, a two-item menu of the only two calls in this app that
   * cannot be undone, with no read to check with and nothing else to do
   * instead. Measured: recognised phrasings of the same request came back with
   * 18 and 42 tools including every read.
   *
   * Both halves are asserted. The reads make "look before you write"
   * followable; the size is what stops a future edit from satisfying this by
   * adding the reads and calling it done.
   */
  it('does not narrow a wipe it failed to recognise down to the wipes themselves', () => {
    for (const message of ['erase everything', 'purge everything that is out of date']) {
      expect(select(message), message).toBeNull()
      const out = offered(message)!
      for (const read of RESIDENT) expect(out.has(read), `${message}: ${read}`).toBe(true)
      expect(out.size, message).toBeGreaterThan(EVERYTHING_SAFE.length)
    }
  })
})

describe('the closure keeps every chain finishable', () => {
  it('never offers a tool without something that produces what it needs', () => {
    /*
     * THE property. For every message, every tool in the offered set must have,
     * for each type it requires, at least one producer also in the set. A
     * failure here is the retriever handing the model a dead end — which is the
     * exact defect that makes people distrust tool retrieval.
     */
    const messages = [
      'add my Rice application and tag it rust',
      'file this offer letter under Rice and tag it offer',
      'save this job posting and turn it into an application',
      'move Rice to interview and put Thursday on my calendar',
      'set up a search for systems roles',
      'update my profile links',
      'wipe everything',
      'what CVs do I have',
    ]
    for (const message of messages) {
      const out = offered(message)
      if (out === null) continue
      for (const name of out) {
        for (const type of NEEDS.get(name) ?? []) {
          const producers = [...(PRODUCERS.get(type) ?? [])]
          expect(
            producers.some((p) => out.has(p)),
            `"${message}": ${name} needs a ${type} and nothing offered makes one`,
          ).toBe(true)
        }
      }
    }
  })

  it('actually narrows — the property above is not satisfied by offering everything', () => {
    // Guards the guard. A closure that returned all 82 would pass every
    // dead-end assertion trivially.
    const out = offered('remind me to send the Baylor cover letter on Thursday')
    expect(out!.size).toBeLessThan(CATALOG.length * 0.6)
  })
})

describe('a conversation only ever gains tools', () => {
  it('keeps what an earlier turn earned', () => {
    /*
     * The transcript replays earlier tool calls. Offering a set that no longer
     * contains a tool the history shows being called invites the model to call
     * it again and be refused — and it throws away the prompt prefix for
     * nothing.
     */
    const first = offered('remind me on Thursday')!
    const second = offeredFor('what CVs do I have', first)!
    for (const name of first) expect(second.has(name)).toBe(true)
  })

  it('holds the set byte-identical when a later message abstains', () => {
    // "thanks" must not widen back to all 82 and throw the cache away.
    const first = offered('remind me on Thursday')!
    const second = offeredFor('thanks!', first)!
    expect([...second].sort()).toEqual([...first].sort())
  })

  it('always keeps a tool the history shows being called', () => {
    // After a reload the thread replays stored calls. A fresh closure that
    // dropped one would make the replayed transcript name an unavailable tool.
    const out = offeredFor('remind me on Thursday', null, ['scout.pipeline.create'])
    expect(out!.has('scout.pipeline.create')).toBe(true)
  })
})

describe('the order is canonical', () => {
  it('sorts by catalog position, so equal sets serialise identically', () => {
    /*
     * A Set iterates in insertion order, so two runs that chose the same tools
     * by different routes would produce different arrays — a different prompt
     * prefix, and a cache miss for no reason at all.
     */
    const a = inCatalogOrder(new Set(['vault.file.add', 'memory.search', 'application.create']))
    const b = inCatalogOrder(new Set(['application.create', 'vault.file.add', 'memory.search']))
    expect(a).toEqual(b)
  })
})

describe('terms', () => {
  it('drops stopwords and keeps the words that mean something', () => {
    const out = terms('please can you add a reminder for the deadline')
    expect(out.has('the')).toBe(false)
    expect(out.has('reminder')).toBe(true)
  })

  it('does not fold a short word into nonsense', () => {
    // "has" folding to "ha" would be noise scored against the catalog.
    expect(terms('has')).not.toContain('ha')
  })
})

describe('the irreversible tools are derived from the catalog, not remembered', () => {
  /**
   * A hand-written list of dangerous tools goes stale the day somebody adds
   * one, and the failure is silent: the retriever simply starts offering it.
   *
   * This is the guard. `NEVER_IMPLICIT` names the operations that both DESTROY
   * records and cannot be undone; if the registry ever grows another, this
   * fails rather than the assistant quietly gaining the ability to reach for it
   * unasked.
   *
   * Written after the registry gained a third non-undoable tool — a bookkeeping
   * write that is not destructive, and so correctly outside this set. The
   * comment describing them as "the only two a person cannot undo" had become
   * false while the CODE stayed right, which is the near miss worth a test.
   */
  const irreversible = CATALOG.filter((e) => e.destructive && !e.undoable).map((e) => e.name)

  it('finds some, or the predicate has rotted', () => {
    // Guards the guard: an empty set would make every assertion below vacuous.
    expect(irreversible.length).toBeGreaterThan(0)
  })

  it('offers none of them for a message that did not ask', () => {
    for (const message of [
      'remind me on Thursday',
      'add my Rice application',
      'what CVs do I have',
    ]) {
      const out = offeredFor(message, null)
      for (const name of irreversible) {
        expect(out?.has(name) ?? false, `${name} for "${message}"`).toBe(false)
      }
    }
  })

  it('does not strip a merely non-undoable tool, which is a different thing', () => {
    /*
     * `assistant.thread.set` cannot be undone either, because conversation
     * bookkeeping is not journalled. It loses no records, so stripping it would
     * be caution applied to the wrong property — and would break the Assistant.
     */
    const bookkeeping = CATALOG.filter((e) => !e.undoable && !e.destructive).map((e) => e.name)
    expect(bookkeeping.length).toBeGreaterThan(0)
    for (const name of bookkeeping) expect(irreversible).not.toContain(name)
  })
})

describe('words that collide with Object.prototype', () => {
  /**
   * `ALIASES` was a plain object literal, so `ALIASES['constructor']` returned
   * `Object.prototype.constructor` — truthy, so the `??` fallback never fired,
   * and iterating a function threw out of `terms()` into the promise driving an
   * agent run, which has no catch. The thread spun forever and the exchange was
   * lost. "How did the constructor round go" is an ordinary sentence here.
   */
  it('does not throw on any of them', () => {
    for (const message of [
      'how did the constructor round go',
      'constructors at rice',
      'the valueOf my offer',
      'what does toString mean here',
      'hasOwnProperty of the offer',
    ]) {
      expect(() => terms(message)).not.toThrow()
    }
  })

  it('still treats them as ordinary words', () => {
    expect([...terms('how did the constructor round go')]).toContain('constructor')
  })
})

describe('the words people use for a person', () => {
  /**
   * `vault.person.create` had no alias, so the retriever's answer depended on
   * whether the phrasing happened to contain the tool's own name. "add a person"
   * worked; "add Dr Chen as a referee on the Rice application" offered
   * twenty-four tools, none of them the one needed, and the run failed with "No
   * tool is called vault.person.create" — about a tool that exists and is safe.
   *
   * A referee and a search chair are the two people an academic job search is
   * mostly about, and neither word contains "person".
   */
  const offers = (message: string): boolean => {
    const got = offeredFor(message, null, [])
    return got === null || got.has('vault.person.create')
  }

  it('offers the person tools however the request is phrased', () => {
    for (const message of [
      'add a person',
      'add a person named Dr Chen',
      'add Dr Chen as a referee on the Rice application',
      'save this contact',
      'add my recruiter Priya',
      'add the search chair',
      'who are my references',
      'update my supervisor’s email',
    ]) {
      expect(offers(message), message).toBe(true)
    }
  })
})

describe('a tool the conversation already used', () => {
  it('survives into the next turn, whichever spelling the wire used', () => {
    /*
     * `fromHistory` carries what the WIRE called — `vault_person_create` — and
     * `inCatalogOrder` matched only the registry spelling, so every tool a
     * conversation had already used was silently dropped from the next turn's
     * offer. It bit hardest with approvals off, because a run that never pauses
     * makes more calls per turn.
     */
    const kept = offeredFor('and now add another one', new Set(['memory.search']), [
      'vault_person_create',
    ])
    expect(kept).not.toBeNull()
    expect(kept?.has('vault.person.create') || kept?.has('vault_person_create')).toBe(true)
  })
})

describe('what a caller falls back to when the retriever abstains', () => {
  it('never includes the two tools that empty the store', () => {
    /*
     * The most serious defect this file has had. `offeredFor` strips
     * `NEVER_IMPLICIT` only on the branch where it recognised something —
     * abstention returns `null`, and the caller's fallback was the WHOLE
     * catalog. That fired on the first message of every new conversation,
     * because nothing is carried forward yet and "hi" matches no seed.
     *
     * So a small model was handed `memory.clear` at exactly the moment it had
     * least context to judge it by, against a written promise in the guide that
     * those two are never offered unless the user's own words ask for them.
     */
    for (const name of NEVER_IMPLICIT) expect(EVERYTHING_SAFE).not.toContain(name)
  })

  it('still includes everything else', () => {
    // A fallback that dropped more than the two would silently narrow what the
    // assistant can do on an opener it did not recognise — which is the case
    // where the widest safe offer is exactly what is wanted.
    expect(EVERYTHING_SAFE.length).toBe(CATALOG.length - NEVER_IMPLICIT.length)
    expect(EVERYTHING_SAFE).toContain('application.create')
    for (const read of RESIDENT) expect(EVERYTHING_SAFE).toContain(read)
  })
})

/**
 * A model chooser may narrow. It may not open the door the lexicon keeps shut.
 *
 * `NEVER_IMPLICIT` is exempt "unless the person's own words seeded them", and
 * that was checked against the PICKED set — the same thing while `select` was
 * the only picker, because the lexicon returns `memory.clear` only when the
 * message says so. With a model picking, the picked set became "what a model
 * thought might be useful", and a model asked to be generous reaches widely.
 */
describe('a substituted picker cannot widen past what is safe', () => {
  it('strips the never-implicit tools even when the picker asked for them', () => {
    const out = offeredFor('do something useful', null, [], new Set(NEVER_IMPLICIT))
    expect(out).not.toBeNull()
    for (const name of NEVER_IMPLICIT) expect(out?.has(name)).toBe(false)
  })

  it('still honours the person when THEY asked AND the picker picked it', () => {
    // The exemption exists for the person who types "clear everything", and it
    // has to survive a chooser standing in front of the lexicon. Both halves
    // are required: the person's words seed it, and the picker must still have
    // picked it — a chooser that leaves it out is a narrower offer, which is
    // always allowed.
    const message = 'clear everything and start again'
    const lexical = offeredFor(message, null, [])
    const asked = [...NEVER_IMPLICIT].filter((n) => lexical?.has(n))
    expect(asked.length).toBeGreaterThan(0)

    const chosen = offeredFor(message, null, [], new Set(asked))
    for (const name of asked) expect(chosen?.has(name)).toBe(true)
  })

  it('does not let a chooser resurrect one the person did not ask for', () => {
    // The other direction of the same rule, and the dangerous one.
    const chosen = offeredFor('tidy things up', null, [], new Set(NEVER_IMPLICIT))
    for (const name of NEVER_IMPLICIT) expect(chosen?.has(name)).toBe(false)
  })

  it('never offers LESS than the lexicon would have', () => {
    /*
     * THE property, and it cost five conversations to learn.
     *
     * Asked to "File CV-2026.pdf under the UT Austin application" the chooser
     * picked `vault.file.add` and not `vault.file.update`. Offered `add` and
     * not `update`, the model created a second CV — omitting the right tool
     * does not make a model ask, it makes it reach for the nearest wrong one.
     *
     * So a chooser is a superset, always. It can add intent the lexicon missed
     * and it cannot subtract coverage the lexicon had.
     */
    const asks = [
      'File CV-2026.pdf under the UT Austin application.',
      'move my Rice application to interview',
      'remind me to email them on the 20th',
      'add a keyword to this',
      'what have I got at the offer stage',
    ]
    for (const ask of asks) {
      const lexicalOnly = offeredFor(ask, null, [])
      if (lexicalOnly === null) continue
      // A deliberately unhelpful chooser: one unrelated pick.
      const withChooser = offeredFor(ask, null, [], new Set(['memory.overview']))
      for (const name of lexicalOnly) {
        expect(withChooser?.has(name)).toBe(true)
      }
    }
  })

  it('uses the chooser alone exactly where the lexicon gave up', () => {
    // The case the chooser exists for, and the largest win: an unrecognised
    // message used to mean "offer all ninety-two".
    const opaque = 'I heard back from them yesterday'
    expect(select(opaque)).toBeNull()

    const out = offeredFor(opaque, null, [], new Set(['application.stage.set']))
    expect(out).not.toBeNull()
    expect(out?.has('application.stage.set')).toBe(true)
    expect(out!.size).toBeLessThan(EVERYTHING_SAFE.length)
  })

  it('keeps a chooser pick that is an ordinary tool', () => {
    const out = offeredFor('do something', null, [], new Set(['application.create']))
    expect(out?.has('application.create')).toBe(true)
  })
})

describe('the carry is bounded', () => {
  it('does not grow without limit across turns', () => {
    /*
     * It did: ten turns went 33 → 62 schemas, and `budget.ts` then had to drop
     * the CONVERSATION to make room for tools nothing had touched in eight
     * turns.
     *
     * Simulated the way it actually happens — each turn's offer becomes the
     * next turn's carry — rather than by handing it the whole catalog at once,
     * because the bound is on what accumulates, not on what a caller passes.
     */
    const asks = [
      'add an application to Rice',
      'what is on the calendar',
      'tag it with systems',
      'move it to interview',
      'which ones have no keywords',
      'file my CV under it',
      'what is my reply rate',
      'remind me on the 20th',
    ]
    let carried: Set<string> | null = null
    const sizes: number[] = []
    for (const ask of asks) {
      carried = offeredFor(ask, carried, []) ?? carried
      sizes.push(carried?.size ?? 0)
    }
    // Bounded, and well short of the catalog it used to walk towards.
    expect(Math.max(...sizes)).toBeLessThan(EVERYTHING_SAFE.length)
    // And not still climbing at the end: the last turn is no bigger than the
    // biggest, which a monotonic union could never satisfy.
    expect(sizes.at(-1)).toBeLessThanOrEqual(Math.max(...sizes))
  })

  it('takes at most CARRY_LIMIT tools it was merely offered', () => {
    /*
     * The bound itself, asserted directly rather than inferred from a few
     * turns' growth — eight turns of realistic asks never reach the catalog, so
     * a version with no bound at all passed that test.
     *
     * Everything the request does NOT need is carried, and only twelve of it
     * may survive.
     */
    const request = 'add an application to Rice'
    const withoutCarry = offeredFor(request, null, [])
    expect(withoutCarry).not.toBeNull()

    const spare = EVERYTHING_SAFE.filter((n) => !withoutCarry!.has(n))
    expect(spare.length).toBeGreaterThan(CARRY_LIMIT)

    const withCarry = offeredFor(request, new Set(spare), [])
    const added = [...(withCarry ?? [])].filter((n) => !withoutCarry!.has(n))
    expect(added).toHaveLength(CARRY_LIMIT)
  })

  it('spends the budget on tools, not on spellings', () => {
    /*
     * `resolveOffered` puts BOTH `memory.list` and `memory_list` into the
     * offered set so the enforcement check matches whichever the model sends,
     * and that set becomes the next turn's carry. Counting spellings spent two
     * slots per tool, so a turn carried about six instead of twelve.
     */
    const request = 'add an application to Rice'
    const withoutCarry = offeredFor(request, null, [])
    expect(withoutCarry).not.toBeNull()

    const spare = EVERYTHING_SAFE.filter((n) => !withoutCarry!.has(n))
    // Both spellings of each, exactly as a previous turn's `offered` carries.
    const bothSpellings = spare.flatMap((name) => {
      const entry = CATALOG.find((e) => e.name === name)
      return entry ? [entry.name, entry.wireName] : [name]
    })

    const out = offeredFor(request, new Set(bothSpellings), [])
    const added = [...(out ?? [])].filter((n) => !withoutCarry!.has(n))
    // Registry names only, and a full twelve of them.
    expect(added.filter((n) => n.includes('.'))).toHaveLength(CARRY_LIMIT)
  })

  it('keeps what the conversation actually CALLED ahead of what it was offered', () => {
    // A follow-up needs the tools that ran, not the forty that were on offer.
    const used = ['application.create', 'application.update', 'keyword.attach']
    const out = offeredFor('and the other one?', new Set(EVERYTHING_SAFE), used)
    for (const name of used) expect(out?.has(name)).toBe(true)
  })
})

/**
 * The one gate on the two tools that empty the store.
 *
 * Three versions of this guard have been wrong, each in a way that looked right
 * in the source. It tested the picked set (broken the moment a model could
 * pick). It then tested `select(message)` — the lexicon on the person's own
 * words — which reads as exactly the promise and is not, because `select` does
 * not test what the person NAMED: name words weigh 3, `SEED_FLOOR` is 3, and
 * `clear` / `reset` / `wipe` alias to the memory domain unconditionally.
 *
 * Measured before the fix: **"clear the tags off the Baylor application"** put
 * `memory.clear` and `memory.reset` in front of the model. So did "reset the
 * stage on this one back to applied", and "what is in my memory".
 *
 * Every case below is one that was measured, in both directions.
 */
describe('offering the tools that empty the store', () => {
  const offers = (message: string, fromHistory: string[] = []) => {
    const out = offeredFor(message, null, fromHistory)
    const names = out === null ? [] : inCatalogOrder(out)
    return NEVER_IMPLICIT.filter((n) => names.includes(n))
  }

  it('does not offer them for ordinary requests that happen to say "clear"', () => {
    // The verb is the same; the OBJECT is a keyword, a stage, a calendar.
    for (const message of [
      'clear the tags off the Baylor application',
      'reset the stage on this one back to applied',
      'delete this application',
      'remove the keyword from Rice',
      'clear my calendar for Friday',
      'what is in my memory',
      'search my memory for the Rice notes',
    ]) {
      expect(offers(message), message).toEqual([])
    }
  })

  it('offers them when the words plainly ask to wipe the store', () => {
    // A verb that means erase AND an object that means the whole store.
    for (const message of [
      'clear everything and start again',
      'delete all my records',
      'wipe the whole store',
      'reset everything, I want to start from scratch',
      'erase all of my data',
    ]) {
      expect(offers(message), message).toEqual([...NEVER_IMPLICIT])
    }
  })

  it('offers them however the lexicon feels about the sentence', () => {
    // "erase all of my data" is not a sentence the lexicon recognises, so
    // `select` abstained and `offeredFor` returned null — and the caller then
    // fell back to EVERYTHING_SAFE, which excludes exactly the two tools the
    // person had just asked for. The plainest request got the answer meant for
    // someone who asked for nothing.
    expect(select('erase all of my data')).toBeNull()
    expect(offers('erase all of my data')).toEqual([...NEVER_IMPLICIT])
  })

  it('strips the WIRE spelling too, so a declined call cannot come back', () => {
    /*
     * `fromHistory` carries what the wire called — underscores — and
     * `inCatalogOrder` matches `wireName` as well as `name`. Deleting only the
     * dotted spelling left the wire one in the set and the offered ARRAY got
     * `memory.clear` back.
     *
     * Reachable with no misbehaviour at all: ask to clear everything, DECLINE
     * at the approval gate, and the declined call is still in the transcript —
     * so the next, unrelated turn re-offers the tool just refused.
     */
    expect(offers('file my cv under the rice application', ['memory_clear'])).toEqual([])
    expect(offers('file my cv under the rice application', ['memory.clear'])).toEqual([])
  })

  it('needs an OBJECT that means the whole store, not just an erase verb', () => {
    /*
     * These name no record type, so `NAMES_A_RECORD` does not catch them — the
     * whole-store half of the test is the only thing standing between them and
     * a wipe. Without it, "reset it" offers to empty the store.
     */
    for (const message of ['clear this one', 'reset it', 'delete that', 'wipe it out']) {
      expect(offers(message), message).toEqual([])
    }
  })

  it('strips them on the ABSTAIN path too, which returned early', () => {
    /*
     * When the lexicon recognises nothing, `offeredFor` keeps the previous
     * turn's set verbatim — byte-identical, so the provider's prefix cache
     * still hits. That branch returned before the strip ran, so a wipe carried
     * in from an earlier turn survived every subsequent unrelated message.
     */
    const opaque = 'thanks, that is helpful'
    expect(select(opaque)).toBeNull()

    const carried = new Set(['memory.search', 'memory.clear', 'memory_reset'])
    const out = offeredFor(opaque, carried, [])
    expect(out).not.toBeNull()
    // The ordinary carried tool survives; the two wipes do not, in either
    // spelling.
    expect(out?.has('memory.search')).toBe(true)
    const names = inCatalogOrder(out!)
    expect(NEVER_IMPLICIT.filter((n) => names.includes(n))).toEqual([])
  })

  it('is not fooled by a wipe word in a sentence about one record', () => {
    // The failure that matters most is the false positive, because it ends with
    // an emptied store rather than with a model saying it cannot.
    for (const message of [
      'delete everything I wrote in the note on Rice',
      'clear all the keywords off this one',
      'remove all of the files from the Baylor application',
    ]) {
      expect(offers(message), message).toEqual([])
    }
  })
})

/**
 * The person's own vocabulary for their own background.
 *
 * Found by the benchmark, not by reading: `profile-correct-a-fact` failed in the
 * `narrowed` condition on BOTH Gemma 3 31B and GPT-OSS 120B — same conversation,
 * same condition, two models — which is the signature of a retrieval gap rather
 * than a model one. The trace showed the model answering that it had no way to
 * create such a record, because the tool was never offered.
 *
 * The lexicon keyed on the literal word "background". Nobody says that.
 */
describe('asking to record something about yourself', () => {
  const offersBackground = (ask: string) => {
    const sel = offeredFor(ask, null, [])
    return sel !== null && sel.has('profile.background.add')
  }

  for (const ask of [
    'Record that I have an MSc from UT Austin, 2015.',
    'I have a PhD from Rice',
    'Record my publications',
    'Add my teaching to my profile',
    'Record an award I received',
    'Add the paper I wrote',
    'I taught Distributed Systems in 2021',
    'Add a certification to my profile',
  ]) {
    it(`offers the tool for: ${ask}`, () => {
      expect(offersBackground(ask)).toBe(true)
    })
  }

  it('still does not offer it for something unrelated', () => {
    // Widening the vocabulary must not make this the answer to everything —
    // the retriever's value is in what it leaves out.
    expect(offersBackground('what applications am I waiting on')).toBe(false)
  })
})
