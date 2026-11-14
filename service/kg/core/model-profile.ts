/**
 * L1 — the profile, and what is known about the person whose search this is:
 * background facts read from a CV and the claims that relate them.
 * Re-exported by `core/model.ts`.
 */

/** Every free-text field on the profile page, in one record. */
export type ProfileText = {
  fullName: string
  position: string
  location: string
  email: string
  website: string
  scholar: string
  github: string
  linkedin: string
  targetRoles: string
  regions: string
}

export type Profile = {
  text: ProfileText
  /**
   * What the scout scores a posting against. Not the global keyword system —
   * see the panel copy, which has to keep the two apart for the reader too.
   */
  matchTerms: string[]
  /**
   * The role tags this search uses, in the order they are offered.
   *
   * Seeded from `DEFAULT_ROLES` and editable in Profile. An application may
   * still carry a tag that is no longer in here — deleting a role must not
   * rewrite records — so every reader that needs the full vocabulary takes the
   * union of this and what is actually in use. `roleVocabulary` does that.
   */
  roles: string[]
  includeAcademia: boolean
  includeIndustry: boolean
}

/**
 * Every role tag worth offering: the profile's list, plus any still on a record.
 *
 * The second half is what makes deleting a role safe. Without it, removing
 * "Lecturer" from the profile would hide every lecturer application from the
 * filter and drop them out of the per-role table — the records would still be
 * there and the app would have stopped admitting it.
 */
export function roleVocabulary(
  roles: readonly string[],
  inUse: readonly { roleTag: string }[],
): string[] {
  const out = [...roles]
  for (const record of inUse) {
    if (record.roleTag && !out.includes(record.roleTag)) out.push(record.roleTag)
  }
  return out
}

export type ProfileProps = Profile

/**
 * The kinds of fact a CV yields about the person whose CV it is.
 *
 * ONE node type with a kind, rather than seven types, and the precedent is
 * `timelineItem` — which is a deadline, an interview and a reminder under one
 * roof because they share a shape and differ in a word. These share a shape
 * too: a thing you did, somewhere, between two dates, that a hiring committee
 * might care about.
 *
 * Seven separate types would each need a schema, a projection, an id prefix, an
 * analytics bucket and a screen, and would still be joined by an OR in every
 * query that asked "what has this person got". The discriminator is cheaper and
 * says the same thing.
 */

/**
 * The kinds of fact a CV states about a person.
 *
 * ## Why there are fourteen and not seven
 *
 * There were seven, and the seven were a silent filter. `readCv` drops any row
 * whose kind is not in this list, so a model correctly reading "AWS Certified
 * Solutions Architect", "German — C1", "openbench, 2k stars" or "US11234567B2"
 * had every one of them discarded on the way into the graph. The extraction was
 * right; the vocabulary could not hold it. Measured on a realistic reply, seven
 * of eight rows were lost.
 *
 * The list is now the union of what JSON Resume models — work, education,
 * skills, awards, certificates, publications, languages, volunteer, projects —
 * and what an academic CV additionally carries: teaching, service, grants and
 * patents. Those four have no equivalent in a developer-CV schema and are the
 * bulk of the evidence for anybody applying to a university.
 *
 * ## The two pairs that look redundant and are not
 *
 * `service` is academic service — reviewing, programme committees, editorial
 * work — and it is a professional credential. `volunteering` is unpaid work in
 * the world, which is a different claim about a person and reads differently to
 * a hiring committee. Collapsing them would file a stint at a food bank as a
 * qualification.
 *
 * `award` is a prize; `grant` is money won to do work with. For a researcher
 * the second is the one a search committee counts, and a schema that merged
 * them would make a £2M fellowship indistinguishable from a best-poster ribbon.
 */
export const BACKGROUND_KINDS = [
  'education',
  'employment',
  'publication',
  'skill',
  'teaching',
  'award',
  'service',
  'certification',
  'language',
  'project',
  'volunteering',
  'membership',
  'grant',
  'patent',
  'leadership',
  'outreach',
  'training',
  /*
   * The catch-all, and it is the most important entry in the list.
   *
   * The seven-kind version of this vocabulary was a SILENT FILTER: `readCv`
   * drops any row whose kind is not here, so a certification, a language, a
   * patent and a society membership were each extracted correctly and then
   * discarded on the way in. Measured on a realistic reply, one row of eight
   * survived.
   *
   * Widening the list fixed those eight. It cannot fix the ninth. Somebody's CV
   * has a section nobody here thought of — a portfolio of exhibitions, a list
   * of translations, military service — and a closed vocabulary loses it in
   * exactly the same silent way.
   *
   * So this is the open lane, the same shape `core/ontology.ts` gives relations
   * for the same reason: a fact filed under an unfamiliar name is honest and
   * still findable, and a fact dropped is gone with nothing on screen to say so.
   * The prompt asks the model to name what it is in `detail`.
   */
  'other',
] as const
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number]

/**
 * The order a background reads in, and what each kind is called.
 *
 * Here rather than in each app's panel, where it was written twice. It is data
 * about the vocabulary — not layout — and two copies is two chances for a kind
 * added above to be rendered by one platform and silently dropped by the other,
 * leaving entries in the graph with nowhere to see or delete them.
 *
 * NOT the declaration order above, which is the order the list was extended in.
 * This is the order a CV prints: what you studied, what you have held, what
 * came out of it. It is what a reader expects because it is what every CV they
 * have read used.
 *
 * `Record<BackgroundKind, …>` on the label map and a length assertion in the
 * test on the order: between them a new kind cannot be added without both being
 * updated.
 */
export const BACKGROUND_ORDER: readonly BackgroundKind[] = [
  'education',
  'employment',
  'publication',
  'patent',
  'grant',
  'award',
  'teaching',
  'service',
  'project',
  'leadership',
  'outreach',
  'certification',
  'training',
  'skill',
  'language',
  'volunteering',
  'membership',
  // Last, always. It is what did not fit the headings above it, so it reads
  // as a footnote rather than as a category somebody chose.
  'other',
]

/** Plural, because every one of these heads a list. */
export const BACKGROUND_LABEL: Readonly<Record<BackgroundKind, string>> = {
  education: 'Education',
  employment: 'Employment',
  publication: 'Publications',
  patent: 'Patents',
  grant: 'Grants',
  leadership: 'Leadership',
  outreach: 'Outreach',
  training: 'Professional development',
  other: 'Other',
  award: 'Awards',
  teaching: 'Teaching',
  service: 'Service',
  project: 'Projects',
  certification: 'Certifications',
  skill: 'Skills',
  language: 'Languages',
  volunteering: 'Volunteering',
  membership: 'Memberships',
}

/**
 * One fact about the user, extracted from something they wrote.
 *
 * ## Why this exists
 *
 * The profile was ten text fields the user typed, and `fitOf` scored postings
 * against those — so somebody who had uploaded a forty-page CV got exactly as
 * good an answer as somebody who had uploaded nothing. Every fact that would
 * actually decide a fit — what they studied, where they worked, what they have
 * published, what they can teach — sat in a PDF the app could read and never
 * did.
 *
 * ## Why `source` is not optional in spirit
 *
 * It is optional in the type, because a user may type a background by hand and
 * there is no document behind that. But everything EXTRACTED carries the file
 * it came from, and that is what makes the feature trustworthy rather than
 * magical: a claim the app makes about somebody's background can be traced back
 * to the sentence in the document that produced it, and a wrong one can be
 * found and removed rather than argued with.
 *
 * ## Dates are strings, and loosely so
 *
 * A CV says "2021–2024", "Summer 2019", "since 2024" and "n.d.". Forcing those
 * into ISO dates means either refusing most of them or inventing precision
 * nobody wrote down. They are kept as the person wrote them and compared as
 * text; `frame` carries a sortable year when one can be recovered, which is
 * what the ordering actually needs.
 */
export type BackgroundProps = {
  slug: string
  kind: BackgroundKind
  /** The degree, the job title, the paper's title, the skill's name. */
  title: string
  /** University, employer, journal, conference. Free text — not an org node. */
  where?: string
  /** As written on the document: '2021–2024', 'Summer 2019', 'since 2024'. */
  period?: string
  /**
   * A four-digit year for ordering, when one can be recovered from `period`.
   *
   * Separate from `period` because the display string and the sort key are
   * different jobs, and deriving the second from the first on every render is
   * how a list ends up in a different order than the one it printed.
   */
  year?: number
  /** Anything worth keeping that is not the title — a venue, a grade, a note. */
  detail?: string
  /**
   * The bullet points under an entry: what was built, shipped, taught, found.
   *
   * ## Why this earns a field of its own rather than going in `detail`
   *
   * It is the part of a CV that answers a posting. A requirement reads "five
   * years running distributed systems in production" and the thing that
   * answers it is not the job title `Staff Engineer` or the employer
   * `Cloudflare` — it is the line underneath saying the person ran a
   * multi-region store. `assess.ts` scores by term overlap over what it is
   * given, so squashing those lines into a single optional `detail`, or
   * dropping them as the first extractor did, removed most of the evidence
   * from the one place it was needed.
   *
   * An ARRAY, not a paragraph, and JSON Resume calls it the same thing for the
   * same reason: the bullets are separately true, separately quotable in a
   * cover letter, and a screen renders them as a list. Joining them into one
   * string means every reader has to guess how to split it again.
   */
  highlights?: readonly string[]
  /**
   * Where this came from, when it was extracted rather than typed.
   *
   * The id of the `file` node. Not an edge, because an edge would be a second
   * place to look and this is a property of the claim rather than a
   * relationship anybody navigates.
   */
  source?: string
}

/** One fact about the user, as a screen reads it. See `BackgroundProps`. */
export type Background = {
  id: string
  kind: BackgroundKind
  title: string
  where?: string
  period?: string
  year?: number
  detail?: string
  highlights?: readonly string[]
  source?: string
}

/**
 * One relation the graph holds, in whatever words it was proposed.
 *
 * The ends are edges (`OF` to the subject, `ABOUT` to the object) rather than
 * id properties, because they are the thing traversal walks — the whole point
 * of reifying was to make "what evidence do I have for this" a graph question.
 */
export type ClaimProps = {
  slug: string
  /**
   * The canonical predicate from `core/ontology.ts`, or the normalised surface
   * form when the taxonomy had no name for it.
   *
   * Never the raw surface: two spellings of one relation have to compare equal
   * or `core/claim.ts` cannot tell a duplicate from a new fact.
   */
  predicate: string
  /**
   * Exactly what was proposed, before canonicalising.
   *
   * Kept because it is evidence. A person looking at "BUILT" who does not
   * recognise it needs to see that the document said "contributed to" and that
   * jojo made that mapping — otherwise the claim reads as something the app
   * decided rather than something the document says.
   */
  surface: string
  /** False when the taxonomy had no name for this and it was kept open. */
  known: boolean
  /** The file this was read from. A breadcrumb, not a foreign key — see `BackgroundProps.source`. */
  source?: string
}
