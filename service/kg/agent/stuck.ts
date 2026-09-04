/**
 * L3 — is the model going in circles, and what should be done about it.
 *
 * ## What was already here, measured before this file existed
 *
 * `loop.ts` is not blind to repetition: it keys a counter on the tool name plus
 * the RAW argument string, appends a warning to the tool result on the second
 * and third hit, and ends the run at `REPEAT_LIMIT = 3`. Driving the real loop
 * with a scripted model, that guard fires exactly as advertised:
 *
 * | what the model did, every round | rounds burned | ended |
 * | --- | --- | --- |
 * | `memory_search {"query":"rice"}`, byte-identical | 3 | stopped |
 * | the same call, spacing varied per round | **8 (the cap)** | nothing |
 * | the same call, keys reordered per round | 5 | stopped |
 * | an invalid id, failing identically | 3 | stopped |
 *
 * Two things are wrong in that table and one is not obvious.
 *
 * **The fingerprint is the raw bytes.** `{"query":"rice"}` and
 * `{"query": "rice"}` are the same call and were counted as two different ones,
 * so a model whose sampler jitters its whitespace — which is most of what a
 * small model's formatting variance looks like — went round eight times and the
 * run ended on the cap with no answer at all. The key-order row is the same bug
 * caught late by luck: two spellings alternating means each one reaches 3 on the
 * fifth round rather than the third.
 *
 * **Succeeding and failing repeats are on one schedule.** A read re-run because
 * the model wants to check its work is ordinary, and it was killed on the third
 * one; an invalid id re-sent verbatim is the commonest small-model spiral there
 * is, and it got the same generic "the answer has not changed" note. They are
 * different failures and they want different thresholds in opposite directions.
 *
 * ## What this adds
 *
 * A fingerprint that survives formatting (canonical JSON: keys sorted, spacing
 * gone), four detectors instead of one, and escalation rather than a single
 * cliff — the shape OpenHands settled on, whose nudge is what actually breaks a
 * cycle: the model's own transcript already holds the answer, and what it has
 * not been told is that it is repeating.
 *
 * | detector | nudge | stop | taken from |
 * | --- | --- | --- | --- |
 * | same call, succeeding | 3rd | 5th | Gemini CLI's 5 |
 * | same call, failing | 2nd | 4th | OpenHands' escalate-then-terminate |
 * | a cycle A,B,A,B,A,B | 1st detection | 2nd | Gemini CLI's cycle scan |
 * | the same answer with no calls | 2nd | 3rd | — |
 * | one answer chanting a chunk of itself | — | 1st | Gemini CLI's content scan |
 *
 * ## Why those numbers and not the ones the papers print
 *
 * `DEFAULT_MAX_STEPS` is 8. Every threshold here has to fit inside eight
 * observations or it can never fire in this harness, which is why the cycle rule
 * asks for three repeats of a block rather than Gemini's five (A,B five times
 * over is ten calls — it would never once have run) and why a failing call is
 * nudged on its second rather than OpenHands' third: OpenHands' own default
 * budget is 100 iterations, so its third-strike nudge lands in the first 3% of a
 * run. Here it would land at 37%.
 *
 * ## What it deliberately does not do
 *
 * It does not touch the conversation, run anything, or decide the run is over.
 * It reads a step and returns one of three words. Whether a nudge is delivered
 * as a tool result or a user-role note, and whether a stop is an error event or
 * a polite finish, is the loop's business and stays there — `loop.ts` is where
 * "what the user sees when a run ends" lives, and a detector that emitted events
 * would be a second author of that.
 *
 * Pure and clockless (D26): no `Date`, no `Math.random`, no `node:crypto`. The
 * hash below is eight lines of FNV-1a because those eight lines run identically
 * on V8 and on Hermes and a platform hash does not.
 */

/* ------------------------------- observations ----------------------------- */

/** A call as the loop saw it, before or after execution. */
export type StuckCall = {
  /** Either spelling — registry or wire — as long as it is used consistently. */
  readonly name: string
  /**
   * The parsed arguments. `null` or absent when the model sent something that
   * was not JSON, in which case `raw` is what gets fingerprinted.
   */
  readonly args?: unknown
  /** The argument string exactly as the model wrote it. The fallback for `args`. */
  readonly raw?: string
}

/**
 * One step, as the loop finishes it.
 *
 * Fed once per CALL, not once per round: a turn asking for three tools is three
 * observations in the order they ran, which is what makes an A,B,A,B cycle
 * visible whether the model interleaves it across rounds or within one.
 */
export type StuckObservation = {
  /** `null` when the model answered instead of calling anything. */
  readonly call: StuckCall | null
  /**
   * Did the call come back a success? Ignored when `call` is `null`.
   *
   * A declined approval counts as a failure here, and should: a model re-asking
   * for a delete the user has already refused is spiralling in exactly the way
   * this is for.
   */
  readonly ok?: boolean
  /** Prose from this step — the final answer, or narration alongside calls. */
  readonly text?: string | null
}

/* --------------------------------- verdicts ------------------------------- */

export type StuckKind =
  /** The same call, succeeding, over and over. */
  | 'repeat'
  /** The same call, failing the same way, over and over. */
  | 'failing'
  /** A block of calls repeating in order — A,B,A,B,A,B. */
  | 'cycle'
  /** The same answer text, with nothing done in between. */
  | 'echo'
  /** One reply chanting a chunk of itself. */
  | 'chant'

/**
 * What to do about the step just observed.
 *
 * The `text` on a `nudge` is written FOR THE MODEL and is meant to be injected —
 * appended to the tool result it is already reading, or sent as a user-role
 * note. The `text` on a `stop` is written FOR THE PERSON, in the voice
 * `loop.ts`'s other stop reasons use, because that is where it ends up. They are
 * not interchangeable, and swapping them would show the user an instruction and
 * the model a status line.
 */
export type StuckVerdict =
  | { readonly action: 'continue' }
  | {
      readonly action: 'nudge'
      readonly kind: StuckKind
      /** How many times the offending thing has now happened. */
      readonly count: number
      /** Model-facing. Inject it. */
      readonly text: string
    }
  | {
      readonly action: 'stop'
      readonly kind: StuckKind
      readonly count: number
      /** User-facing. Show it. */
      readonly text: string
    }

const CONTINUE: StuckVerdict = { action: 'continue' }

/* ---------------------------------- limits -------------------------------- */

export type StuckLimits = {
  /** Identical successful calls before the model is told, and before it is stopped. */
  readonly repeatNudge: number
  readonly repeatStop: number
  /** Identical failing calls. Lower, because a repeated failure never resolves itself. */
  readonly failNudge: number
  readonly failStop: number
  /** Longest repeating block the cycle scan looks for, and how many repeats trip it. */
  readonly cycleMax: number
  readonly cycleRepeats: number
  /** Identical answers with no calls in between. */
  readonly echoNudge: number
  readonly echoStop: number
  /** The chant scan: chunk length, how many occurrences, how tightly packed. */
  readonly chantChunk: number
  readonly chantRepeats: number
  /**
   * The most text the chant scan will read.
   *
   * The scan is O(n) with a substring per position, and the one input here that
   * can be genuinely long is a model quoting back a pasted CV. 20k characters is
   * about 5k tokens — past any reply this harness reserves room for
   * (`RESERVED_FOR_REPLY` is 4096) — so the cap costs nothing real and bounds a
   * per-step cost that would otherwise grow with the document.
   */
  readonly chantScanChars: number
}

/**
 * The defaults, each one traceable to a measurement in the header.
 *
 * Exported so a caller can tighten them — the benchmark harness runs with a
 * larger `maxSteps` than the app and can afford Gemini's real numbers — and so a
 * test can trip a rule in three lines instead of fifteen.
 */
export const STUCK_LIMITS: StuckLimits = {
  repeatNudge: 3,
  repeatStop: 5,
  failNudge: 2,
  failStop: 4,
  cycleMax: 5,
  cycleRepeats: 3,
  echoNudge: 2,
  echoStop: 3,
  chantChunk: 50,
  chantRepeats: 10,
  chantScanChars: 20_000,
}

/* --------------------------------- hashing -------------------------------- */

/**
 * FNV-1a, twice, at two multipliers, concatenated to 16 hex characters.
 *
 * Written out rather than imported because `node:crypto` is banned in this
 * package and `@noble/hashes` — which IS a dependency — is a cryptographic
 * hash: 32 bytes of SHA-256 per 50-character chunk, thousands of chunks per
 * chanting reply, to answer a question about equality. This is not a security
 * boundary; a collision here costs one wrong sentence and nothing else.
 *
 * Two lanes rather than one because a single 32-bit hash collides at about
 * 1-in-4-billion per pair, and this is used on the argument fingerprint of a
 * destructive call: a collision there would stop a run claiming the model
 * repeated something it did not.
 */
export function hashString(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    // A second lane with a different multiplier, so the two are not the same
    // function of the input under a different seed — which would collide together.
    b = Math.imul(b ^ c, 0x85ebca6b)
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return hex(a) + hex(b)
}

/* ------------------------------- fingerprints ----------------------------- */

/**
 * How deep the canonicaliser walks before it gives up.
 *
 * Nothing in the catalogue nests past about four — an import payload is the
 * deepest — and the cap exists so a pathological argument cannot turn a
 * fingerprint into a stack overflow inside the loop.
 */
const MAX_DEPTH = 12

/** Beyond this the canonical form is hashed rather than kept. See `fingerprintCall`. */
const INLINE_LIMIT = 512

/**
 * JSON with the formatting taken out: keys sorted, no spaces, stable everywhere.
 *
 * Keys are compared by code unit, NOT `localeCompare`. Hermes ships without full
 * ICU on most Android builds and `localeCompare` there orders differently from
 * V8 — which would give the phone and the browser different fingerprints for the
 * same call, and make this detector's behaviour depend on the device.
 */
function canonical(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'string') return JSON.stringify(value)
  if (t === 'boolean') return value === true ? 'true' : 'false'
  // NaN and Infinity have no JSON spelling; `JSON.stringify` writes them as
  // null and so does this, so the two agree.
  if (t === 'number') return Number.isFinite(value as number) ? String(value) : 'null'
  if (depth >= MAX_DEPTH) return '"[deep]"'
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(',')}]`
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // `undefined` is dropped, matching `JSON.stringify`: `{a:1}` and
      // `{a:1,b:undefined}` serialise identically on the wire and are the same
      // call, so they must fingerprint the same.
      .filter(([, v]) => v !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v, depth + 1)}`).join(',')}}`
  }
  // Functions and symbols cannot arrive from a parsed wire message; if one does,
  // it is not an argument and must not make two calls look different.
  return 'null'
}

/**
 * A stable identity for "this call, again".
 *
 * Prefers the parsed arguments, so spacing and key order fall out. Falls back to
 * the raw string with its whitespace runs collapsed, which is the only thing
 * available when the model sent arguments that were not JSON — and a model
 * re-sending the SAME broken JSON is precisely the spiral worth catching, so the
 * fallback has to be formatting-insensitive too.
 *
 * The name is not folded. `application.create` and `application_create` are both
 * real spellings of one tool, but which one arrives is decided by the transport
 * and does not change within a run; normalising them would be a guess, and a
 * wrong guess merges two tools whose names differ only in punctuation.
 */
export function fingerprintCall(call: StuckCall): string {
  const body =
    call.args === undefined || call.args === null
      ? (call.raw ?? '').replace(/\s+/g, ' ').trim()
      : canonical(call.args)
  // Long arguments — a pasted posting, a CV — are hashed instead of held. A run
  // keeps one entry per distinct call and there are at most a few dozen, but the
  // arguments are unbounded and this state is carried for the whole run.
  const short = body.length <= INLINE_LIMIT ? body : `#${hashString(body)}`
  return `${call.name} ${short}`
}

/* --------------------------------- chanting ------------------------------- */

/**
 * Is this one reply repeating a chunk of itself over and over?
 *
 * Gemini CLI's content scan, kept whole because its second half is the half that
 * makes it usable: a 50-character chunk appearing ten times is NOT enough — a
 * long answer legitimately repeats a heading or a disclaimer. It is a chant only
 * when the occurrences are packed, average gap no more than 1.5 chunks, which is
 * what "the model is stuck emitting the same phrase" looks like and what a
 * document with a recurring line does not.
 *
 * Hash first, then confirm on the actual substrings: a hash collision here would
 * end somebody's run over two chunks that were never the same.
 *
 * THAT CONFIRMATION IS THE ONE LINE IN THIS FILE NO TEST COVERS, and it is
 * labelled rather than quietly left. Every other guard here was mutation-tested
 * — the bug re-introduced, a test watched to fail — and this one cannot be:
 * making it matter means exhibiting two different 50-character strings with the
 * same 64-bit hash, and nobody has one. It stays because it costs a string
 * comparison on a path that runs at most once per reply, and what it prevents is
 * a run ended over a repetition that never happened. Do not delete it on the
 * grounds that coverage says nothing reaches it.
 */
export function chanting(text: string, limits: StuckLimits = STUCK_LIMITS): boolean {
  const { chantChunk, chantRepeats, chantScanChars } = limits
  // Whitespace is normalised first so that a chant broken across lines by the
  // sampler — the usual way it arrives — is still the same chunk each time.
  const body = text.replace(/\s+/g, ' ').trim().slice(0, chantScanChars)
  if (body.length < chantChunk * 2) return false
  const seen = new Map<string, number[]>()
  for (let i = 0; i + chantChunk <= body.length; i++) {
    const key = hashString(body.slice(i, i + chantChunk))
    const at = seen.get(key)
    if (at === undefined) {
      seen.set(key, [i])
      continue
    }
    at.push(i)
    if (at.length < chantRepeats) continue
    const first = at[0] as number
    const last = at[at.length - 1] as number
    // The average distance between consecutive occurrences. Spread out, it is a
    // document that repeats a line; packed, it is a model that has come apart.
    if ((last - first) / (at.length - 1) > chantChunk * 1.5) continue
    const chunk = body.slice(first, first + chantChunk)
    if (at.every((p) => body.slice(p, p + chantChunk) === chunk)) return true
  }
  return false
}

/* ----------------------------------- state -------------------------------- */

/**
 * Everything the detector remembers, and nothing else.
 *
 * A plain value rather than a closure's private variables, so a run can be
 * replayed, a test can start halfway through one, and the benchmark can print
 * why a conversation ended. `createStuckDetector` wraps it for the loop, which
 * wants an object it can call once per step.
 */
export type StuckState = {
  /** Fingerprints in order, newest last, capped — only the cycle scan reads it. */
  readonly recent: readonly string[]
  /** Calls observed in this run. Not a clock: it counts steps, and only steps. */
  readonly steps: number
  /** How many times each call has been made in this run, at all. */
  readonly counts: ReadonlyMap<string, number>
  /** How many of those failed. */
  readonly failures: ReadonlyMap<string, number>
  /** Normalised answer text, to how many times it was given with no calls. */
  readonly answers: ReadonlyMap<string, number>
  /** Which nudges have already been sent, so none is sent twice. */
  readonly nudged: ReadonlySet<string>
  /**
   * The step at which a cycle was last pointed out, or `null`.
   *
   * A number rather than a flag in `nudged`, because the escalation needs to
   * know not just THAT the model was told but how long ago: see the stop rule.
   */
  readonly cycleNudgedAt: number | null
}

export const EMPTY_STUCK: StuckState = {
  recent: [],
  steps: 0,
  counts: new Map(),
  failures: new Map(),
  answers: new Map(),
  nudged: new Set(),
  cycleNudgedAt: null,
}

/**
 * The window the cycle scan reads.
 *
 * Exactly what the longest detectable cycle needs — a block of `cycleMax`
 * repeated `cycleRepeats` times — and not one entry more, because anything older
 * than that cannot take part in a cycle and keeping it would let a pattern from
 * the start of a long run pair up with one from the end.
 */
const windowFor = (limits: StuckLimits) => limits.cycleMax * limits.cycleRepeats

/* -------------------------------- sentences ------------------------------- */

/**
 * The nudges name the offending tool but never name a REMEDY tool.
 *
 * The tempting sentence is "call memory.search to get a real id". It is a trap:
 * `offeredFor` narrows the catalogue per request and `memory.search` is not
 * always in the offer, so on the runs where it is missing the nudge instructs
 * the model to call something it has not been given — and a model told to call a
 * tool it cannot see invents one. So the advice stays about what to STOP doing,
 * which is true whatever was offered.
 */
const repeatNudgeText = (name: string, count: number) =>
  `You have now called ${name} with exactly these arguments ${String(count)} times in this conversation, and the result has been the same every time. It will be the same again. Use what you already have, or do something different — and if something is stopping you from finishing, say so plainly instead of retrying.`

const failNudgeText = (name: string, count: number) =>
  `${name} has failed ${String(count)} times with exactly these arguments. Sending it again unchanged will fail again — the arguments are the problem, not the timing. Change them, or look up the record you need first, or tell the user what is blocking you.`

const cycleNudgeText = (names: readonly string[]) =>
  `You are going in a circle: ${names.join(', then ')}, over and over, with nothing new coming back. Stop and answer with what you have, or say what you could not work out.`

const echoNudgeText = () =>
  `You have just given the same answer twice without doing anything in between. If the request needs a tool, call it. If it cannot be done, say why — repeating the answer does not move it forward.`

const repeatStopText = (name: string, count: number) =>
  `The model called ${name} with the same arguments ${String(count)} times and got the same answer each time. Stopped, so it does not keep going. What did run is listed above.`

const failStopText = (name: string, count: number) =>
  `The model called ${name} ${String(count)} times with the same arguments and it failed every time. It is not going to start working, so the run was stopped. What did run is listed above.`

const cycleStopText = (names: readonly string[]) =>
  `The model is cycling between ${names.join(' and ')} without making progress, and did not break out of it when told. Stopped. What did run is listed above.`

const echoStopText = (count: number) =>
  `The model gave the same answer ${String(count)} times without doing anything in between. Stopped. What did run is listed above.`

const chantStopText = () =>
  `The model's reply got stuck repeating the same phrase over and over, which means it lost the thread rather than finished. Nothing further was run. Asking again, more specifically, usually works — and on a local server a lower temperature or a repeat penalty fixes it for good.`

/* ---------------------------------- the scan ------------------------------ */

/**
 * The tool names in the block that is repeating, for the sentence.
 *
 * A fingerprint is a name, a space, and a JSON body; a person reading "cycling
 * between memory.search and application.move" needs the first field, and needs
 * it de-duplicated — a block of A,A,B reads as "A and B", not "A, A and B".
 */
function blockNames(block: readonly string[]): string[] {
  const out: string[] = []
  for (const fp of block) {
    const name = fp.slice(0, fp.indexOf(' '))
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/**
 * Is the tail of `recent` the same block of length `len`, `reps` times over?
 *
 * Blocks of one distinct call are rejected on purpose. A,A,A,A,A,A satisfies
 * "a block of two, three times" and is not a cycle — it is a repeat, which the
 * counting rules own and score on their own thresholds. Letting it through here
 * would give one behaviour two owners with different numbers, and whichever
 * fired first would be the one nobody expected.
 */
function cycleAt(recent: readonly string[], len: number, reps: number): string[] | null {
  const need = len * reps
  if (recent.length < need) return null
  const tail = recent.slice(recent.length - need)
  const block = tail.slice(0, len)
  for (let i = len; i < need; i++) {
    if (tail[i] !== block[i % len]) return null
  }
  if (new Set(block).size < 2) return null
  return block
}

/**
 * One step in, one verdict out, plus the state to carry to the next step.
 *
 * ## The order of the checks is the design
 *
 * A step can satisfy several rules at once and only one sentence can be sent, so
 * the order is not arbitrary and was corrected twice while the tests were being
 * written:
 *
 *   1. **Chanting**, which is about this reply alone and needs no history.
 *   2. **A stop**, of whichever kind is due. Ending the run outranks talking.
 *   3. **A failing call**, before anything about repetition. A call that has
 *      failed four times has also been MADE four times, so both rules match —
 *      and telling a model that "the result has been the same every time" about
 *      a call that is erroring sends it hunting for a stale cache.
 *   4. **A cycle**, before the plain repeat nudge. This one is measured: in
 *      A,B,A,B,A,B every call reaches the repeat threshold of 3 on the fifth and
 *      sixth steps, one step BEFORE the block reaches three repeats — so with
 *      the repeat nudge first, the cycle sentence was never once sent. The model
 *      was told "you called memory_search three times", which is true and is not
 *      what is wrong with it.
 *   5. **The plain repeat**, which is the general case of everything above.
 */
export function observeStuck(
  state: StuckState,
  observation: StuckObservation,
  limits: StuckLimits = STUCK_LIMITS,
): { readonly state: StuckState; readonly verdict: StuckVerdict } {
  const text = observation.text ?? ''

  // Chanting is a property of THIS reply and needs no history, so it is checked
  // before anything is recorded: a reply that has come apart is not evidence
  // about which call repeats.
  if (text !== '' && chanting(text, limits)) {
    return { state, verdict: { action: 'stop', kind: 'chant', count: 1, text: chantStopText() } }
  }

  if (observation.call === null) {
    // An answer with no call. Compared with its whitespace normalised, because
    // the same sentence re-generated arrives with different line breaks, and
    // case-folded, because a model that re-answers often re-capitalises.
    const key = text.replace(/\s+/g, ' ').trim().toLowerCase()
    if (key === '') return { state, verdict: CONTINUE }
    const count = (state.answers.get(key) ?? 0) + 1
    const next: StuckState = { ...state, answers: new Map(state.answers).set(key, count) }
    if (count >= limits.echoStop) {
      return {
        state: next,
        verdict: { action: 'stop', kind: 'echo', count, text: echoStopText(count) },
      }
    }
    const mark = `echo ${key}`
    if (count >= limits.echoNudge && !state.nudged.has(mark)) {
      return {
        state: { ...next, nudged: new Set(state.nudged).add(mark) },
        verdict: { action: 'nudge', kind: 'echo', count, text: echoNudgeText() },
      }
    }
    return { state: next, verdict: CONTINUE }
  }

  const call = observation.call
  const fp = fingerprintCall(call)
  const count = (state.counts.get(fp) ?? 0) + 1
  const failed = observation.ok === false
  const fails = (state.failures.get(fp) ?? 0) + (failed ? 1 : 0)
  const recent = [...state.recent, fp].slice(-windowFor(limits))
  const steps = state.steps + 1
  const next: StuckState = {
    recent,
    steps,
    counts: new Map(state.counts).set(fp, count),
    failures: failed ? new Map(state.failures).set(fp, fails) : state.failures,
    answers: state.answers,
    nudged: state.nudged,
    cycleNudgedAt: state.cycleNudgedAt,
  }
  const stop = (kind: StuckKind, n: number, sentence: string) => ({
    state: next,
    verdict: { action: 'stop', kind, count: n, text: sentence } as const,
  })
  const nudge = (kind: StuckKind, n: number, sentence: string) => ({
    state: { ...next, nudged: new Set(state.nudged).add(`${kind} ${fp}`) },
    verdict: { action: 'nudge', kind, count: n, text: sentence } as const,
  })
  const already = (kind: StuckKind) => state.nudged.has(`${kind} ${fp}`)

  // 2 — the stops, before any sentence. Counted on FAILURES rather than on
  // calls, so a call that worked twice and then broke is not two thirds of the
  // way to a stop before it has failed once.
  if (failed && fails >= limits.failStop)
    return stop('failing', fails, failStopText(call.name, fails))
  if (!failed && count >= limits.repeatStop)
    return stop('repeat', count, repeatStopText(call.name, count))

  // 3 — a failing call, which is the most actionable thing that can be said.
  if (failed && fails >= limits.failNudge && !already('failing')) {
    return nudge('failing', fails, failNudgeText(call.name, fails))
  }

  // 4 — a cycle. Shortest block first: A,B,A,B,A,B is a cycle of two and also
  // the tail of a cycle of four, and the shorter one is both the truer
  // description and the shorter sentence.
  for (let len = 2; len <= limits.cycleMax; len++) {
    const block = cycleAt(recent, len, limits.cycleRepeats)
    if (block === null) continue
    const names = blockNames(block)
    const toldAt = state.cycleNudgedAt
    /*
     * Escalation, not a cliff, and the model gets a WHOLE BLOCK to break out.
     *
     * The first cycle in a run buys a sentence; the run ends only if the model
     * keeps circling after it. `steps >= toldAt + len` rather than "the next
     * time a cycle is seen" because a cycle is still detectable on the very next
     * step — the tail has barely changed — and stopping there would end the run
     * on a step the model chose before it had read the nudge. One full block is
     * the shortest interval in which it can have gone round again on purpose.
     */
    if (toldAt !== null) {
      if (steps >= toldAt + len) return stop('cycle', limits.cycleRepeats, cycleStopText(names))
      // Still circling, already told, not yet due. Deliberately silent: the
      // sentence has been sent and repeating it every step is what makes a model
      // stop reading its tool results.
      return { state: next, verdict: CONTINUE }
    }
    return {
      state: { ...next, cycleNudgedAt: steps },
      verdict: {
        action: 'nudge' as const,
        kind: 'cycle' as const,
        count: limits.cycleRepeats,
        text: cycleNudgeText(names),
      },
    }
  }

  // 5 — the plain repeat.
  if (!failed && count >= limits.repeatNudge && !already('repeat')) {
    return nudge('repeat', count, repeatNudgeText(call.name, count))
  }

  return { state: next, verdict: CONTINUE }
}

/* -------------------------------- the detector ---------------------------- */

export type StuckDetector = {
  /** Feed one finished step. Call once per tool call, once per call-free answer. */
  observe: (observation: StuckObservation) => StuckVerdict
  /** What it remembers, for a trace or a test. */
  state: () => StuckState
}

/**
 * The stateful wrapper, which is all the loop wants.
 *
 * One per RUN, not one per app: the counts are about this conversation's turn,
 * and a detector shared across runs would stop the second run for what the first
 * one did. `loop.ts` builds one where it builds `repeats` today.
 */
export function createStuckDetector(limits: StuckLimits = STUCK_LIMITS): StuckDetector {
  let state = EMPTY_STUCK
  return {
    observe: (observation) => {
      const result = observeStuck(state, observation, limits)
      state = result.state
      return result.verdict
    },
    state: () => state,
  }
}
