/**
 * L1 — people in the search, the role each plays on a job, and the briefs
 * written for referees. Re-exported by `core/model.ts`.
 */

import type { Props } from './model-graph'

/**
 * What you want one referee to say about one application.
 *
 * WHY IT EXISTS. A recommender writes for several of your applications, and the
 * letter each one needs is different — the teaching post wants the seminar you
 * ran, the research post wants the grant. Telling them that used to be an email
 * written from memory. This is that email's content, kept beside the person and
 * exported to them as a sheet (see `web/src/lib/referee-sheet.ts`).
 *
 * WHY NOT THE KEYWORDS. The keyword chips on an application are the user's own
 * filing labels — "Waiting on them", "Negotiating" — and sending those to a
 * professor would be wrong in both senses. Highlights are written FOR the
 * recommender, so they are their own field.
 *
 * WHY ON THE PERSON, keyed by application, rather than on the edge. An edge
 * CAN carry props (`StoredEdge.props`), and the one attribute of the
 * relationship itself — what the person IS on that job — does live there (see
 * `ContactRole`). A brief is different in kind: it is a piece of writing
 * addressed to the person, edited as one set for them in one dialog and
 * exported per person, so it sits with the person the way the checklist sits
 * with an application, and rides undo, the journal and Transfer with the
 * record. The reified relation that also carries data — a `claim` — would not
 * do: it cannot be deleted, and a note somebody changed their mind about must
 * be.
 *
 * `applicationId` is a pointer in props, which `core/model.ts` usually refuses. It is
 * accepted here for the reason `postingId` is: the brief is ABOUT that record,
 * and the projection only ever shows briefs for applications the person is
 * still filed under, so a deleted or unfiled application leaves a brief that is
 * never read rather than one that is wrong. `vault.person.update` drops it the
 * next time the person's filing changes.
 */
export type RefereeBrief = {
  applicationId: string
  /** The aspects to highlight, in the order you listed them. */
  highlights?: string[]
  /** Anything else they should know about this application. */
  note?: string
}

/**
 * What a person is on one application: the referee writing for it, or the
 * person you deal with there.
 *
 * STORED ON THE EDGE — the `FILED_UNDER` edge from the person to the
 * application carries `{ role }` — because it is an attribute of that pairing
 * and nothing else: Anita can recommend you for Rice and be your point of
 * contact at Texas Tech, and neither is true of Anita in general. Her own
 * `role` prop ("Referee") is how you would describe her, not what she is on a
 * given job.
 *
 * Optional. Every filing made before roles existed, and every one made from the
 * Vault's "Named on" picker, has none, and the honest reading of "none" is
 * "not said" — so nothing infers one from her title.
 */
export const CONTACT_ROLE_VALUES = ['recommender', 'contact'] as const
export type ContactRole = (typeof CONTACT_ROLE_VALUES)[number]

export const CONTACT_ROLE_LABEL: Record<ContactRole, string> = {
  recommender: 'Recommender',
  contact: 'Point of contact',
}

/** An edge's `role`, if it holds one this version knows. Edge props are untyped storage. */
export const contactRoleOf = (props: Props | undefined): ContactRole | undefined => {
  const role = props?.['role']
  return typeof role === 'string' && (CONTACT_ROLE_VALUES as readonly string[]).includes(role)
    ? (role as ContactRole)
    : undefined
}

/** Bounds on a brief, enforced by `vault.person.update` and the editor alike. */
export const MAX_BRIEF_HIGHLIGHTS = 12
export const MAX_BRIEF_HIGHLIGHT_TEXT = 80
export const MAX_BRIEF_NOTE_TEXT = 4_000
/** One per application a person can be filed under, with room to spare. */
export const MAX_BRIEFS = 500

/**
 * What is worth keeping about someone, and deliberately not more.
 *
 * `name` is the only required field, because the first thing anyone records
 * about a referee is that they exist and are late. Everything else is filled in
 * when it turns out to matter — a form that demanded an email before it would
 * remember a name would be a form people work around in the note field, which
 * is the state this replaces.
 *
 * `role` is THEIR role, not the job's: "Hiring chair", "Referee", "Recruiter".
 * It is free text rather than a union for the reason `ROLES` is a union and
 * should not be — the shapes a search takes are not knowable from here, and a
 * closed list would send half of them into the note.
 *
 * `affiliation` AND NOT `org`, and the name is the point. On an application,
 * `org` is a pointer — the employer is the `organisation` node on the other end
 * of `AT`, and `seed.test.ts` bans the key outright to keep it that way. A
 * person's affiliation is not that: a referee at KTH is named on two Baylor
 * applications and there is no KTH organisation in the store, nor should there
 * be. It is a fact about them, in their own words, and it points at nothing.
 */

export type PersonProps = {
  slug: string
  name: string
  role?: string
  affiliation?: string
  email?: string
  phone?: string
  note?: string
  /** One per application, only where something was written. See `RefereeBrief`. */
  briefs?: RefereeBrief[]
}

/** A person, with the jobs they are named on. See `PersonProps`. */
export type Person = {
  id: string
  name: string
  role?: string
  /** Where they are, in their own words. Not a pointer — see `PersonProps`. */
  affiliation?: string
  email?: string
  phone?: string
  note?: string
  /** Every application this person is named on, newest edge last. */
  applicationIds: string[]
  /**
   * Briefs for the applications in `applicationIds` only — a brief for one
   * they are no longer filed under is kept in storage and never shown.
   */
  briefs?: RefereeBrief[]
  /** What they are on each application, by application id, where it was said. See `ContactRole`. */
  roles?: Record<string, ContactRole>
}
