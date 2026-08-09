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
 */
export type GroupId =
  'applications' | 'timeline' | 'vault' | 'files' | 'keywords' | 'scout' | 'profile'

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
