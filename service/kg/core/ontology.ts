/**
 * The relations the graph knows about, and what to do when it meets one it
 * does not. L1 core.
 *
 * ## The problem this exists for
 *
 * The edge model is closed: `Rel` is seven names baked into the edge id, the
 * index and the validator, and it describes the APP's own structure — an
 * application is at an organisation, a reminder is about an application. That
 * vocabulary is deliberately fixed and should stay fixed.
 *
 * What a model reads out of somebody's CV is not that. "Led the redesign of the
 * key-value store", "built Aurelia", "supervised six MSc dissertations" are
 * relations nobody enumerated in advance, and the same relation arrives under a
 * different name every time it is read: `worked_on`, `contributed_to`,
 * `developed`, `was involved in`. A closed list drops all of them; an
 * unconstrained list stores four spellings of one fact and finds none of them
 * when asked.
 *
 * So: a curated taxonomy that a proposal is mapped ONTO where it fits, and an
 * open lane where it does not. Nothing is ever dropped for being unrecognised.
 *
 * ## Why canonicalising is what makes deduplication possible at all
 *
 * The requirement is that the same information does not go in twice under a
 * different name — and that a keyword search cannot answer, because the two
 * spellings share no keyword. `built` and `developed` are not similar strings.
 *
 * Canonicalising first turns the problem from a text comparison into a set
 * membership test: both fold to `BUILT`, and after that a duplicate is an exact
 * match on three ids. Every hard case — inverses, symmetry — is then a rule
 * about the taxonomy rather than a guess about wording.
 *
 * ## And why the open lane is not a failure mode
 *
 * A predicate outside the taxonomy is kept, verbatim, and normalised only
 * enough to match itself: `peer reviewed for` and `peer-reviewed for` are one
 * open predicate, and neither is forced into `SERVED_ON` on a resemblance
 * nobody checked. It is worse to file a fact under the wrong relation than
 * under an unfamiliar one — the first is wrong and looks right, and the second
 * is honest and still queryable.
 */

import { fold } from './text'

/** One relation the graph understands, with the words people use for it. */
export type PredicateSpec = {
  /** The canonical name. Uppercase, because it is an identifier not a phrase. */
  readonly id: string
  /** How it reads in a sentence: 'worked at'. */
  readonly label: string
  /**
   * Surface forms a model plausibly emits for this relation.
   *
   * Hand-written and unapologetically so, in the way `agent/retrieve.ts`'s
   * alias table is. Nothing general recovers that "led", "headed" and "ran"
   * are the same relation as "managed" while "reported to" is its inverse.
   */
  readonly aliases: readonly string[]
  /** The canonical id of the relation pointing the other way, when there is one. */
  readonly inverse?: string
  /**
   * True when the direction carries no information.
   *
   * `COLLABORATED_WITH` is the same fact read either way, so a proposal in
   * either direction is a duplicate of one already stored in the other.
   */
  readonly symmetric?: boolean
}

/**
 * The taxonomy.
 *
 * Chosen for what a job search actually needs to traverse, not for coverage of
 * human affairs. The test of an entry is whether a question somebody would ask
 * needs it: "what evidence do I have for this skill" needs `EVIDENCES`, and
 * "who did I write this with" needs `AUTHORED` on both ends.
 *
 * Inverses are declared in PAIRS and checked by a test. A one-sided inverse is
 * how `A employed_by B` and `B employs A` end up as two facts.
 */
export const PREDICATES: readonly PredicateSpec[] = [
  /* ------------------------------ a career ------------------------------ */
  {
    id: 'STUDIED_AT',
    label: 'studied at',
    aliases: ['studied at', 'student at', 'educated at', 'graduated from', 'attended', 'read at', 'did a degree at', 'earned a degree from'],
  },
  {
    id: 'WORKED_AT',
    label: 'worked at',
    aliases: ['worked at', 'works at', 'employed at', 'employed by', 'employee of', 'position at', 'post at', 'role at', 'was at', 'joined'],
    inverse: 'EMPLOYED',
  },
  {
    id: 'EMPLOYED',
    label: 'employed',
    aliases: ['employed', 'employs', 'hired', 'took on'],
    inverse: 'WORKED_AT',
  },
  {
    id: 'LED',
    label: 'led',
    aliases: ['led', 'leads', 'headed', 'heads', 'ran', 'runs', 'managed', 'manages', 'directed', 'in charge of', 'responsible for', 'oversaw'],
  },
  {
    id: 'BUILT',
    label: 'built',
    /*
     * `wrote` is deliberately NOT here, and not under `AUTHORED` either. It is
     * genuinely ambiguous — "wrote the parser" is this relation and "wrote the
     * OSDI paper" is that one — and the table has no view of what sits at the
     * other end. Claiming it for either would file half the uses under the
     * wrong relation, wrongly and convincingly. It falls to the open lane,
     * where it is kept verbatim and stays findable.
     */
    aliases: ['built', 'builds', 'building', 'created', 'developed', 'develops', 'implemented', 'designed', 'engineered', 'worked on', 'contributed to', 'was involved in', 'made'],
  },
  {
    id: 'TAUGHT',
    label: 'taught',
    aliases: ['taught', 'teaches', 'teaching', 'lectured', 'lectures', 'instructed', 'convened', 'delivered'],
  },
  {
    id: 'SUPERVISED',
    label: 'supervised',
    aliases: ['supervised', 'supervises', 'mentored', 'mentors', 'advised', 'advises', 'co-supervised', 'tutored'],
    inverse: 'SUPERVISED_BY',
  },
  {
    id: 'SUPERVISED_BY',
    label: 'was supervised by',
    aliases: ['supervised by', 'advised by', 'mentored by', 'studied under', 'doctoral advisor'],
    inverse: 'SUPERVISED',
  },

  /* ---------------------------- what came out --------------------------- */
  {
    id: 'AUTHORED',
    label: 'authored',
    aliases: ['authored', 'published', 'co-authored', 'author of', 'first author on'],  // see `BUILT` on why 'wrote' is in neither
  },
  {
    id: 'AWARDED',
    label: 'was awarded',
    aliases: ['awarded', 'won', 'received', 'granted', 'recipient of', 'honoured with'],
  },
  {
    id: 'FUNDED_BY',
    label: 'was funded by',
    aliases: ['funded by', 'financed by', 'supported by', 'sponsored by', 'grant from', 'money from'],
    inverse: 'FUNDED',
  },
  {
    id: 'FUNDED',
    label: 'funded',
    aliases: ['funded', 'funds', 'financed', 'sponsors', 'sponsored', 'awarded funding to'],
    inverse: 'FUNDED_BY',
  },

  /* ------------------------- what it is evidence of ---------------------- */
  {
    id: 'EVIDENCES',
    label: 'is evidence of',
    /*
     * The one that makes a fit assessment traversable rather than textual. A
     * publication evidences a skill, so "what have I got for distributed
     * systems" walks from the requirement to the paper instead of hoping the
     * word appears in its title.
     */
    aliases: ['evidences', 'demonstrates', 'shows', 'is evidence of', 'proves', 'exemplifies', 'is an example of'],
    inverse: 'EVIDENCED_BY',
  },
  {
    id: 'EVIDENCED_BY',
    label: 'is evidenced by',
    aliases: ['evidenced by', 'demonstrated by', 'shown by', 'supported by evidence of'],
    inverse: 'EVIDENCES',
  },
  {
    id: 'USES',
    label: 'uses',
    aliases: ['uses', 'used', 'uses the', 'applies', 'applied', 'employs the method', 'built with', 'written in', 'based on'],
  },
  {
    id: 'ABOUT_SUBJECT',
    label: 'is about',
    aliases: ['about', 'concerns', 'on the subject of', 'in the area of', 'in the field of', 'topic'],
  },

  /* ------------------------------ structure ----------------------------- */
  {
    id: 'PART_OF',
    label: 'is part of',
    aliases: ['part of', 'belongs to', 'within', 'inside', 'a division of', 'a group within', 'sits in'],
    inverse: 'HAS_PART',
  },
  {
    id: 'HAS_PART',
    label: 'has part',
    aliases: ['has part', 'contains', 'includes', 'comprises', 'made up of'],
    inverse: 'PART_OF',
  },
  {
    id: 'SUBFIELD_OF',
    label: 'is a kind of',
    aliases: ['subfield of', 'a kind of', 'a type of', 'narrower than', 'specialisation of', 'specialization of', 'is a'],
    inverse: 'HAS_SUBFIELD',
  },
  {
    id: 'HAS_SUBFIELD',
    label: 'has kind',
    aliases: ['has subfield', 'broader than', 'generalises', 'generalizes'],
    inverse: 'SUBFIELD_OF',
  },
  {
    id: 'MEMBER_OF',
    label: 'is a member of',
    aliases: ['member of', 'belongs to the', 'fellow of', 'affiliated with', 'sits on', 'served on', 'on the committee of'],
  },
  {
    id: 'COLLABORATED_WITH',
    label: 'collaborated with',
    aliases: ['collaborated with', 'worked with', 'co-authored with', 'partnered with', 'joint work with'],
    symmetric: true,
  },
  {
    id: 'LOCATED_IN',
    label: 'is in',
    aliases: ['located in', 'based in', 'in', 'situated in', 'headquartered in'],
  },
  {
    id: 'REQUIRES',
    label: 'requires',
    aliases: ['requires', 'needs', 'asks for', 'calls for', 'demands', 'expects'],
  },
]

/*
 * `normalise` and its table sit ABOVE the indexes below, and that ordering is
 * load-bearing rather than tidy. `BY_ALIAS` is built at module scope and calls
 * `normalise` while doing it — so with the declaration further down, `LEADING`
 * is in its temporal dead zone and importing this file throws
 * `Cannot access 'LEADING' before initialization`. It did.
 */
/**
 * Words that carry no relation and only get in the way of matching one.
 *
 * A model writes `was_supervised_by`, `has been funded by` and `is a member
 * of` for relations the table lists as `supervised by`, `funded by` and
 * `member of`. Stripping them is the difference between a canonical hit and an
 * open predicate that means the same thing.
 *
 * Articles are stripped too, and only in front: "is a member of" needs both an
 * auxiliary and an article removed to reach "member of", which is why the loop
 * below runs until it stops changing anything.
 */
const LEADING = /^(?:is|was|were|are|has|have|had|been|being|be|did|does|do|a|an|the)\s+/

/**
 * A surface form, reduced to something comparable.
 *
 * Underscores and hyphens become spaces because a model asked for a predicate
 * returns `worked_at`, `worked-at` and `worked at` interchangeably. Everything
 * else is `fold`, which the whole app already agrees on.
 *
 * ## Why `\p{L}\p{N}` and not `a-z0-9`
 *
 * It was `[^a-z0-9 ]+`, which deletes every script that is not Latin. Measured:
 * `曾任职于`, `работал в`, `εργάστηκε στο`, `עבד ב`, `حاصل على` and `勤務先` all
 * normalised to the empty string — and `canonicalise` returns `id: ''` for
 * that, which `checkClaim` rejects with "A relation needs a name."
 *
 * So a Chinese or Russian CV populated the entities and lost EVERY relation
 * between them, against this module's own promise that nothing is dropped. The
 * caller counts only successes, so the screen said it had worked.
 *
 * Unicode property escapes keep letters and digits in any script while still
 * dropping the punctuation this is here to remove, so two spellings of one
 * unfamiliar predicate still meet — which is the whole job. An empty result now
 * means what it always claimed to: a predicate with no name in it at all.
 */
export function normalise(surface: string): string {
  let out = fold(surface)
    .replace(/[_-]+/gu, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  // Repeated, because "has been funded by" carries two of them.
  let previous = ''
  while (out !== previous) {
    previous = out
    out = out.replace(LEADING, '')
  }
  return out
}


const BY_ID: ReadonlyMap<string, PredicateSpec> = new Map(PREDICATES.map((p) => [p.id, p]))

/**
 * Surface form -> canonical id.
 *
 * Built once. An alias claimed by two predicates is a bug in the table and the
 * test says so rather than letting whichever was declared last win silently.
 */
const BY_ALIAS: ReadonlyMap<string, string> = (() => {
  const out = new Map<string, string>()
  for (const spec of PREDICATES) {
    out.set(normalise(spec.id), spec.id)
    out.set(normalise(spec.label), spec.id)
    for (const alias of spec.aliases) out.set(normalise(alias), spec.id)
  }
  return out
})()

/**
 * The same table with every key stemmed, for a tense nobody wrote down.
 *
 * Stemming only the PROPOSAL is not enough, and the failure is quiet: the table
 * lists `developed`, a model returns `developing`, and stemming the proposal
 * gives `develop` — which is in no table, so a relation the taxonomy plainly
 * covers becomes an open predicate. Both sides have to meet in the middle.
 *
 * Built after `BY_ALIAS` and never instead of it: an exact match must always
 * beat a stemmed one, because stemming is where two different relations could
 * collide and the exact form is the one somebody actually wrote.
 *
 * No two predicates in the table collide once stemmed TODAY, which makes the
 * exact lookup unreachable and unkillable by mutation. It stays because it is
 * the guarantee rather than a speed-up, and `ontology.test.ts` asserts the
 * absence of collisions directly — so the day the table grows into one, that
 * test fails rather than a word quietly resolving to the wrong relation.
 */
const BY_STEM: ReadonlyMap<string, string> = (() => {
  const out = new Map<string, string>()
  for (const [surface, id] of BY_ALIAS) {
    const key = stem(surface)
    // First writer wins. A stem claimed by two predicates is a collision the
    // exact table above has already resolved for the words people actually
    // write, and guessing between them here would undo that.
    if (!out.has(key)) out.set(key, id)
  }
  return out
})()

/** Every alias, mapped to the predicates claiming it. For the table's own test. */
export function aliasOwners(): ReadonlyMap<string, string[]> {
  const out = new Map<string, string[]>()
  for (const spec of PREDICATES) {
    for (const alias of spec.aliases) {
      const key = normalise(alias)
      const held = out.get(key)
      if (held) held.push(spec.id)
      else out.set(key, [spec.id])
    }
  }
  return out
}

/** What `canonicalise` decided, and whether the taxonomy knew the word. */
export type Predicate = {
  /** The canonical id, or the normalised surface form when it is open. */
  readonly id: string
  /** Exactly what was proposed, kept for the record. */
  readonly surface: string
  /** False when nothing in the taxonomy matched. */
  readonly known: boolean
}

/**
 * A proposed relation name, mapped onto the taxonomy or kept as it stands.
 *
 * Three attempts, narrowest first, and it stops at the first hit:
 *
 *   1. The normalised form is an id, a label or an alias.
 *   2. The form with its verb stemmed is — so `developing` and `develops` both
 *      reach `developed`, which is an alias of `BUILT`.
 *   3. Nothing. It is an open predicate, normalised so that two spellings of
 *      the same unfamiliar relation still meet.
 *
 * There is deliberately no fourth attempt at fuzzy matching. A relation filed
 * under the wrong predicate on a string resemblance is wrong and looks right,
 * which is worse than one filed under an unfamiliar name and still findable.
 */
export function canonicalise(surface: string): Predicate {
  const clean = normalise(surface)
  if (clean === '') return { id: '', surface, known: false }

  const direct = BY_ALIAS.get(clean)
  if (direct !== undefined) return { id: direct, surface, known: true }

  const stemmed = BY_STEM.get(stem(clean))
  if (stemmed !== undefined) return { id: stemmed, surface, known: true }

  return { id: clean, surface, known: false }
}

/**
 * The first word, crudely stemmed. Only the first, because it is the verb.
 *
 * `supervising students` stems to `supervise students` and not to
 * `supervise student` — the object of the phrase is not this function's
 * business, and stemming it would make `funded by grants` and `funded by a
 * grant` collide with things they are not.
 */
function stem(phrase: string): string {
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

/** The spec for a canonical predicate, or undefined for an open one. */
export const specOf = (id: string): PredicateSpec | undefined => BY_ID.get(id)

/** How a predicate reads in a sentence. Open ones read as themselves. */
export const labelOf = (id: string): string => BY_ID.get(id)?.label ?? id
