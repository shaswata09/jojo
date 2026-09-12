/**
 * L3 — the queue between an agent's intention and the graph.
 *
 * A pipeline agent does not write. It proposes, and `pipeline.proposal.raise`
 * is where the proposal lands; a person answers, and `pipeline.proposal.approve`
 * is where it becomes real. Splitting one write into two commits separated by a
 * human is the entire feature, so it is worth being precise about what each
 * half guarantees.
 *
 * THE APPROVAL IS ONE TRANSACTION. `ctx.call` runs the proposed tool inside this
 * tool's transaction, so applying a suggestion is one commit, one journal row
 * and one Undo that puts back BOTH the change and the fact that it was
 * approved. The alternative — run the tool, then patch the proposal — is two
 * commits, and a ⌘Z between them leaves a proposal marked approved whose effect
 * has been reverted. That state has no way back, which is why it is not
 * reachable.
 *
 * THE ARGUMENTS ARE RE-CHECKED. `ctx.call` parses the stored JSON with the
 * target tool's own schema at the moment of approval. A proposal raised against
 * a schema that has since tightened fails cleanly with the tool's own sentence
 * rather than writing a malformed record, and the whole transaction rolls back.
 *
 * THE ALLOWLIST IS CHECKED TWICE. `mayPropose` runs when the proposal is raised
 * and again when it is approved. The second check is not redundant: proposals
 * outlive builds, and a tool removed from `TWIN_TOOLS` between the two must not
 * be applicable by a card that is still on screen.
 *
 * WHAT THIS DOES NOT DEFEND AGAINST. `catalog.ts` offers every registry tool to
 * the model, `internal` included, so a general Assistant conversation can call
 * `pipeline.proposal.approve` itself and skip the card. That is bounded rather
 * than closed, and the bound is worth stating accurately, because this paragraph
 * used to state a smaller one than the code provides: it said the worst
 * reachable outcome was "a note or a tag the user had not yet said yes to".
 *
 * What holds is the allowlist, read off `TWIN_TOOLS` itself: fifteen tools, of
 * which five create, nine update and one files a conversation. No `*.delete` and
 * no `application.update` are among them — that half of the sentence was right,
 * and `core/proposal.test.ts` pins both — so nothing is destroyed and no
 * application is restaged, repriced or renamed. But an update OVERWRITES, and
 * nine of the fifteen are updates: `vault.snippet.update` replaces the body of a
 * snippet the person wrote, `timeline.item.update` moves an interview's date,
 * `profile.background.update` rewrites a fact about them, and
 * `keyword.record.set` replaces a record's whole keyword set rather than adding
 * to it. Anyone sizing this margin should be sizing that, not a tag.
 *
 * What keeps it a margin rather than a hole is the commit shape above: each of
 * those writes lands as one transaction and one journal row, so every one of
 * them has a route back — which is what auto mode already grants a twin
 * pipeline anyway (`AUTO_CAPABLE`, in `core/proposal.ts`). Route back, not one
 * keystroke, and the difference is worth measuring before leaning on it: the
 * undo ring holds `UNDO_DEPTH` = 50 entries and each approval takes one of
 * them, so a run of unasked-for edits costs one ⌘Z apiece and anything past the
 * fiftieth has to be reverted from the audit log in Settings, which keeps
 * `AUDIT_CAP` = 200. Closing it properly needs a `catalogued: false` flag on
 * `Tool`, which does not exist yet and is not worth inventing for this margin.
 */

import { isAnswerable, mayPropose } from '../core/proposal'
import { s } from '../core/schema'
import type { NodeId } from '../core/model'
import { PIPELINE_KINDS } from '../core/model'
import type { ToolName } from './index'
import { defineTool } from './tool'

const proposalId = s.id('proposal', { label: 'Suggestion' })

/** One line, in the user's language. Long enough to name a record, not a plan. */
const TITLE_MAX = 120

const trimTitle = (text: string) => {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (clean.length === 0) return 'Suggested change'
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1)}…` : clean
}

/* --------------------------------- raising -------------------------------- */

/**
 * Records one thing an agent wants to do.
 *
 * `internal`, because nothing in the palette should offer to hand-write a
 * suggestion — the queue is an agent's output, and a user who wants the effect
 * has the real tool. It is still journalled and still undoable, so a pipeline
 * that fills the queue with noise can be taken back in one gesture per round.
 */
export const proposalRaise = defineTool({
  name: 'pipeline.proposal.raise',
  title: 'Suggest a change',
  summary: 'Queues one action for the person to approve or discard.',
  effect: 'create',
  touches: ['proposal'],
  internal: true,
  system: true,
  input: s.object({
    pipelineId: s.id('pipeline', { label: 'Pipeline' }),
    kind: s.enum(PIPELINE_KINDS, { label: 'Pipeline kind' }),
    tool: s.string({ min: 1, label: 'Tool' }),
    /** The proposed tool's input, as JSON text. Parsed only at approval. */
    input: s.string({ label: 'Input' }),
    title: s.string({ min: 1, label: 'Title' }),
    rationale: s.string({ label: 'Rationale' }),
  }),
  run(ctx, input): NodeId {
    ctx.require('pipeline', input.pipelineId)

    if (!mayPropose(input.kind, input.tool)) {
      ctx.fail(`A ${input.kind} pipeline may not use ${input.tool}.`, { field: 'tool' })
    }
    // Parsed here purely to refuse malformed text at the door. The VALUE is
    // discarded — what is stored is the original string, because re-serialising
    // would quietly rewrite the payload (key order, number formatting) and the
    // stored bytes should be what the agent actually asked for.
    try {
      JSON.parse(input.input)
    } catch {
      ctx.fail('That suggestion’s arguments are not valid JSON.', { field: 'input' })
    }

    const title = trimTitle(input.title)
    const id = ctx.newId('proposal')
    ctx.tx.put({
      id,
      type: 'proposal',
      props: {
        slug: ctx.mintSlug('proposal', title),
        kind: input.kind,
        tool: input.tool,
        input: input.input,
        title,
        rationale: input.rationale.trim(),
        status: 'pending',
        proposedAt: ctx.now,
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    ctx.tx.link(id, 'FROM', input.pipelineId)
    return id
  },
  describe: (input) => ({ title: 'Suggested', description: trimTitle(input.title) }),
})

/* -------------------------------- answering ------------------------------- */

export const proposalApprove = defineTool({
  name: 'pipeline.proposal.approve',
  title: 'Approve suggestion',
  summary: 'Carries out a queued suggestion and marks it approved.',
  effect: 'update',
  // The proposal, plus whatever the inner tool touches — which is not knowable
  // from here. `touches` drives cache invalidation for the palette, and the
  // inner call declares its own, so the union is right at run time even though
  // this list cannot name it.
  touches: ['proposal'],
  input: s.object({ id: proposalId }),

  /*
   * Offered only where it can be taken.
   *
   * Without this the command palette listed every proposal ever raised —
   * answered, failed, swept — because a picker counts rows in the store and the
   * store keeps them all (see `isAnswerable`). Clicking any of them got the
   * refusal below, while the Job scout page beside it showed an empty queue.
   *
   * With no input at all, which is how the palette and `forNode` ask, the
   * answer is about the QUEUE rather than about one row: a verb nothing can be
   * done to is a verb worth withholding. `run`'s own check stays either way —
   * a card can be answered between the form opening and its submission.
   */
  available(m, input) {
    const id = input?.id
    if (id === undefined) {
      return m.ofType('proposal').some((p) => isAnswerable(p.props))
        ? { ok: true }
        : { ok: false, reason: 'There are no suggestions waiting for an answer.' }
    }
    const proposal = m.node(id, 'proposal')
    // Absent rather than answered is `run`'s to report: `ctx.require` names the
    // record, and a picker cannot offer a row that is not there anyway.
    return proposal === undefined || isAnswerable(proposal.props)
      ? { ok: true }
      : { ok: false, reason: 'That suggestion has already been answered.' }
  },

  run(ctx, input): void {
    const proposal = ctx.require('proposal', input.id)
    const { status, kind, tool, input: payload } = proposal.props

    if (status !== 'pending') {
      ctx.fail('That suggestion has already been answered.')
    }
    // The second of the two checks. See the header: a tool dropped from the
    // allowlist since this was raised must not be applicable now.
    if (!mayPropose(kind, tool)) {
      ctx.fail(`A ${kind} pipeline may no longer use ${tool}.`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      ctx.fail('That suggestion’s arguments are no longer readable.')
    }

    // The one cast in this file. `tool` is a string from storage and `ctx.call`
    // wants a `ToolName`; what makes it safe is not the cast but `execute`,
    // which looks the name up and fails if it is not a registered tool, then
    // parses `parsed` with that tool's own schema and fails if it does not fit.
    // Both failures roll this transaction back.
    ctx.call(tool as ToolName, parsed as never)

    ctx.tx.patch<'proposal'>(input.id, { status: 'approved', decidedAt: ctx.now })
  },
  describe: (input, _output, memory) => {
    // Spread rather than assigned: `exactOptionalPropertyTypes` distinguishes
    // "no description" from "a description that is undefined", and a proposal
    // deleted between the run and the describe produces the second.
    const title = memory.node(input.id, 'proposal')?.props.title
    return { title: 'Applied', ...(title === undefined ? {} : { description: title }) }
  },
})

export const proposalDiscard = defineTool({
  name: 'pipeline.proposal.discard',
  title: 'Discard suggestion',
  summary: 'Declines a queued suggestion. Nothing is changed.',
  effect: 'update',
  touches: ['proposal'],
  input: s.object({ id: proposalId }),

  /** The same gate as `pipeline.proposal.approve`, for the same reason. */
  available(m, input) {
    const id = input?.id
    if (id === undefined) {
      return m.ofType('proposal').some((p) => isAnswerable(p.props))
        ? { ok: true }
        : { ok: false, reason: 'There are no suggestions waiting for an answer.' }
    }
    const proposal = m.node(id, 'proposal')
    return proposal === undefined || isAnswerable(proposal.props)
      ? { ok: true }
      : { ok: false, reason: 'That suggestion has already been answered.' }
  },

  run(ctx, input): void {
    const proposal = ctx.require('proposal', input.id)
    if (proposal.props.status !== 'pending') {
      ctx.fail('That suggestion has already been answered.')
    }
    ctx.tx.patch<'proposal'>(input.id, { status: 'discarded', decidedAt: ctx.now })
  },
  describe: (input, _output, memory) => {
    // Spread rather than assigned: `exactOptionalPropertyTypes` distinguishes
    // "no description" from "a description that is undefined", and a proposal
    // deleted between the run and the describe produces the second.
    const title = memory.node(input.id, 'proposal')?.props.title
    return { title: 'Discarded', ...(title === undefined ? {} : { description: title }) }
  },
})

/**
 * Records why an approval could not be carried out.
 *
 * A separate commit because it has to be: the approval that failed took its own
 * transaction down with it, so there is nothing left to write the reason into.
 * The card then shows the sentence instead of an Approve button, which is the
 * only honest end state for a suggestion whose target no longer exists.
 */
export const proposalFail = defineTool({
  name: 'pipeline.proposal.fail',
  title: 'Record a failed suggestion',
  summary: 'Marks a queued suggestion as one that could not be carried out.',
  effect: 'update',
  touches: ['proposal'],
  internal: true,
  system: true,
  input: s.object({ id: proposalId, error: s.string({ min: 1, label: 'Reason' }) }),
  run(ctx, input): void {
    ctx.require('proposal', input.id)
    ctx.tx.patch<'proposal'>(input.id, {
      status: 'failed',
      decidedAt: ctx.now,
      error: input.error.trim(),
    })
  },
  describe: () => ({ title: 'Could not be applied' }),
})

/* ------------------------------- housekeeping ----------------------------- */

/**
 * Takes answered suggestions off the queue for one pipeline.
 *
 * Answered proposals stay on screen until swept rather than vanishing on the
 * spot, because the card that was just approved has to outlive the toast that
 * offers to undo it — a row that disappears at the moment you act on it takes
 * its Undo with it. The sweep is what the UI calls when the user clears.
 *
 * MARKS, DOES NOT DELETE, and the difference is the whole point. This called
 * `ctx.tx.del` until the scout started deduping against every proposal rather
 * than only the pending ones (`agent/pipelines.ts`, `knownPostings`). From that
 * moment a delete here was amnesia: clearing the list forgot which jobs the
 * person had already declined, and the next round proposed them straight back.
 * Setting `swept` keeps the row where the dedupe can read it and takes the card
 * off the screen, which is all the user asked for.
 *
 * `effect: 'delete'` still, and deliberately. The gate classifies destructive
 * work by that field, and what this does is destructive as the person
 * experiences it — a list they were reading is gone. Classifying it as an
 * update because the row survives would be arguing with the user about their
 * own screen.
 */
export const proposalSweep = defineTool({
  name: 'pipeline.proposal.sweep',
  title: 'Clear answered suggestions',
  summary: 'Removes suggestions that have already been approved or discarded.',
  effect: 'delete',
  touches: ['proposal'],
  input: s.object({ pipelineId: s.id('pipeline', { label: 'Pipeline' }) }),

  /*
   * No `available` gate, deliberately. Both housekeeping verbs are idempotent
   * and `tools.test.ts` pins it — "a second press must report nothing left
   * rather than counting the same rows again", because the number goes in the
   * toast. Withholding them on an empty queue would turn that second press from
   * a no-op into a refusal. The two verbs ABOVE are gated instead: those offer
   * a picker, and a picker of rows the tool refuses is the bug this came from.
   */

  run(ctx, input): number {
    ctx.require('pipeline', input.pipelineId)
    const settled = ctx.memory
      .ofType('proposal')
      .filter((p) => p.props.status !== 'pending' && p.props.swept !== true)
      .filter((p) => ctx.memory.out(p.id, 'FROM').some((edge) => edge.to === input.pipelineId))
    for (const p of settled) ctx.tx.patch<'proposal'>(p.id, { swept: true })
    return settled.length
  },
  describe: (_input, output) => ({
    title: 'Cleared',
    description: `${String(output)} answered ${output === 1 ? 'suggestion' : 'suggestions'}`,
  }),
})

/**
 * Empties the whole queue in one press, whatever it holds.
 *
 * ## Why this is not `sweep` in a loop
 *
 * Two things `sweep` structurally cannot do. It takes a `pipelineId` and
 * filters on a `FROM` edge, so a proposal whose pipeline has since been deleted
 * — `Proposal.pipelineId` is `string | null` precisely because that state is
 * real and has to render — belongs to no pipeline and would be swept by no
 * loop. It would sit on the queue after "Clear all", which is the one outcome a
 * button with that name may not produce. And it only touches settled rows, so
 * looping it leaves every pending card exactly where it was.
 *
 * ## One transaction, one undo
 *
 * `approveAll` deliberately runs one proposal at a time, because each approval
 * writes to a DIFFERENT record and a batch that rolled back over the fourth
 * card would throw away three decisions the person meant. Nothing of the sort
 * applies here: every write lands on a proposal row, there is no foreign record
 * to be missing, and the failure mode that justified the loop cannot occur. So
 * this is one transaction — and one Undo, which is what somebody who has just
 * cleared a list they meant to read actually wants.
 *
 * ## What it does not do
 *
 * It does not forget. Pending rows are marked `discarded`, settled rows are
 * marked `swept`, and nothing is deleted — so the scout still knows every job
 * it has offered and will not spend the next round proposing them again. A
 * clear that emptied the record as well as the screen would be a treadmill:
 * press it, and the same suggestions come back.
 */
export const proposalClear = defineTool({
  name: 'pipeline.proposal.clear',
  title: 'Clear all suggestions',
  summary:
    'Empties the suggestion queue — declines anything still waiting and takes the answered cards off the list. Nothing else is changed, and the pipelines keep running.',
  effect: 'delete',
  touches: ['proposal'],
  input: s.object({}),

  run(ctx): number {
    let cleared = 0
    for (const p of ctx.memory.ofType('proposal')) {
      if (p.props.status === 'pending') {
        ctx.tx.patch<'proposal'>(p.id, { status: 'discarded', decidedAt: ctx.now, swept: true })
        cleared += 1
      } else if (p.props.swept !== true) {
        ctx.tx.patch<'proposal'>(p.id, { swept: true })
        cleared += 1
      }
    }
    return cleared
  },

  describe: (_input, output) => ({
    title: 'Queue cleared',
    description: `${String(output)} ${output === 1 ? 'suggestion' : 'suggestions'}`,
    tone: 'danger',
  }),
})

/* -------------------------------- run state ------------------------------- */

/**
 * Bookkeeping after one round of a pipeline.
 *
 * `idleRounds` counts consecutive rounds that produced nothing, and it is a
 * stored number rather than React state because the question it answers —
 * "is there anything left for this pipeline to do?" — has to survive the page
 * being closed. A counter kept in memory resets on every reload, which is
 * exactly when a user who left a pipeline running overnight comes back to ask.
 */
export const pipelineRunRecord = defineTool({
  name: 'pipeline.run.record',
  title: 'Record a pipeline round',
  summary: 'Notes when a pipeline last ran and whether it found anything.',
  effect: 'update',
  touches: ['pipeline'],
  internal: true,
  system: true,
  input: s.object({
    id: s.id('pipeline', { label: 'Pipeline' }),
    /** How many suggestions this round raised. Zero is what makes it idle. */
    raised: s.number({ min: 0, int: true, label: 'Suggestions raised' }),
  }),
  run(ctx, input): void {
    const pipeline = ctx.require('pipeline', input.id)
    const idle = input.raised > 0 ? 0 : (pipeline.props.idleRounds ?? 0) + 1
    ctx.tx.patch<'pipeline'>(input.id, { lastRunAt: ctx.now, idleRounds: idle })
  },
  describe: () => ({ title: 'Pipeline ran' }),
})
