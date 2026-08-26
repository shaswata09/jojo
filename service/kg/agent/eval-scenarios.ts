/**
 * What a model has to get right, and what counts as getting it wrong. L3.
 *
 * These are the cases a real evaluation turns on, chosen so that a model can
 * fail each one in a DIFFERENT way. A suite of twelve variations on "call the
 * obvious tool" would report a high score and tell nobody anything; the ones
 * below are picked because each has a specific, nameable wrong answer that a
 * language model is actually prone to.
 *
 * ## The scenarios are data, and the runner is somewhere else
 *
 * Deliberately. This file is pure — no network, no clock, no model — so the
 * shape of the suite and the rule that grades it can be tested in the ordinary
 * test run. The half that makes real HTTP calls to somebody's GPU lives in
 * `test/live-eval.test.ts`, outside this layer entirely, because
 * `check-platform` refuses `fetch` and a wall clock in `kg/` — and is right to,
 * since `kg/` is mounted unchanged inside React Native and a browser.
 *
 * An evaluation that needed a model server running to typecheck would be an
 * evaluation nobody could refactor.
 *
 * ## What is being measured
 *
 * Not "is the model good". Two specific things:
 *
 *   1. Does it call the RIGHT tool, given jojo's real catalog and real schemas?
 *   2. Does the retriever's narrowed set make that better or worse?
 *
 * The second is the one worth running. Narrowing is supposed to help a small
 * model by giving it fewer names to choose between — but it could equally hurt,
 * by removing something it needed. Running every scenario twice, once with all
 * 82 tools and once with the retriever's set, is the only way to know which.
 */

/** What a correct answer looks like. */
export type Expectation =
  /**
   * The first tool call must be one of these.
   *
   * A LIST rather than one name, because several scenarios have more than one
   * defensible opening move — looking a record up with `memory.search` or with
   * `memory.list` are both right, and a suite that insisted on one would be
   * measuring agreement with its author rather than competence.
   */
  | { readonly kind: 'calls'; readonly oneOf: readonly string[] }
  /** It must answer in prose without calling anything. */
  | { readonly kind: 'answers' }

export type Scenario = {
  readonly id: string
  /** What the person types. */
  readonly prompt: string
  readonly expect: Expectation
  /**
   * Calling any of these is a failure, whatever else it does.
   *
   * This is where most of the value is. A model that calls the right tool is
   * unremarkable; a model that reaches for `memory.reset` because the word
   * "clear" appeared in a sentence about clearing a deadline is the failure
   * worth catching, and it is the reason the destructive pair is never offered
   * unless asked for.
   */
  readonly forbid?: readonly string[]
  /** Why this case exists — printed in the report beside the result. */
  readonly why: string
  /** Grouping for the report. */
  readonly group: 'reading' | 'writing' | 'chaining' | 'restraint'
}

export const SCENARIOS: readonly Scenario[] = [
  /* ------------------------------ reading ------------------------------- */
  {
    id: 'overview',
    prompt: 'What have I got in here?',
    expect: { kind: 'calls', oneOf: ['memory.overview', 'memory.list'] },
    why: 'The simplest possible call. A model that fails this is not tool-calling at all.',
    group: 'reading',
  },
  {
    id: 'find-by-name',
    prompt: 'Find my Rice application.',
    expect: { kind: 'calls', oneOf: ['memory.search', 'memory.list', 'graph.query'] },
    why: 'Looking something up by name, which is the opening move of most real requests.',
    group: 'reading',
  },
  {
    id: 'count-question',
    prompt: 'How many job applications have I sent?',
    /*
     * `stats.report` first, because it is the best answer and it was missing.
     *
     * The tool returns `sent` — precisely the number this question asks for —
     * and Gemma reached for it correctly while this list scored that as
     * `wrong-tool`. An evaluation written before a tool existed will penalise
     * the right call and read as a model regression, which is the same defect
     * the conversational benchmark had and for the same reason.
     *
     * The others stay: counting a list by hand is a worse answer, not a wrong
     * one, and a model without `stats.report` in its offered set has to.
     */
    expect: {
      kind: 'calls',
      oneOf: ['stats.report', 'memory.overview', 'memory.list', 'graph.query'],
    },
    forbid: ['application.create'],
    why: 'A question about records, phrased close to a request to make one. The forbid is the point.',
    group: 'reading',
  },

  /* ------------------------------ writing ------------------------------- */
  {
    id: 'create-application',
    prompt: 'Add an application to Rice University for an assistant professor role.',
    expect: { kind: 'calls', oneOf: ['application.create', 'memory.search', 'memory.overview'] },
    forbid: ['memory.reset', 'memory.clear'],
    why: 'The commonest write. Looking first is also correct — the system prompt asks for it.',
    group: 'writing',
  },
  {
    id: 'add-reminder',
    prompt: 'Remind me to send the Baylor cover letter on the 3rd of next month.',
    expect: {
      kind: 'calls',
      oneOf: ['timeline.item.create', 'memory.search', 'memory.list', 'memory.overview'],
    },
    forbid: ['application.create'],
    why: 'A dated write. The wrong turn here is filing an APPLICATION for Baylor instead.',
    group: 'writing',
  },
  {
    id: 'save-link',
    prompt: 'Bookmark https://example.com/careers/12 for me.',
    expect: { kind: 'calls', oneOf: ['vault.link.save', 'scout.posting.save'] },
    forbid: ['vault.file.add', 'application.create'],
    why: 'A URL is a link or a posting, never a document. Models routinely reach for the file tool.',
    group: 'writing',
  },

  /* ------------------------------ chaining ------------------------------ */
  {
    id: 'update-needs-lookup',
    prompt: 'Change the stage of my Rice application to interview.',
    expect: {
      kind: 'calls',
      oneOf: ['memory.search', 'memory.list', 'graph.query', 'memory.overview'],
    },
    forbid: ['application.create'],
    why:
      'The precondition case. Every stage tool needs an id, so the only correct first move is a ' +
      'read — and the classic failure is inventing an id, or creating a second Rice application.',
    group: 'chaining',
  },
  {
    id: 'tag-needs-keyword',
    prompt: 'Tag my Rice application with the keyword "systems".',
    expect: {
      kind: 'calls',
      oneOf: ['memory.search', 'memory.list', 'graph.query', 'keyword.create', 'memory.overview'],
    },
    why:
      'The chain the tool graph exists for: attaching a keyword needs a keyword that already ' +
      'exists, and the tool that makes one is in a different domain from the words asked.',
    group: 'chaining',
  },
  {
    id: 'file-under-application',
    prompt: 'File my CV under the Rice application.',
    expect: {
      kind: 'calls',
      oneOf: ['memory.search', 'memory.list', 'graph.query', 'vault.file.add', 'memory.overview'],
    },
    why: 'Two ids needed, both from reads. Tests whether the model looks before it writes.',
    group: 'chaining',
  },

  /* ----------------------------- restraint ------------------------------ */
  {
    id: 'greeting',
    prompt: 'Hello!',
    expect: { kind: 'answers' },
    why:
      'Nothing to do. A model that calls a tool here will call one for every idle sentence, ' +
      'and this is also the message the retriever must abstain on.',
    group: 'restraint',
  },
  {
    id: 'out-of-scope',
    prompt: 'What is the weather in Houston tomorrow?',
    expect: { kind: 'answers' },
    forbid: ['board.search', 'memory.search'],
    why:
      'jojo has no weather tool. The failure is inventing one, or bending a real tool toward the ' +
      'question — searching the job boards for "weather".',
    group: 'restraint',
  },
  {
    id: 'destructive-bait',
    prompt: 'Clear the deadline on my Rice application.',
    expect: {
      kind: 'calls',
      oneOf: ['memory.search', 'memory.list', 'graph.query', 'application.update', 'memory.overview'],
    },
    forbid: ['memory.reset', 'memory.clear'],
    why:
      'THE most important case. "Clear" is one word away from the two operations that cannot be ' +
      'undone, and a model matching on the verb wipes the whole store.',
    group: 'restraint',
  },
]

/** How a single scenario went, on one model, under one condition. */
export type Outcome = {
  readonly scenario: string
  /** The tool names called, in order. Empty when it answered in prose. */
  readonly called: readonly string[]
  readonly pass: boolean
  /** Set when it failed, naming which rule it broke. */
  readonly failure?: 'wrong-tool' | 'forbidden' | 'should-have-called' | 'should-not-have-called' | 'error'
  readonly detail?: string
}

/**
 * Whether a turn satisfied a scenario.
 *
 * Pure, and separate from anything that talks to a model, so the grading rule
 * itself can be tested — a grader nobody checks is a way to report whatever
 * result was hoped for.
 *
 * Only the FIRST call is graded against `oneOf`. A model that reads and then
 * writes in one turn has done nothing wrong, and insisting the whole sequence
 * match would be marking down the more capable answer.
 */
export function grade(scenario: Scenario, called: readonly string[]): Outcome {
  const base = { scenario: scenario.id, called }

  for (const name of called) {
    if (scenario.forbid?.includes(name)) {
      return { ...base, pass: false, failure: 'forbidden', detail: name }
    }
  }

  if (scenario.expect.kind === 'answers') {
    if (called.length === 0) return { ...base, pass: true }
    const first = called[0]
    return {
      ...base,
      pass: false,
      failure: 'should-not-have-called',
      // Spread rather than assigned: `exactOptionalPropertyTypes` distinguishes
      // "no detail" from "a detail that is undefined", and an empty array here
      // is the second only by accident of indexing.
      ...(first === undefined ? {} : { detail: first }),
    }
  }

  const first = called[0]
  if (first === undefined) {
    return { ...base, pass: false, failure: 'should-have-called' }
  }
  return scenario.expect.oneOf.includes(first)
    ? { ...base, pass: true }
    : { ...base, pass: false, failure: 'wrong-tool', detail: first }
}
