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
import { RESIDENT, inCatalogOrder, offeredFor, select, terms } from './retrieve'
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
    for (const message of ['remind me on Thursday', 'add my Rice application', 'what CVs do I have']) {
      const out = offered(message)
      expect(out!.has('memory.reset'), message).toBe(false)
      expect(out!.has('memory.clear'), message).toBe(false)
    }
  })

  it('offers them when the person’s own words asked', () => {
    const out = offered('wipe everything and reset the store')
    expect(out!.has('memory.reset') || out!.has('memory.clear')).toBe(true)
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
    for (const message of ['remind me on Thursday', 'add my Rice application', 'what CVs do I have']) {
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
