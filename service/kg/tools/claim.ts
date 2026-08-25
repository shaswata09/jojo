/**
 * Relating two records, once. L3.
 *
 * The write end of `core/ontology.ts` and `core/claim.ts`. Everything
 * interesting has already been decided by the time this runs: the taxonomy
 * mapped the proposed name onto a canonical one or kept it open, and the index
 * said whether the graph already holds the fact under some other name.
 *
 * What this file adds is the part that has to touch the store — reading the
 * existing claims to build that index, minting the record, and linking its two
 * ends.
 *
 * ## Refusing a duplicate is the feature, not an error
 *
 * A model reading a CV and then a cover letter proposes the same relation
 * twice, in different words both times. Storing both is how a graph becomes
 * unqueryable: "what did I build" returns the same project three times under
 * `BUILT`, `developed` and `worked on`, and no search finds all three.
 *
 * So a duplicate comes back as a REFUSAL with the existing predicate named. The
 * model is told what the graph calls it, which is the thing it could not have
 * found by searching, and the person sees one relation rather than three.
 */

import { checkClaim, indexClaims } from '../core/claim'
import type { Claim } from '../core/claim'
import { canonicalise, labelOf } from '../core/ontology'
import { s } from '../core/schema'
import type { NodeId } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import { defineTool } from './tool'

/**
 * Every stored claim, in the shape `core/claim.ts` compares.
 *
 * A claim with an end missing is skipped rather than repaired. It should not
 * exist — both edges are written in the same commit — but a half-formed record
 * off a truncated restore must not be compared against, because a claim with no
 * subject would match every proposal about anything.
 */
function storedClaims(memory: GraphSnapshot): Claim[] {
  return memory.ofType('claim').flatMap((n) => {
    const subject = memory.out(n.id, 'SUBJECT')[0]?.to
    const object = memory.out(n.id, 'OBJECT')[0]?.to
    return subject === undefined || object === undefined
      ? []
      : [{ subject, predicate: n.props.predicate, object }]
  })
}

export const claimAdd = defineTool({
  name: 'claim.add',
  title: 'Relate two records',
  summary:
    'Record that one thing relates to another — that a paper is evidence of a skill, that a project was built at an employer, that one field is part of another. Say the relation in plain words; jojo maps it onto the name it already uses, and refuses it if the graph holds the same fact under a different name.',
  effect: 'create',
  touches: ['claim'],
  input: s.object({
    subject: s.id(undefined, {
      label: 'From',
      description: 'The record the relation is about.',
    }),
    predicate: s.string({
      min: 1,
      label: 'Relation',
      description:
        'In plain words: “built”, “supervised”, “is evidence of”, “peer reviewed for”. Anything the taxonomy does not know is kept as written rather than refused.',
    }),
    object: s.id(undefined, {
      label: 'To',
      description: 'The record at the other end.',
    }),
    source: s.optional(
      s.string({ label: 'Read from', description: 'The id of the document this came from.' }),
    ),
  }),

  run(ctx, input): NodeId {
    /*
     * Read every claim and build the index fresh, every call.
     *
     * Deliberate, and a cache here would be wrong exactly when it matters: the
     * agent adds thirty relations in one run, and a stale index means the
     * twenty-ninth cannot see the second. The cost is a pass over the smallest
     * collection in the store.
     */
    const verdict = checkClaim(
      { subject: input.subject, predicate: input.predicate, object: input.object },
      indexClaims(storedClaims(ctx.memory)),
    )

    if (verdict.verdict === 'invalid') ctx.fail(verdict.why, { code: 'graph/invariant' })
    else if (verdict.verdict === 'known') {
      /*
       * A refusal, not a silent no-op, and it names the predicate the graph
       * holds it by. That name is precisely what the caller could not have
       * found by searching — they looked for "developed" and the graph says
       * "BUILT" — so without it the refusal reads as a bug and the obvious next
       * move is to add the same fact under a third name.
       */
      ctx.fail(
        `${verdict.why} It is already there as “${labelOf(verdict.existing.predicate)}”.`,
        { code: 'graph/invariant' },
      )
    }
    if (verdict.verdict !== 'new') throw new Error('unreachable')

    // Both ends have to exist. `s.id` checks the SHAPE of an id; only the store
    // knows whether anything answers to it.
    for (const end of [input.subject, input.object]) {
      if (!ctx.memory.node(end)) ctx.fail('One end of that relation is no longer here.', { code: 'graph/not-found' })
    }

    const id = ctx.newId('claim')
    ctx.tx.put({
      id,
      type: 'claim',
      props: {
        slug: ctx.mintSlug('claim', verdict.claim.predicate),
        predicate: verdict.claim.predicate,
        surface: verdict.predicate.surface,
        known: verdict.predicate.known,
        ...(input.source === undefined || input.source.trim() === ''
          ? {}
          : { source: input.source.trim() }),
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    ctx.tx.link(id, 'SUBJECT', input.subject)
    ctx.tx.link(id, 'OBJECT', input.object)
    return id
  },

  describe: (input, _out, m) => {
    const name = (id: string) => {
      const node = m.node(id as NodeId)
      const props = node?.props as { name?: string; title?: string; role?: string } | undefined
      return props?.name ?? props?.title ?? props?.role ?? 'a record'
    }
    return {
      title: 'Relation recorded',
      // The sentence, not the ids. "OSDI paper is evidence of distributed
      // systems" is checkable by a person; three uuids are not.
      description: `${name(input.subject)} ${labelOf(canonicalise(input.predicate).id)} ${name(input.object)}`,
    }
  },
})
