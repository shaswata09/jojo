/**
 * L3 — the pre-exit verification gate: one question asked the moment the model
 * says it is finished.
 *
 * ## The failure this exists for, measured in this repository
 *
 * A model that calls NOTHING and announces success is scored as having
 * succeeded. That is not a hypothetical: `bench-score.ts` carries the number in
 * its own comment — "an agent that calls nothing and always answers scored 16/36
 * clean and 45/69 turns", 44% of the suite for no work — and `answerMust` was
 * added specifically because "a model that writes nothing and says 'I've moved
 * your Rice application to interview' is scored correct".
 *
 * `answerMust` catches it at SCORING time, which helps whoever reads the
 * benchmark and does nothing at all for the person whose Rice application did
 * not move. This catches it at RUN time, in the one place where it is still
 * cheap to fix: the model has produced an answer with no tool call, so it is
 * about to declare itself done, and one sentence back can turn the lie into the
 * call it should have made.
 *
 * It is the first of the four changes LangChain shipped to take GPT-5.2-Codex
 * from 52.8% to 66.5% on Terminal-Bench 2.0 with no model change. The harness
 * beats the model, and this is the cheapest part of the harness.
 *
 * ## Why it is pure
 *
 * No clock, no randomness, no network, no model call — string work over facts
 * the loop already has. Three reasons, in order of how much they matter:
 *
 *   1. A verification pass that costs an inference costs it on EVERY turn,
 *      including the ~60% that are fine. On a 14B served by Ollama on a laptop
 *      that is a second of latency per turn to catch a fraction of them.
 *   2. Asking the model that just lied whether it lied is asking the failing
 *      component to grade itself. The evidence the gate needs — did a write
 *      land, was anything read — is not in the model's head, it is in `steps`.
 *   3. D26 and `check-platform`: this layer compiles unchanged into Hermes.
 *      Nothing here reads a clock or a global.
 *
 * See the note at the bottom for what a model call WOULD buy, which is real but
 * narrow.
 *
 * ## The shape of the judgement
 *
 * Every rule is asymmetric on purpose, in the same direction `retrieve.ts`
 * chooses: a wrong nudge costs a round trip and some tokens, a missed lie costs
 * the person a job application that silently did not move. But that asymmetry
 * has a floor — a model that CANNOT satisfy the gate would spin against it
 * forever — so the gate is bounded at ONE nudge per user turn
 * (`MAX_VERIFY_NUDGES_PER_TURN`), and after that every answer is accepted, lie
 * or not. One extra round is the entire budget.
 *
 * Two answers must always pass, because jojo's own suite rewards them:
 *
 *   - A clarifying QUESTION. The three `ambiguity` conversations exist to test
 *     that "Move my Rice application to interview" — which matches two records —
 *     is answered with a question and no write. Nudging that answer would
 *     actively push the model toward the exact guess those cases were written to
 *     catch.
 *   - A stated INABILITY. The system prompt says "If you cannot find a record,
 *     say so. Never create one so that there is something to act on." A gate
 *     that nudged "I couldn't find a Rice application" would be arguing with the
 *     prompt.
 */

import type { Effect } from './catalog'

/* ------------------------------- the inputs ------------------------------- */

/**
 * One step of the run, narrowed to what the gate reasons about.
 *
 * A structural type rather than an import of `AgentStep` from `loop.ts`, and
 * the reason is the direction of the dependency: `loop.ts` consults this
 * module, so this module importing `loop.ts` — even for a type, even though a
 * type import is erased — puts a cycle in the graph that the next person to add
 * a value import turns into a real one. `AgentStep` is assignable to this as it
 * stands; the loop passes `steps` straight through.
 */
export type VerifyStep = {
  readonly name: string
  /** `'unknown'` when the model named a tool that does not exist — it never ran. */
  readonly effect: Effect | 'unknown'
  readonly status: 'running' | 'done' | 'failed' | 'declined'
  /** What went back to the model. The gate reads it as "text the run has seen". */
  readonly detail?: string
}

export type VerifyGateInput = {
  /** What the person asked THIS turn, verbatim. */
  readonly request: string
  /** What the model just said, in the turn that carried no tool call. */
  readonly answer: string
  /** Every step attempted this run, in order. */
  readonly steps: readonly VerifyStep[]
  /**
   * Prior conversation text, as plain strings — user and assistant alike.
   *
   * Needed by the fabrication rule below and by nothing else. A record named in
   * the answer may have been read three turns ago, in a run whose `steps` are
   * long gone; without the history that name reads as invented. Pass whatever
   * the loop is about to send as history. Empty is safe — it only makes the
   * fabrication rule stricter, and that rule is already fenced.
   */
  readonly history: readonly string[]
  /**
   * How many verification nudges this user turn has already spent.
   *
   * The loop owns the counter — it is per USER TURN, and the gate is called once
   * per model turn, so the gate cannot count it itself. See
   * `MAX_VERIFY_NUDGES_PER_TURN`.
   */
  readonly nudgesUsed: number
}

/* ------------------------------- the verdict ------------------------------ */

export type VerifyReason =
  /** Claimed a change; this run called no write at all. */
  | 'claimed-write-none-attempted'
  /** Claimed a change; writes were attempted and every one failed or was declined. */
  | 'claimed-write-none-landed'
  /** Reported a specific record this run never read and this conversation never mentioned. */
  | 'named-unread-record'
  /** The request asked for work; the answer acknowledges or promises it instead. */
  | 'bare-acknowledgement'

export type VerifyVerdict =
  | { readonly accept: true }
  | {
      readonly accept: false
      readonly reason: VerifyReason
      /** The sentence to send back. Already phrased for a small model. */
      readonly nudge: string
    }

/**
 * The bound. One nudge per user turn, then the gate stops arguing.
 *
 * Not a tuning knob. A model that cannot satisfy the gate is not made able to by
 * being asked twice, and `maxSteps` is a hard stop precisely because "a model
 * that loops is the normal failure of small models, not an exotic one". Two
 * nudges would double the worst case of every turn this misjudges.
 *
 * Enforced HERE rather than left to the caller so the bound cannot be lost in
 * the wiring: pass `nudgesUsed` and the gate accepts unconditionally once the
 * budget is gone.
 */
export const MAX_VERIFY_NUDGES_PER_TURN = 1

/* ------------------------------- vocabulary ------------------------------- */

/*
 * Past-participle forms ONLY, and that is what makes the claim test safe.
 *
 * The dangerous false positive is a model saying what it is ABOUT to do — "I
 * will move it", "I can add that", "should I set a reminder?" — which is a
 * different failure with a different fix, and which the ambiguity cases produce
 * legitimately. Restricting the vocabulary to the completed form means "move",
 * "add" and "create" cannot match at all, so no amount of modal auxiliary in
 * front of them can be mistaken for a completion.
 *
 * `set` and `put` are the two that are their own past form. They are kept
 * because "I set a reminder for Thursday" is one of the most common claims this
 * app sees, and they are made safe by the pronoun having to sit immediately in
 * front of the verb — see FIRST_PERSON_CLAIM.
 */
const DID_IT = [
  'moved',
  'added',
  'created',
  'saved',
  'updated',
  'changed',
  'deleted',
  'removed',
  'tagged',
  'filed',
  'marked',
  'logged',
  'scheduled',
  'recorded',
  'linked',
  'imported',
  'renamed',
  'closed',
  'archived',
  'advanced',
  'stored',
  'entered',
  'set',
  'put',
].join('|')

/*
 * "I moved", "I've moved", "I have already moved", "I've gone ahead and moved".
 *
 * The auxiliary set is deliberately tiny — `'ve`, `'d`, `have` — and there is NO
 * generic filler between it and the verb. A filler group of even one word would
 * let "I will now set" through as a claim, because `set` is its own past form.
 * Every word allowed in between is an adverb that cannot change the tense.
 *
 * Negation needs no special case and gets none: "I haven't moved it" puts
 * `haven't` where the pattern requires `have` or a verb, and fails to match.
 */
const FIRST_PERSON_CLAIM = new RegExp(
  `\\b(?:i|we)\\s*(?:'ve|'d)?\\s*(?:have\\s+)?(?:(?:just|now|already|successfully|also|then)\\s+|gone\\s+ahead\\s+and\\s+)*(?:${DID_IT})\\b`,
  'i',
)

/*
 * "has been moved", "is now updated" — the same claim with the actor removed.
 *
 * Weaker evidence than the first-person form, because it is also how a model
 * REPORTS history it read: "it was moved to interview on the 4th" is a correct
 * answer to "when did that move?". So this form only counts as a claim when the
 * request asked for work in the first place. `was` alone is left out entirely
 * for the same reason — it is far more often narration than announcement.
 */
const PASSIVE_CLAIM = new RegExp(
  // The third alternative is jojo-specific and earns its place: "your Rice
  // application is now at the interview stage" is the single most common way a
  // model announces the stage write it did not make, and none of the general
  // participle forms above see it, because the verb has been replaced by the
  // preposition.
  `\\b(?:has|have|had)\\s+been\\s+(?:${DID_IT})\\b` +
    `|\\bis\\s+now\\s+(?:${DID_IT})\\b` +
    `|\\bnow\\s+(?:in|at)\\s+(?:the\\s+)?\\S+\\s+stage\\b`,
  'i',
)

/*
 * "Moved your Rice application to interview." — the same announcement with the
 * pronoun dropped, which is what a model does when told to be terse, and which
 * every pattern above misses: there is no `I`, no auxiliary and no `been`.
 *
 * Anchored at the very start of the first sentence, because that is the only
 * position where a bare past participle is an announcement rather than an
 * ordinary clause — "saved" mid-sentence is usually an adjective ("the saved
 * posting"). Gated on the request asking for work, like every other impersonal
 * form here.
 */
const LEADING_CLAIM = new RegExp(`^(?:${DID_IT})\\b`, 'i')

/** "Done." "All set." "Saved!" — a whole answer that is nothing but a claim. */
const BARE_COMPLETION = new RegExp(
  `^(?:ok(?:ay)?|right|great|sure|alright)?[,\\s]*(?:it's\\s+|that's\\s+|all\\s+)?(?:done|sorted|${DID_IT})[.!]?$`,
  'i',
)

/*
 * Imperatives that mean the person asked for a CHANGE, not an answer.
 *
 * Base forms here, the mirror of DID_IT: this reads the person's sentence, and
 * a person asking for work writes "move my Rice application", not "moved".
 */
const WORK_VERBS =
  'move|add|create|save|delete|remove|tag|update|change|remind|file|mark|log|schedule|record|link|import|rename|close|archive|advance|track|set|put|make|book|apply|attach|upload'
const ASKS_FOR_WORK = new RegExp(`\\b(?:${WORK_VERBS})\\b`, 'i')

/*
 * A question ABOUT the store is not a request for work even when it contains a
 * work verb — "what did I tag with systems?" contains `tag` and asks for
 * nothing to be changed. Anchored at the start, because that is where English
 * puts the interrogative and because a mid-sentence "which" is usually a
 * relative clause.
 */
const ASKS_ABOUT_FACTS =
  /^(?:what|when|which|who|whose|why|where|how|do i|does|did|is|are|was|were|any|show|list|tell)\b/i

/*
 * "I couldn't find it", "there is no such application".
 *
 * A legitimate completion the system prompt explicitly asks for, and one that
 * looks like a bare acknowledgement from the outside: short, no work done.
 * Checked AFTER the claim rules, so "I've moved it, though I couldn't find the
 * other one" still nudges on the half that is a lie.
 */
/*
 * "let me know", "tell me", "say which" — the model handing the decision back.
 *
 * Deliberately verbs of TELLING rather than of doing: `let me know` is on the
 * list and a bare `let me` is not, because "let me update that" is the failure
 * rule 4 exists for and "let me know which" is its opposite.
 */
const ADDRESSES_THE_PERSON =
  /\b(?:let me know|tell me|say|specify|confirm|clarify|choose|pick|point me)\b/i

/** The interrogative that makes it a request for a CHOICE and not a promise. */
const OFFERS_A_CHOICE = /\b(?:which|whether|what)\b/i

const STATED_INABILITY =
  /\b(?:can'?t|cannot|couldn'?t|unable to|don'?t have|didn'?t find|no such|nothing (?:matched|found|there)|not able to|there (?:is|are) no\b)/i

/*
 * Capitalised words that are not records.
 *
 * The fabrication rule below treats a capitalised mid-sentence token as the name
 * of something. English capitalises plenty that is not a name, and this app's
 * own vocabulary — stages, record types, weekdays — is capitalised constantly by
 * models writing prose about it. Every entry here was a false positive waiting
 * to happen, which is why the rule is additionally fenced to runs that did
 * nothing at all.
 */
const NOT_A_NAME = new Set([
  'the',
  'this',
  'that',
  'these',
  'those',
  'there',
  'their',
  'they',
  'your',
  'you',
  'yours',
  'my',
  'mine',
  'our',
  'it',
  'its',
  'his',
  'her',
  'and',
  'but',
  'for',
  'nor',
  'yet',
  'so',
  'if',
  'then',
  'now',
  'also',
  'however',
  'both',
  'either',
  'neither',
  'here',
  'once',
  'yes',
  'no',
  'none',
  'nothing',
  'nobody',
  'not',
  'okay',
  'sure',
  'sorry',
  'let',
  'let’s',
  'lets',
  'was',
  'were',
  'has',
  'have',
  'had',
  'did',
  'does',
  'can',
  'could',
  'would',
  'should',
  'will',
  'shall',
  'what',
  'when',
  'which',
  'who',
  'why',
  'where',
  'how',
  // jojo's own nouns. A model writes "your Application is in the Interview stage".
  'application',
  'applications',
  'interview',
  'interviews',
  'offer',
  'offers',
  'stage',
  'stages',
  'draft',
  'submitted',
  'rejected',
  'accepted',
  'closed',
  'withdrawn',
  'screen',
  'calendar',
  'reminder',
  'reminders',
  'timeline',
  'note',
  'notes',
  'tag',
  'tags',
  'keyword',
  'keywords',
  'document',
  'documents',
  'contact',
  'contacts',
  'organisation',
  'organization',
  'deadline',
  'deadlines',
  'task',
  'tasks',
  'job',
  'jobs',
  'role',
  'roles',
  'profile',
  'memory',
  'graph',
  'store',
  'search',
  'overview',
  'list',
  'follow',
  'up',
  'posting',
  'postings',
  'record',
  'records',
  'vault',
  'pipeline',
  'run',
  // Dates. A model capitalises these mid-sentence as a matter of course.
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'today',
  'tomorrow',
  'yesterday',
  'week',
  'month',
  'year',
  'monday’s',
])

/* --------------------------------- helpers -------------------------------- */

/** Every write this run asked for. `'unknown'` is a name that does not exist, so it never ran. */
const writesAttempted = (steps: readonly VerifyStep[]): readonly VerifyStep[] =>
  steps.filter((s) => s.effect !== 'read' && s.effect !== 'unknown')

/** Anything at all that actually completed — a read or a write. */
const anythingLanded = (steps: readonly VerifyStep[]): boolean =>
  steps.some((s) => s.status === 'done')

/**
 * The first sentence, without lookbehind.
 *
 * Deliberately a plain split: this layer compiles into Hermes, and lookbehind
 * assertions are the kind of thing that parses on one engine and throws at load
 * on another. There is no measurement behind choosing the portable spelling,
 * only the rule that this file must run everywhere `kg/` runs.
 */
const firstSentence = (text: string): string => {
  const cut = text.trim().split(/[.!?\n]/)
  return (cut[0] ?? '').trim()
}

/**
 * Names the answer asserts that the run has no source for.
 *
 * Sentence-initial words are skipped entirely. "Rice" in "I've moved your Rice
 * application" is mid-sentence and is the interesting case; "Nothing matched"
 * opens a sentence and is not a name, and skipping position one removes a whole
 * class of false positive for the cost of missing a record that happens to start
 * a sentence. Missing one is the safe direction.
 */
const unsourcedNames = (answer: string, seen: string): readonly string[] => {
  const haystack = seen.toLowerCase()
  const out: string[] = []
  for (const sentence of answer.split(/[.!?\n]/)) {
    const words = sentence.trim().split(/\s+/)
    for (let i = 1; i < words.length; i++) {
      /*
       * Trimmed of punctuation, then cut at the first apostrophe. The cut does
       * two jobs and the second one was found by a test in this file: it makes a
       * possessive match its base name, so "Peloton's" is sourced by a step that
       * said "Peloton" — and it stops "I'll" being read as the name of a record.
       * Before the cut, "Sure, I'll take care of that" was reported as a
       * fabricated record called `I'll`.
       */
      const word = (words[i] ?? '')
        .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
        .split(/['\u2019]/)[0] as string
      if (word.length < 3) continue
      if (!/^[A-Z]/.test(word)) continue
      const lower = word.toLowerCase()
      if (NOT_A_NAME.has(lower)) continue
      if (haystack.includes(lower)) continue
      if (!out.includes(word)) out.push(word)
    }
  }
  return out
}

/* ------------------------------- the gate --------------------------------- */

/**
 * Should this answer be accepted as the end of the turn, or sent back once?
 *
 * Called by the loop at exactly one place: a turn with `toolCalls.length === 0`,
 * after the existing empty-reply and call-written-as-prose guards, before
 * `finish('answered')`.
 *
 * The rule order is load-bearing and is not alphabetical:
 *
 *   1. Budget first, so the bound cannot be reasoned around.
 *   2. Claims before exemptions, so "I've moved it. Anything else?" nudges —
 *      a question mark at the end of a lie does not make it a question.
 *   3. Exemptions (question, stated inability) before the softer rules, so a
 *      clarifying answer never trips the fabrication or acknowledgement tests.
 */
export function verifyBeforeExit(input: VerifyGateInput): VerifyVerdict {
  const { request, answer, steps, history, nudgesUsed } = input
  const accept: VerifyVerdict = { accept: true }

  // The bound. Once spent, every answer is accepted — see MAX_VERIFY_NUDGES_PER_TURN.
  if (nudgesUsed >= MAX_VERIFY_NUDGES_PER_TURN) return accept

  const said = answer.trim()

  /*
   * There is deliberately NO `if (said === '') return accept` here, and its
   * absence was measured rather than assumed: every rule below needs text to
   * fire on, so an empty answer already falls through to accept and the branch
   * was unreachable-effect code — it could not be made to fail by any mutation,
   * which by this codebase's own rule means the test pinning it would have been
   * a test that cannot fail.
   *
   * The contract still holds and is still tested: an empty reply belongs to
   * `loop.ts`, which ends it as an ERROR naming the server setting that causes
   * it, and a nudge here would replace a diagnosis somebody can act on with a
   * round trip to a model that just proved it has no reply budget left. The test
   * guards against a future rule that fires on nothing.
   */

  const askedForWork = ASKS_FOR_WORK.test(request) && !ASKS_ABOUT_FACTS.test(request.trim())

  /* -- 1. It says it did something, and the store says otherwise. ----------- */

  const claimed =
    FIRST_PERSON_CLAIM.test(said) ||
    (askedForWork &&
      (PASSIVE_CLAIM.test(said) ||
        BARE_COMPLETION.test(firstSentence(said)) ||
        LEADING_CLAIM.test(firstSentence(said))))

  if (claimed) {
    const writes = writesAttempted(steps)
    const landed = writes.filter((s) => s.status === 'done')
    if (landed.length === 0) {
      /*
       * Two different sentences because the fixes are different, and a small
       * model handed the wrong one does the wrong thing. Nothing attempted
       * means "make the call". Attempted and refused means the call is not the
       * missing piece — the person needs to be told it did not happen, and a
       * model told merely to "make the call" will make the same failing call
       * again and burn the round.
       */
      if (writes.length === 0) {
        return {
          accept: false,
          reason: 'claimed-write-none-attempted',
          nudge:
            'Stop: you said you changed something, but this turn has not called a single tool that writes, so nothing in the store has changed. Either make the call that does it now, or tell the person plainly that nothing was changed and why.',
        }
      }
      const declined = writes.some((s) => s.status === 'declined')
      return {
        accept: false,
        reason: 'claimed-write-none-landed',
        nudge: declined
          ? 'Stop: you said you changed something, but the write was declined and nothing in the store has changed. Do not repeat the call — tell the person it was not approved, so they can decide.'
          : 'Stop: you said you changed something, but every write you attempted this turn failed, so nothing in the store has changed. Read the failure above, fix the arguments and call again, or tell the person what is blocking you.',
      }
    }
    return accept
  }

  /* -- 2. The three answers that must always pass. ------------------------- */

  /*
   * A question. The ambiguity conversations score asking as the CORRECT move —
   * "There are two Rice applications, so this sentence identifies no record.
   * The correct answer is a question; picking one is the failure". This is
   * checked after the claim rules, so a question mark cannot launder a lie, and
   * before everything below, so an honest question is never picked at for its
   * contents.
   */
  if (said.includes('?')) return accept

  /*
   * The same move, punctuated as a request rather than a question — and the
   * sentence above USED TO BE THE WHOLE OF IT, which made this file's own claim
   * ("an honest question is never picked at for its contents") false for every
   * clarification a model happens to write without a `?`.
   *
   * Measured against the three `ambiguity` conversations in
   * `bench-conversations.ts`, which are the only ones whose gold move is
   * `shouldAsk: true` and whose prompts — "Move my Rice application to
   * interview.", "Close the UT application — they turned me down." — both set
   * `askedForWork`. Run through this gate with no writes attempted, three of six
   * natural clarifying phrasings were sent back as `bare-acknowledgement`:
   *
   *   "Let me know which Rice application you mean…"   NUDGE
   *   "Tell me which one — I can move either."          NUDGE
   *   "Say which one and I will move it."               NUDGE
   *
   * `let me` is in rule 4's own `promise` alternation, so "Let me know WHICH" —
   * a request for information — read as "let me DO it", which is the opposite
   * claim. The cost was a wasted round on exactly the turns where asking is the
   * scored answer, plus a note telling the person "the assistant agreed to do
   * the work without doing it" about an assistant that correctly refused to
   * guess between two of their applications.
   *
   * BOTH halves are required, and that is what keeps it from swallowing rule 4.
   * A bare acknowledgement addresses the person too ("let me update that") and
   * an interrogative appears in ordinary prose ("the one which is at Rice"); it
   * is the pair that means "I am asking YOU to choose". On a 16-phrase corpus of
   * real clarifications and real acknowledgements the pair separated all 16,
   * where either half alone did not.
   *
   * Placed with the `?` exemption rather than inside rule 4 on purpose: a
   * clarification should no more be picked at by the fabrication rule than a
   * question should, and it is already past the claim rules, so it cannot
   * launder "I've moved it, tell me which one you want next".
   */
  if (ADDRESSES_THE_PERSON.test(said) && OFFERS_A_CHOICE.test(said)) return accept

  // "I couldn't find it" — what the system prompt asks for when nothing matches.
  if (STATED_INABILITY.test(said)) return accept

  /* -- 3. Specifics with no source. ---------------------------------------- */

  /*
   * Fenced to runs where NOTHING completed, and the fence is not caution — it is
   * the only thing that makes the rule sound.
   *
   * `paging.ts` truncates tool output to `CONTEXT_BUDGET` before it reaches the
   * model, so a record genuinely read can be absent from every `detail` string
   * this gate can see. Against a run that read something, "this name is not in
   * the text I have" is therefore not evidence the name was invented. Against a
   * run that read NOTHING, there is nothing to have been truncated: any specific
   * in the answer came from the conversation or from nowhere.
   */
  if (!anythingLanded(steps)) {
    const seen = [request, ...history, ...steps.map((s) => s.detail ?? '')].join(' ')
    const invented = unsourcedNames(said, seen)
    if (invented.length > 0) {
      return {
        accept: false,
        reason: 'named-unread-record',
        nudge: `Stop: you named ${invented.slice(0, 3).join(', ')} but this turn read nothing, so that did not come from the store. Read first — memory.overview, then memory.search or memory.list — and answer from what actually comes back.`,
      }
    }
  }

  /* -- 4. Agreeing to do the work instead of doing it. --------------------- */

  /*
   * The exact failure the system prompt's second line already fights — "Do not
   * describe what you would do — do it, then say what you did" — which means it
   * is a failure that survives being told not to, which is why it needs a gate
   * and not another sentence of prompt.
   *
   * Only when the request asked for a change and nothing was written: a promise
   * in the middle of a run that DID write is a model saying what it will do
   * next, which is fine.
   */
  if (askedForWork && writesAttempted(steps).every((s) => s.status !== 'done')) {
    const promise =
      /\b(?:i\s*(?:'ll|'d)|i\s+(?:will|shall|am going to|can|could)|let\s+me|going\s+to|i\s+would)\b/i
    const opener =
      /^(?:ok(?:ay)?|sure|got it|understood|will do|right|no problem|of course|absolutely|sounds good|certainly|happy to|great)\b/i
    if (opener.test(said) || promise.test(said)) {
      return {
        accept: false,
        reason: 'bare-acknowledgement',
        nudge:
          'Stop: that request asked you to change something and you have agreed to it without doing it. Nothing has happened yet. Make the tool call now, or say what is stopping you.',
      }
    }
  }

  return accept
}

/*
 * WOULD A MODEL CALL BEAT THIS? On one rule, yes, and it is the rule this file
 * is least sure of.
 *
 * `named-unread-record` is lexical: it asks whether a capitalised token appears
 * in text the run has seen. It cannot tell "your Rice postdoc interview is on
 * the 18th" — a fabricated DATE against a real record — from a correct answer,
 * because the date is not a capitalised token, and it cannot see a paraphrase
 * ("the physics one") of a record that was read. A judge model handed the
 * answer, the request and the rendered step outcomes, asked one question —
 * "which factual claims in this answer are not supported by the text above?" —
 * would catch both.
 *
 * It is not built, for the reason at the top: it costs an inference on every
 * turn, including the majority that are fine, and the three rules above it
 * catch the failure jojo has actually measured — the announcement with no
 * write. If a judge is ever added it should run ONLY when this function returns
 * accept and the run wrote nothing, which is a small fraction of turns and
 * exactly the population where the lexical rule is blind.
 */
