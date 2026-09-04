/**
 * The pre-exit gate, tested as a decision table.
 *
 * No model, no runtime and no fakes — the function is pure, so every test here
 * is an input and an expected verdict. What that buys is that the interesting
 * cases can be written verbatim: the sentences below are the ones jojo's own
 * benchmark and system prompt argue about, not invented prose.
 *
 * The property under test is NOT "it nudges when something is wrong". It is the
 * pair of directions: it must nudge the announcement with no write, AND it must
 * never nudge a clarifying question, because the `ambiguity` conversations score
 * asking as correct and a gate that argued with them would push the model toward
 * the exact guess they exist to catch. Half the tests below are the second
 * direction.
 */
import { describe, expect, it } from 'vitest'
import { MAX_VERIFY_NUDGES_PER_TURN, verifyBeforeExit } from './verify-gate'
import type { VerifyGateInput, VerifyStep } from './verify-gate'
import type { AgentStep } from './loop'

/* --------------------------------- fixtures ------------------------------- */

const read = (detail: string, status: VerifyStep['status'] = 'done'): VerifyStep => ({
  name: 'memory.search',
  effect: 'read',
  status,
  detail,
})

const write = (status: VerifyStep['status'], name = 'application.stage.set'): VerifyStep => ({
  name,
  effect: 'move',
  status,
  detail: 'Moved to interview.',
})

/** The gate's whole input, with the boring half defaulted. */
const gate = (over: Partial<VerifyGateInput>): VerifyGateInput => ({
  request: 'Move my Rice application to interview.',
  answer: '',
  steps: [],
  history: [],
  nudgesUsed: 0,
  ...over,
})

/* ------------------------- the failure it exists for ---------------------- */

describe('the announcement with no write', () => {
  /*
   * THE case, in the sentence bench-score.ts quotes when it explains why
   * `answerMust` had to be invented: "a model that writes nothing and says 'I've
   * moved your Rice application to interview' is scored correct".
   */
  it('nudges “I’ve moved your Rice application to interview” when nothing was called', () => {
    const v = verifyBeforeExit(gate({ answer: "I've moved your Rice application to interview." }))
    expect(v.accept).toBe(false)
    if (v.accept) return
    expect(v.reason).toBe('claimed-write-none-attempted')
    expect(v.nudge).toContain('nothing in the store has changed')
  })

  it('accepts the identical sentence when the write actually landed', () => {
    const v = verifyBeforeExit(
      gate({ answer: "I've moved your Rice application to interview.", steps: [write('done')] }),
    )
    expect(v.accept).toBe(true)
  })

  /*
   * A read is not a write. This is the whole point of splitting on `effect`: a
   * run that searched, found the record and then announced a move it never made
   * looks busy in the trace and changed nothing.
   */
  it('nudges when the run only read', () => {
    const v = verifyBeforeExit(
      gate({
        answer: 'I have updated the stage for you.',
        steps: [read('Rice University — 2 matches')],
      }),
    )
    expect(v.accept).toBe(false)
    if (v.accept) return
    expect(v.reason).toBe('claimed-write-none-attempted')
  })

  /*
   * A hallucinated tool name arrives as `effect: 'unknown'` — loop.ts refuses to
   * default it to 'read' because that would be a claim rather than an absence.
   * It never ran, so it is not an attempted write, and the model needs the
   * "make the call" sentence rather than the "your write failed" one.
   */
  it('does not count a hallucinated tool name as an attempted write', () => {
    const v = verifyBeforeExit(
      gate({
        answer: "I've moved it to interview.",
        steps: [
          {
            name: 'application_advance',
            effect: 'unknown',
            status: 'failed',
            detail: 'No such tool.',
          },
        ],
      }),
    )
    expect(v.accept).toBe(false)
    if (v.accept) return
    expect(v.reason).toBe('claimed-write-none-attempted')
  })

  it('tells the model to fix its arguments when the write failed', () => {
    const v = verifyBeforeExit(
      gate({ answer: "I've moved your Rice application.", steps: [write('failed')] }),
    )
    expect(v.accept).toBe(false)
    if (v.accept) return
    expect(v.reason).toBe('claimed-write-none-landed')
    expect(v.nudge).toContain('fix the arguments')
  })

  /*
   * A declined write is a different sentence and deliberately so. The person
   * said no; a model told to "call again" would ask them the same question
   * again, which is precisely the double-confirmation loop.ts's own prompt
   * comment says was removed from the system prompt.
   */
  it('tells the model NOT to retry when the person declined the write', () => {
    const v = verifyBeforeExit(
      gate({ answer: "I've deleted it.", steps: [write('declined', 'application.delete')] }),
    )
    expect(v.accept).toBe(false)
    if (v.accept) return
    expect(v.reason).toBe('claimed-write-none-landed')
    expect(v.nudge).toContain('not approved')
    expect(v.nudge).not.toContain('fix the arguments')
  })

  /** Terse mode: the pronoun is dropped and every first-person pattern misses it. */
  it('nudges the pronoun-dropped announcement', () => {
    const v = verifyBeforeExit(gate({ answer: 'Moved your Rice application to interview.' }))
    expect(v.accept).toBe(false)
  })

  /** jojo's own phrasing, where the verb is replaced by a preposition. */
  it('nudges “is now at the interview stage”', () => {
    const v = verifyBeforeExit(
      gate({ answer: 'Your Rice application is now at the interview stage.' }),
    )
    expect(v.accept).toBe(false)
  })

  it('nudges a bare “Done.”', () => {
    const v = verifyBeforeExit(gate({ answer: 'Done.' }))
    expect(v.accept).toBe(false)
  })

  /*
   * A question mark at the end of a lie does not make it a question. This is the
   * rule-ordering test: the claim rules run BEFORE the question exemption, and
   * models routinely end an announcement with "anything else?".
   */
  it('is not laundered by a trailing question', () => {
    const v = verifyBeforeExit(
      gate({ answer: "I've moved your Rice application to interview. Anything else?" }),
    )
    expect(v.accept).toBe(false)
    if (v.accept) return
    expect(v.reason).toBe('claimed-write-none-attempted')
  })
})

/* ---------------------- the answers that must always pass ------------------ */

describe('answers the gate must never argue with', () => {
  /*
   * `rice-ambiguous`, verbatim in shape: two Rice applications, so the sentence
   * identifies no record and the correct move is to ask. Nudging here would be
   * the gate telling the model to go and guess.
   */
  it('accepts the clarifying question the ambiguity cases reward', () => {
    const v = verifyBeforeExit(
      gate({
        answer:
          'I found two Rice applications — an Assistant Professor role in Computer Science and a Postdoctoral Fellowship in Physics. Which did you mean?',
        steps: [read('Rice University — 2 matches')],
      }),
    )
    expect(v.accept).toBe(true)
  })

  /*
   * The same question from a model that has not read yet. It names specifics
   * that are in no step and in no history, which is exactly what the
   * fabrication rule looks for — so the question exemption has to run first.
   */
  it('accepts a clarifying question even when it names things nothing read', () => {
    const v = verifyBeforeExit(
      gate({ answer: 'Do you mean the Physics postdoc or the Computer Science professorship?' }),
    )
    expect(v.accept).toBe(true)
  })

  /** The system prompt asks for this in so many words. */
  it('accepts a stated inability', () => {
    const v = verifyBeforeExit(
      gate({
        answer: "I couldn't find a Rice application in your records.",
        steps: [read('no matches')],
      }),
    )
    expect(v.accept).toBe(true)
  })

  /*
   * The case that makes the inability exemption load-bearing rather than
   * decorative, and it was found by mutation: with the exemption removed, both
   * of the tests around this one still passed, because neither reaches it. This
   * one does. "Let me know…" is how a model hands the choice back, and it is
   * indistinguishable from a promise to do the work later — `let me` is in the
   * promise pattern — so without the exemption a correct "I couldn't find it"
   * gets nudged toward inventing a record to act on, which is the exact thing
   * the system prompt forbids.
   */
  it('accepts a stated inability that hands the choice back with “let me know”', () => {
    const v = verifyBeforeExit(
      gate({
        answer:
          "I couldn't find a Rice application under that name. Let me know if it is filed under something else.",
      }),
    )
    expect(v.accept).toBe(true)
  })

  it('accepts a stated inability even with nothing read', () => {
    const v = verifyBeforeExit(gate({ answer: 'There is no such application to move.' }))
    expect(v.accept).toBe(true)
  })

  /*
   * Future tense is not a completion. The participle-only vocabulary is what
   * keeps "I can move it" out of the claim rules.
   *
   * THIS TEST USED TO ASSERT `accept: false`, with a comment one line above it
   * calling the same sentence "the correct half of an ambiguity answer" — the
   * assertion and its own rationale disagreed, and the assertion was the wrong
   * half. `rice-ambiguous` and `ut-ambiguous` score asking as the ONLY correct
   * move; sending this answer back spent a round arguing with the gold answer
   * and told the person "the assistant agreed to do the work without doing it"
   * about an assistant that had just refused to guess between two of their
   * applications.
   */
  it('does not read “I can move it once you tell me which” as a promise to move it', () => {
    const v = verifyBeforeExit(
      gate({
        answer: 'I can move it once you tell me which of the two you mean.',
        steps: [read('Rice University — 2 matches')],
      }),
    )
    expect(v.accept).toBe(true)
  })

  /*
   * The four sentences that sit just outside the exemption, one per way of
   * loosening it. Written from a mutation run: with only the first of these,
   * FOUR mutants of the exemption survived — dropping either half of the `&&`,
   * widening `let me know` to `let me`, and moving the whole thing above the
   * claim rules. Each row below is the sentence that kills one of them.
   *
   *   1. matches NEITHER half — the plain promise rule 4 was written for.
   *   2. matches the ADDRESS half only ("let me know"), no interrogative:
   *      dropping `OFFERS_A_CHOICE` would exempt an acknowledgement.
   *   3. matches the CHOICE half only ("which" as a relative pronoun):
   *      dropping `ADDRESSES_THE_PERSON` would exempt a promise.
   *   4. `let me` + an interrogative, which is why the table says `let me know`
   *      and not `let me`: "let me see WHAT I can do" is a promise, not a
   *      question.
   */
  it('still catches the promises that only LOOK like a clarification', () => {
    for (const answer of [
      'Sure, let me update that for you.',
      "OK, I'll do that — let me know if anything else comes up.",
      "I'll move the one which is at Rice.",
      'Let me see what I can do.',
    ]) {
      const v = verifyBeforeExit(gate({ answer, steps: [read('Rice University — 2 matches')] }))
      expect(v.accept, answer).toBe(false)
      if (v.accept) return
      expect(v.reason, answer).toBe('bare-acknowledgement')
    }
  })

  /*
   * The exemption sits BELOW the claim rules, and this is the sentence that
   * proves it rather than the comment that asserts it. Moving it above them
   * survived every other test in this file: "I've moved it" is a lie, and
   * appending a polite question to a lie must not buy it a pass — the same
   * argument the `?` exemption's own placement rests on.
   */
  it('a claim does not launder itself by ending with a clarifying request', () => {
    const v = verifyBeforeExit(
      gate({ answer: "I've moved it — let me know which one you want next.", steps: [] }),
    )
    expect(v.accept).toBe(false)
    if (v.accept) return
    expect(v.reason).toBe('claimed-write-none-attempted')
  })

  /*
   * Every clarifying phrasing measured as a false positive before the exemption
   * existed, pinned together — one `it` per phrasing would be four copies of
   * one assertion, and what matters is that the SET passes.
   */
  it('accepts a clarification punctuated as a request rather than a question', () => {
    for (const answer of [
      'Let me know which Rice application you mean — the postdoc one or the faculty one.',
      'Tell me which one and I will move it.',
      'Say which of the two campuses you meant.',
      'Please confirm which Rice application you mean.',
    ]) {
      expect(verifyBeforeExit(gate({ answer, steps: [] })).accept).toBe(true)
    }
  })

  it('does not read a negated claim as a claim', () => {
    const v = verifyBeforeExit(
      gate({
        answer: "I haven't moved anything, because two applications match that description.",
        steps: [read('Rice University — 2 matches')],
      }),
    )
    expect(v.accept).toBe(true)
  })

  /*
   * The `set`/`put` trap. Those two are their own past form, so they are the one
   * place a filler word between the pronoun and the verb would turn "I will now
   * set a reminder" into a completed claim. It is still caught — as a promise —
   * and the REASON is what this test pins.
   */
  it('does not read “I will now set a reminder” as a completed write', () => {
    const v = verifyBeforeExit(
      gate({
        request: 'Remind me to chase Rice on Thursday.',
        answer: 'I will now set a reminder for Thursday.',
      }),
    )
    expect(v.accept).toBe(false)
    if (v.accept) return
    expect(v.reason).toBe('bare-acknowledgement')
  })

  /*
   * A read-only question, answered from a read that happened. 42 of the
   * benchmark's 69 turns are `readOnly`; a gate that demanded a write on these
   * would be worse than no gate.
   */
  it('accepts a read-only answer built from a read that landed', () => {
    const v = verifyBeforeExit(
      gate({
        request: 'What did I tag with systems?',
        answer: 'The systems keyword is on your UT Austin application and on Stripe.',
        steps: [read('systems → UT Austin (application), Stripe (application)')],
      }),
    )
    expect(v.accept).toBe(true)
  })

  /*
   * The impersonal forms only count when the request asked for work. Reporting
   * history is not announcing a change, and "has been updated" is how a model
   * says either.
   */
  it('accepts “has been updated” when the request was a question about facts', () => {
    const v = verifyBeforeExit(
      gate({
        request: 'Which of my applications has been updated recently?',
        answer: 'Your Stripe application has been updated most recently.',
        steps: [read('Stripe — updated 2026-08-30')],
      }),
    )
    expect(v.accept).toBe(true)
  })
})

/* ------------------------------ fabrication ------------------------------- */

describe('specifics with no source', () => {
  it('nudges a record named by a run that read nothing', () => {
    const v = verifyBeforeExit(
      gate({
        request: 'What is on my calendar this week?',
        answer: 'You have an interview with Peloton on the 14th.',
      }),
    )
    expect(v.accept).toBe(false)
    if (v.accept) return
    expect(v.reason).toBe('named-unread-record')
    expect(v.nudge).toContain('Peloton')
  })

  /*
   * The fence, and the reason it is not caution. `paging.ts` truncates tool
   * output to CONTEXT_BUDGET before the model sees it, so a name genuinely read
   * can be missing from every `detail` this gate holds. Once anything landed,
   * "not in the text I have" stops being evidence.
   */
  it('accepts the same sentence once a read has landed, even if the name is not in the detail', () => {
    const v = verifyBeforeExit(
      gate({
        request: 'What is on my calendar this week?',
        answer: 'You have an interview with Peloton on the 14th.',
        steps: [read('3 items this week (truncated)')],
      }),
    )
    expect(v.accept).toBe(true)
  })

  /** A name carried in from an earlier turn is sourced, not invented. */
  it('accepts a name the conversation already mentioned', () => {
    const v = verifyBeforeExit(
      gate({
        request: 'When is it?',
        answer: 'Your Peloton interview is on the 14th.',
        history: ['Add an interview with Peloton on the 14th.', 'Added it.'],
      }),
    )
    expect(v.accept).toBe(true)
  })

  /*
   * Position one of a sentence is skipped on purpose: English capitalises it
   * regardless, and the stopword list can never be complete. The cost is a
   * missed fabrication that happens to open a sentence, which is the safe
   * direction to miss in.
   */
  it('does not treat a sentence-initial capital as a record name', () => {
    const v = verifyBeforeExit(
      gate({
        request: 'What is on my calendar this week?',
        answer: 'Everything there has already passed.',
      }),
    )
    expect(v.accept).toBe(true)
  })

  /** jojo's own vocabulary, capitalised by a model writing prose. */
  it('does not treat “Interview” or a weekday as a record name', () => {
    const v = verifyBeforeExit(
      gate({
        request: 'What is on my calendar this week?',
        answer: 'You have an Interview on Thursday.',
      }),
    )
    expect(v.accept).toBe(true)
  })
})

/* --------------------------- promises, not work --------------------------- */

describe('agreeing to do the work instead of doing it', () => {
  it('nudges a bare acknowledgement of a request for work', () => {
    const v = verifyBeforeExit(
      gate({
        request: 'Add my UT Austin application.',
        answer: "Sure, I'll take care of that for you.",
      }),
    )
    expect(v.accept).toBe(false)
    if (v.accept) return
    expect(v.reason).toBe('bare-acknowledgement')
  })

  /** A promise after the work landed is a model saying what comes next. */
  it('accepts a promise when the write already landed', () => {
    const v = verifyBeforeExit(
      gate({
        request: 'Add my UT Austin application.',
        answer: "Added it. I'll remind you about the deadline nearer the time.",
        steps: [write('done', 'application.create')],
      }),
    )
    expect(v.accept).toBe(true)
  })
})

/* --------------------------------- the bound ------------------------------ */

describe('the bound', () => {
  it('is one nudge per user turn', () => {
    expect(MAX_VERIFY_NUDGES_PER_TURN).toBe(1)
  })

  /*
   * The floor under the asymmetry. A model that cannot satisfy the gate would
   * otherwise be sent back every round until `maxSteps`, turning one bad turn
   * into a dozen inferences — and the person still never gets an answer.
   */
  it('accepts the same lie once the budget is spent', () => {
    const lie = gate({ answer: "I've moved your Rice application to interview." })
    expect(verifyBeforeExit(lie).accept).toBe(false)
    expect(verifyBeforeExit({ ...lie, nudgesUsed: 1 }).accept).toBe(true)
    expect(verifyBeforeExit({ ...lie, nudgesUsed: 7 }).accept).toBe(true)
  })

  /*
   * An empty answer belongs to loop.ts, which already ends it as an error naming
   * the server setting that causes it. Nudging would replace a diagnosis with a
   * round trip to a model that just proved it has no reply budget left.
   */
  it('leaves an empty answer to the loop', () => {
    expect(verifyBeforeExit(gate({ answer: '' })).accept).toBe(true)
    expect(verifyBeforeExit(gate({ answer: '   \n ' })).accept).toBe(true)
  })
})

/* ------------------------------ the wiring -------------------------------- */

describe('the shape the loop will hand it', () => {
  /*
   * A compile-time claim, asserted with a value so it cannot be optimised into a
   * comment: `AgentStep` — what loop.ts collects — is assignable to `VerifyStep`
   * as it stands, so the integrator passes `steps` straight through with no map
   * and no adapter. If someone narrows AgentStep later, this line goes red.
   */
  it('accepts loop.ts’s own AgentStep array unmapped', () => {
    const steps: AgentStep[] = [
      {
        id: 's1',
        name: 'application.stage.set',
        title: 'Move stage',
        effect: 'move',
        destructive: false,
        args: { id: 'a1', stage: 'interview' },
        status: 'done',
        detail: 'Moved to interview.',
      },
    ]
    const asVerify: readonly VerifyStep[] = steps
    const v = verifyBeforeExit(gate({ answer: "I've moved it.", steps: asVerify }))
    expect(v.accept).toBe(true)
  })
})
