/**
 * Free-form keywords the user attaches to their own records.
 *
 * Distinct from `RoleTag`, which is a fixed vocabulary describing what a job
 * *is* (Postdoc, ML Engineer) and drives the global filter in the top bar.
 * Labels are whatever the user finds useful — "Read", "Referral", "Waiting on
 * them" — and are deliberately not enumerated in a union type, because the
 * point is that new ones can be invented at any time.
 *
 * One flat namespace across applications, reminders and anything added later:
 * a keyword is only worth setting up if it works everywhere the record appears.
 */
export type LabelTone = 'teal' | 'amber' | 'red' | 'green' | 'gray'

export type Label = {
  id: string
  name: string
  tone: LabelTone
}

export const seedLabels: Label[] = [
  { id: 'developer', name: 'Developer', tone: 'teal' },
  { id: 'research', name: 'Research', tone: 'teal' },
  { id: 'read', name: 'Read', tone: 'gray' },
  { id: 'referral', name: 'Referral', tone: 'green' },
  { id: 'negotiating', name: 'Negotiating', tone: 'amber' },
  { id: 'waiting', name: 'Waiting on them', tone: 'red' },
]

/**
 * Which labels sit on which record, keyed by the record's own id.
 *
 * A lookup table rather than a field on each record: labels are the user's,
 * the records are the app's, and a record should not have to be rewritten to
 * gain a keyword. It also means one map covers every kind of record.
 */
export const seedLabelsByRecord: Record<string, string[]> = {
  // reminders — keyed by the timeline item they sit on
  'ut-receipt': ['research', 'waiting'],
  'tamu-nudge': ['research', 'waiting'],
  'databricks-chase': ['developer', 'waiting'],
  'ut-statements': ['research', 'read'],
  'tt-letters': ['research'],
  'stripe-cv': ['developer', 'referral'],
  'uh-travel': ['research'],
  'baylor-offer': ['research', 'negotiating'],
  'tamu-submit': ['research'],
  'stripe-referral': ['developer', 'referral'],

  // applications — keyed 'app:<id>' via refKey, because six records in this
  // seed answer to 'stripe' and only the application has keywords on it. The
  // reminders above stay bare: nothing else claims their ids, and both the
  // reminders list and the timeline dialog spell them that way. Anything that
  // writes application keywords now writes this spelling; the code that also
  // reads and sweeps the bare form is there for a store restored from an older
  // session, not for this file.
  'app:ut-austin': ['research', 'read'],
  'app:stripe': ['developer', 'referral'],
  'app:texas-tech': ['research'],
  'app:rice': ['research', 'read'],
  'app:tamu': ['research', 'waiting'],
  'app:databricks': ['developer', 'waiting'],
  'app:baylor': ['research', 'negotiating'],
  'app:uh': ['research'],

  // links
  'l-rice': ['research', 'read'],
  'l-stripe': ['developer', 'referral'],
  'l-uh-dept': ['research', 'read'],
  'l-baylor-cs': ['research', 'negotiating'],
  'l-smith': ['research'],
  'l-chen': ['developer', 'referral'],
  'l-jobtalk': ['read'],
  'l-negotiate': ['read', 'negotiating'],

  // files
  'f-rice-ad': ['research', 'read'],
  'f-uh-packet': ['research', 'read'],
  'f-hiring-paper': ['research', 'read'],
  'f-cv': ['research', 'developer'],
  'f-research': ['research'],
  'f-teaching': ['research'],
  'f-jobtalk': ['research'],
  'f-chalk': ['research'],
  'f-refs': ['research', 'waiting'],
  'f-i9': [],

  // snippets
  's-bio-short': ['research', 'developer'],
  's-why-here': ['research'],
  's-teaching': ['research'],
  's-diversity': ['research'],
  's-availability': ['research', 'developer'],
  's-followup': ['waiting'],
  's-thanks': ['research', 'developer'],
  's-decline': ['negotiating'],
}

/** A colour for labels the user creates, cycled so two in a row differ. */
export const NEW_LABEL_TONES: LabelTone[] = ['teal', 'green', 'amber', 'red', 'gray']

/**
 * Seeds an id from a name, at creation only.
 *
 * It used to be the whole identity rule — same name, same id, so a label typed
 * twice was one label. That is no longer true, and reading it as though it were
 * will mislead you: `addLabel` in src/lib/labels.tsx dedupes on the folded NAME
 * and mints the id through `uniqueId`, because renaming has to leave the id
 * alone or every `byRecord` edge pointing at it would break. So an id and its
 * name can legitimately disagree — several seeded ones already do.
 */
export function toLabelId(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}
