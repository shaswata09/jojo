/**
 * What a handoff is made of.
 *
 * Groups match the collections a person can actually name — applications, dated
 * things, the vault, keywords — rather than the seven lists the store happens to
 * keep. Someone deciding what to move thinks "my reminders", not "timeline items
 * and saved postings".
 *
 * Files are split out of the vault because they are the only group anyone opts
 * out of: they are the bulk of a transfer, and the rest is small text that is
 * never worth leaving behind.
 *
 * Every list in the store has to appear in exactly one of these. The page says
 * "move everything", and the finished run reads the groups back as an itemised
 * total — so a collection missing from this union is a sentence that undercounts
 * what the user has, which is worse than no total at all.
 *
 * That last paragraph was a rule nothing enforced, and it was already false when
 * it was written. Measured on the seeded graph: `handoff-send` serialises
 * `GraphSnapshot.nodes()`, which was 92 records, while the manifest itemised 76
 * — the five referees the vault holds were in no group, and reading a CV in
 * pushed the payload to 94 with the manifest still saying 76. `GROUP_OF` below
 * is that rule made checkable: it is exhaustive over `NodeType`, so a record
 * that can be stored and cannot be named now fails to compile.
 */
import type { NodeType } from '@jojo/service/core/model'

export type GroupId =
  | 'applications'
  | 'timeline'
  | 'vault'
  | 'files'
  | 'keywords'
  | 'scout'
  | 'profile'
  /**
   * Referees, hiring chairs, recruiters — `useVault().people`.
   *
   * Its own group rather than part of the vault, for the reason `person` is its
   * own node type: a referee belongs to nine applications and to none of them.
   * Folding five people into "16 links and snippets" would report them under a
   * heading whose hint names neither.
   */
  | 'people'
  /**
   * What the user has actually done — degrees, posts, papers, skills.
   *
   * Distinct from `profile`, which is what they SAY they want, and the two are
   * not interchangeable: the profile is one record with a handful of fields, and
   * background is an unbounded list read out of a CV. A person who has just fed
   * jojo their CV and is moving to a new laptop is exactly the person who needs
   * to see these counted.
   */
  | 'background'

/**
 * Which group carries each kind of record, or null where nothing does.
 *
 * Exhaustive on purpose. `NodeType` is the definition of what can be stored, and
 * a backup carries every node — so this table is the whole answer to "is the
 * inventory honest", and adding a node type without an entry stops the build.
 *
 * Nulls are decisions, not gaps to be filled by whoever passes: each says why
 * the thing it names is not an inventory line.
 */
export const GROUP_OF: Record<NodeType, GroupId | null> = {
  application: 'applications',
  /*
   * Not its own line, and this is the one fold that is deliberate. Eleven
   * organisations exist in the seed because twelve applications point at them;
   * nobody adds an organisation, and nobody would look for one on the other
   * device. "12 applications" is the sentence a person checks.
   */
  organisation: 'applications',
  timelineItem: 'timeline',
  link: 'vault',
  snippet: 'vault',
  file: 'files',
  person: 'people',
  keyword: 'keywords',
  pipeline: 'scout',
  posting: 'scout',
  match: 'scout',
  profile: 'profile',
  background: 'background',
  /*
   * A relation between two records, as a record. It exists to hold what a model
   * read out of a CV — "supervised six dissertations" — and it is counted in
   * neither direction on purpose: a claim is the edge between two background
   * facts that ARE counted, and itemising both is itemising one thing twice.
   */
  claim: 'background',
  /*
   * Conversations with the assistant. They travel — they are nodes, and a
   * backup carries every node — and no group counts them, which is the same
   * shape of defect as the referees above and is left recorded here rather than
   * quietly fixed: "3 conversations" needs a line on the manifest and a count
   * off `useThreads`, and that is a change to the page, not to this table.
   */
  thread: null,
  /*
   * One pending approval, kept until a person answers it. A live queue whose
   * whole life is minutes; there is nothing here a person is moving to another
   * device, and a manifest line for it would report a number that is 0 for all
   * but a few seconds of the app's life.
   */
  proposal: null,
}

export type TransferGroup = {
  id: GroupId
  label: string
  /** The breakdown behind the count, so the number is checkable. */
  hint: string
  count: number
  /** How the group reads in a sentence — "26 vault records", not "26 vault". */
  unit: string
}

export const totalOf = (groups: readonly TransferGroup[]) =>
  groups.reduce((sum, group) => sum + group.count, 0)

/** "12 applications · 24 reminders and events" — the one-line form. */
export function summarise(groups: readonly TransferGroup[]) {
  if (groups.length === 0) return 'nothing'
  return groups.map((group) => `${group.count} ${group.unit}`).join(' · ')
}
