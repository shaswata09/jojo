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
  // reminders
  'ut-receipt': ['research', 'waiting'],
  'tamu-nudge': ['research', 'waiting'],
  'databricks-chase': ['developer', 'waiting'],
  'ut-statements': ['research', 'read'],
  'tt-letters': ['research'],
  'stripe-cv': ['developer', 'referral'],
  'uh-travel': ['research'],
  'baylor-decide': ['research', 'negotiating'],
  'tamu-submit': ['research'],
  'stripe-referral': ['developer', 'referral'],

  // applications
  'ut-austin': ['research', 'read'],
  stripe: ['developer', 'referral'],
  'texas-tech': ['research'],
  rice: ['research', 'read'],
  tamu: ['research', 'waiting'],
  databricks: ['developer', 'waiting'],
  baylor: ['research', 'negotiating'],
  uh: ['research'],

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

/** Ids are derived from the name, so a label typed twice is the same label. */
export function toLabelId(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}
