/**
 * L3.5 — the two pipeline agents: what they are told, and what they can reach.
 *
 * Both run the same `runAgent` loop the Assistant runs. What differs is the
 * prompt, the tool list, and one thing that is neither: a pipeline agent's
 * writes do not land. They are intercepted by `proposingHost` and stored as
 * proposals for a person to answer.
 *
 * WHY INTERCEPT RATHER THAN GIVE IT A `propose` TOOL. The obvious design hands
 * the model a single `pipeline.proposal.raise` and lets it fill in a `tool` name
 * and a JSON payload. It was rejected on model quality: that shape asks a small
 * local model to write a nested JSON string by hand, with no schema on the inner
 * object, when the whole reason the tool layer publishes JSON Schema per tool is
 * that models are much better at filling in a described shape than at inventing
 * one. Intercepting keeps the model on the ergonomics it is good at — it calls
 * `application.note.set` with the fields it was shown — and moves the queueing
 * to a layer that cannot get it wrong.
 *
 * WHAT THE MODEL IS TOLD ABOUT THIS. The truth, in the announcement it gets
 * back: queued, not done. A wrapper that answered "Done (id: file-3)" would be
 * handing the model an id for a record that does not exist, and the next call
 * would build on it. So `run` returns no id and says so, and the prompt says it
 * again in prose, because a model that thinks its writes landed will spend its
 * remaining steps verifying them.
 */

import { PIPELINE_TOOLS, isKnownPosting, mayPropose } from '../core/proposal'
import type { NodeId, PipelineKind } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import { entryFor } from './catalog'
import type { ToolHost } from './execute'
import { READS } from './queries'
import { displayOf } from '../tools/support'

/** Every read, always. An agent that cannot look cannot usefully propose. */
const READ_NAMES = Object.keys(READS)

/* ------------------------------- the prompts ------------------------------ */

/**
 * Shared by both, and it is mostly about what NOT to do.
 *
 * The failure mode these sentences are written against is a model that treats
 * an empty field as a problem to be solved: it will invent a follow-up date, a
 * recruiter's name, a salary band, because the field was there and blank. A
 * job tracker that fabricates is worse than one that is incomplete, and the
 * user cannot tell the difference by looking at their own graph.
 */
const COMMON = [
  'You are working through someone’s job-application records on their own machine.',
  'Everything you propose is shown to them as a card they approve or discard, so propose the thing itself rather than asking whether you should.',
  'Nothing you call takes effect immediately. Each one is queued, and you will be told so — do not call it again, and do not try to verify it afterwards.',
  'Never invent a fact. If a field is empty and nothing in the records tells you what belongs there, leave it empty; an empty field is not a problem to fix.',
  'Look before you propose. Read the records first, and do not propose something the records already contain.',
].join(' ')

/**
 * The twin's instructions, rewritten around what it is actually for.
 *
 * It used to say "make the records match what the person already knows but has
 * not written down", and every example under it was about an APPLICATION — a
 * note, a reminder, a keyword. That is useful work and it is not a twin: the
 * pipeline responsible for building a picture of the PERSON had no way to
 * record a fact about one, so it tidied job records and the profile stayed ten
 * fields somebody typed.
 *
 * The first job is now building that picture, and the ordering is deliberate.
 * Reading a CV is the only operation available here that adds a fact the graph
 * did not hold; everything else rearranges what is already there. A round that
 * tags three applications while an unread CV sits in the Vault has done the
 * cheap half.
 *
 * The specific gaps are appended per run by `promptFor`, which computes them
 * rather than asking — see `core/twin.ts` for why absence is the one thing a
 * model should not be asked to notice.
 */
const TWIN_PROMPT = [
  COMMON,
  'Your job is to build and maintain a picture of the PERSON, so that later the app can weigh a job posting against what they have actually done.',
  'That picture lives in their background: degrees, posts held, publications, skills, teaching, awards, service.',
  'Your first duty is to read documents they have uploaded — a CV, a research or teaching statement — with vault.file.read, and record what those documents SAY with profile.background.add.',
  'Copy what is written. Do not infer a degree from a job title, do not promote “familiar with” into a skill, and omit anything the document does not state. A fabricated line in someone’s own record is worse than a missing one, because they will read it as something they wrote.',
  'Always pass the document’s id as the source on every entry, so a fact can be traced back to the sentence that produced it and a wrong one can be found.',
  'Once the background exists, connect it: a skill they have should be one of their keywords, and a document should be filed under the application it plainly belongs to.',
  'After that, the ordinary tidying — a note recording something the other records imply, a reminder for a deadline that has none.',
  'Prefer few and specific over many and generic. Five suggestions someone accepts beat twenty they scroll past.',
  'When there is nothing missing, say so and stop. That is a complete answer, not a failure.',
].join(' ')

const SCOUT_PROMPT = [
  COMMON,
  'Your job is to find job postings worth this person’s attention, using their profile and the searches they have saved.',
  'Start by reading the boards you were given with board.search, one address at a time. Use the addresses in the prompt; do not invent one, and do not try to read a page that is not a job board.',
  'If no board can be read, work from what is in the records instead: the postings and matches already saved, the profile’s roles, regions and terms, and the applications they have made.',
  'Never propose a posting that is already saved or already an application, under any spelling of its link.',
  'For each one, say in the rationale what makes it a fit and what they would need to tailor from what they already have.',
  'If there is nothing new worth showing, say so and stop.',
].join(' ')

export const PIPELINE_PROMPTS: { readonly [K in PipelineKind]: string } = {
  twin: TWIN_PROMPT,
  scout: SCOUT_PROMPT,
}

/**
 * The tools a run is offered: every read, plus that kind's writes.
 *
 * The reads are what make the "do not invent" instruction followable — a model
 * told not to guess and given no way to look has only one move left.
 */
export function toolsForKind(kind: PipelineKind): string[] {
  return [...READ_NAMES, ...PIPELINE_TOOLS[kind]]
}

/* ---------------------------- naming a proposal --------------------------- */

/**
 * The one-line title on the card.
 *
 * Built from the catalog's own verb and the record the call names, so it reads
 * as a sentence about the user's data — "Add a reminder · Rice — Assistant
 * professor" — rather than as a function call. Falls back to the bare verb when
 * the input names nothing, which is right for a create.
 */
export function proposalTitle(memory: GraphSnapshot, tool: string, input: unknown): string {
  const verb = entryFor(tool)?.title ?? tool
  const subject = subjectOf(memory, input)
  return subject ? `${verb} · ${subject}` : verb
}

/** The display name of whatever record an input points at, if it points at one. */
function subjectOf(memory: GraphSnapshot, input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const fields = input as Record<string, unknown>
  // `id` first, then the filing fields, because a call that names both is
  // usually about the record it names and merely filed under the other.
  const filed = fields['applicationIds']
  const candidates = [fields['id'], fields['record'], ...(Array.isArray(filed) ? filed : [])]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const name = nameOf(memory, candidate as NodeId)
    if (name) return name
  }
  // No id — a create. Its own title is the best subject available.
  for (const key of ['title', 'name', 'role']) {
    const value = fields[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * A node's human name, whatever kind it is.
 *
 * Reads the props positionally rather than switching on the type, because the
 * switch would be a fourteen-arm copy of a fact each node already carries: the
 * field a user would call its name. A node whose props have none returns null
 * and the caller falls back, which is better than a title reading "undefined".
 */
function nameOf(memory: GraphSnapshot, id: NodeId): string | null {
  const node = memory.node(id)
  if (!node) return null
  const props = node.props as Record<string, unknown>
  /*
   * The employer is an EDGE, not a prop, which is the trap this branch exists
   * for. Reading `props.org` returned undefined and the card titles came out as
   * "Edit note · CS" — the role with no employer, which on a page listing eight
   * applications names none of them. `displayOf` walks the `AT` edge, and it is
   * the same function the toasts use, so a card and the toast that follows it
   * name the record identically.
   */
  if (node.type === 'application') return displayOf(memory, id) || null
  for (const key of ['title', 'name', 'role']) {
    const value = props[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/* ----------------------------- the proposing host ------------------------- */

export type ProposalSink = {
  pipelineId: NodeId
  kind: PipelineKind
  /**
   * The model's own words for why, supplied by the driver.
   *
   * `runAgent` emits the prose a model writes alongside its calls as a `note`
   * event, and that prose is the rationale — the model has already explained
   * itself and asking it again in a field would get a worse answer. The driver
   * holds the latest note and this reads it at call time.
   */
  rationale: () => string
}

/**
 * A host whose writes queue instead of landing.
 *
 * Reads pass straight through, and that is deliberate: the agent must see the
 * real graph or it cannot check whether what it is about to propose is already
 * there. Only `run` is intercepted, and only for the tools the kind allows —
 * anything else comes back as a sentence the model can act on, which is how
 * `callTool` reports every other mistake.
 */
/**
 * Every spelling of every job this person already knows about.
 *
 * Three sources, and all three are needed. Saved postings are the obvious one.
 * Applications carry a `url` too, and a scout that re-proposed a job the user
 * has already APPLIED to would be the most annoying version of this bug.
 * Pending proposals are the third and least obvious: two rounds in the same
 * session would otherwise each propose the same posting, because the first
 * one's suggestion has not been accepted yet and so is not a posting.
 */
function knownPostings(memory: GraphSnapshot): string[] {
  const urls: string[] = []
  for (const node of memory.ofType('posting')) urls.push(node.props.url)
  for (const node of memory.ofType('application')) {
    if (node.props.url) urls.push(node.props.url)
  }
  for (const node of memory.ofType('proposal')) {
    if (node.props.status !== 'pending' || node.props.tool !== 'scout.posting.save') continue
    try {
      const parsed = JSON.parse(node.props.input) as { url?: unknown }
      if (typeof parsed.url === 'string') urls.push(parsed.url)
    } catch {
      // A payload that will not parse cannot name a duplicate. It is refused at
      // approval by the tool's own schema, which is where that belongs.
    }
  }
  return urls
}

/** The same question for a match, which has no URL — so, its role. */
function knownRoles(memory: GraphSnapshot): Set<string> {
  const roles = new Set<string>()
  const fold = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')
  for (const node of memory.ofType('match')) roles.add(fold(node.props.role))
  for (const node of memory.ofType('proposal')) {
    if (node.props.status !== 'pending' || node.props.tool !== 'scout.match.save') continue
    try {
      const parsed = JSON.parse(node.props.input) as { role?: unknown }
      if (typeof parsed.role === 'string') roles.add(fold(parsed.role))
    } catch {
      /* see above */
    }
  }
  return roles
}

/**
 * Is this something the person has already been shown?
 *
 * In the host rather than in the prompt, because "do not propose a posting that
 * is already saved" is a rule and a prompt is a request — and because the model
 * cannot check reliably even when it wants to: the same LinkedIn job reached
 * from a search, an alert email and a shared link is three different URLs, and
 * telling them apart is `postingKey`'s job, not a language model's.
 *
 * Returns the sentence to send back, or null when it is genuinely new. The
 * sentence matters: a refusal the model can read is a refusal it can act on,
 * and the next call is usually a different job rather than the same one again.
 */
function duplicateOf(memory: GraphSnapshot, tool: string, input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const fields = input as Record<string, unknown>

  if (tool === 'scout.posting.save') {
    const url = fields['url']
    if (typeof url !== 'string') return null
    return isKnownPosting(knownPostings(memory), url)
      ? 'That job is already saved or already an application. Do not propose it again; find a different one.'
      : null
  }

  if (tool === 'scout.match.save') {
    const role = fields['role']
    if (typeof role !== 'string') return null
    return knownRoles(memory).has(role.trim().toLowerCase().replace(/\s+/g, ' '))
      ? 'That role is already in the list. Do not propose it again; find a different one.'
      : null
  }

  return null
}

export function proposingHost(real: ToolHost, sink: ProposalSink): ToolHost {
  return {
    memory: real.memory,
    today: real.today,
    /*
     * Every capability forwarded, not just the ones this file happens to know
     * about. Dropping one is silent: `board.search` politely reported "nothing
     * here can open a web page" on a machine where the extension was installed,
     * running and answering, because the scout ALWAYS goes through this wrapper
     * — `AUTO_CAPABLE.scout` is false — and the wrapper rebuilt the host without
     * `scan`. It typechecked, because every capability is optional.
     */
    ...(real.convert ? { convert: real.convert } : {}),
    ...(real.scan ? { scan: real.scan } : {}),
    ...(real.boards ? { boards: real.boards } : {}),
    check: real.check,

    run: (name, input) => {
      if (!mayPropose(sink.kind, name)) {
        return {
          ok: false,
          errors: [
            {
              message: `${name} is not available to this pipeline. Use one of the tools you were given.`,
              code: 'graph/invariant',
            },
          ],
        }
      }

      // Validated here, against the real tool's schema, so a malformed call is
      // a sentence back to the model NOW rather than a card that fails when the
      // user presses Approve tomorrow.
      const checked = real.check(name, input)
      if (!checked.ok) {
        return {
          ok: false,
          errors: checked.issues.map((issue) => ({
            message: issue.path ? `${issue.path}: ${issue.message}` : issue.message,
            code: 'tool/refused' as const,
          })),
        }
      }

      // Deduped after the schema check, so the message the model gets is about
      // the duplicate rather than about a field it also got wrong.
      const duplicate = duplicateOf(real.memory(), name, checked.value)
      if (duplicate !== null) {
        return { ok: false, errors: [{ message: duplicate, code: 'tool/refused' as const }] }
      }

      const raised = real.run('pipeline.proposal.raise', {
        pipelineId: sink.pipelineId,
        kind: sink.kind,
        tool: name,
        input: JSON.stringify(checked.value),
        title: proposalTitle(real.memory(), name, checked.value),
        rationale: sink.rationale(),
      })
      if (!raised.ok) return raised

      return {
        ok: true,
        // No id, on purpose. See the header: an id here is an id for a record
        // that does not exist, and the model's next call would use it.
        output: null,
        announcement: {
          title: 'Queued for approval',
          description: 'Nothing has changed yet — the person will decide.',
        },
        undo: null,
      }
    },
  }
}
